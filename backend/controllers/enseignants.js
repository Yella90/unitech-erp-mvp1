const db = require('../database/db');
const {
  createStaffUserAccount,
  deleteStaffUserAccount,
  ensureUserEmailAvailable,
  findStaffUserAccount,
  syncStaffUserAccount,
} = require('../utils/staffAccounts');

const enseignantColumns = [
  'nomComplet',
  'email',
  'telephone',
  'matiere',
  'typePayement',
  'statut',
  'salaire',
  'tauxHoraire',
  'matricule',
  'date_naissance',
  'lieu_naissance',
  'sexe',
  'nationalite',
  'adresse',
  'date_embauche',
  'photo',
  'niveau_enseignement',
  'situation_matrimoniale',
  'type_personnel',
  'departement',
  'specialite',
  'diplomes',
  'niveau_etude',
  'experience_professionnelle',
  'competences',
  'horaires_travail',
  'numero_employe',
  'type_contrat',
  'date_debut_contrat',
  'date_fin_contrat',
  'temps_travail',
  'nina',
  'inps',
  'references_administratives',
  'documents_identite',
  'diplomes_scannes',
  'contrat_travail',
  'cv',
  'attestations',
  'date_prise_service',
  'prime',
  'indemnites',
  'mode_paiement',
  'historique_salaires',
  'avances_salaire',
  'retenues',
  'regle_paiement_partiel',
  'montant_creneau',
  'montant_forfait_trimestre',
  'echeance_paiement',
  'bulletins_paie',
  'etat_paiements',
  'presences',
  'absences',
  'retards',
  'permissions',
  'conges',
  'sanctions_disciplinaires',
  'historique_pointages',
  'observations_administratives',
  'contact_urgence_nom',
  'contact_urgence_lien',
  'contact_urgence_telephone',
  'contact_urgence_adresse',
  'documents',
  'matieres_enseignees',
  'classes_affectees',
  'volume_horaire',
  'emploi_du_temps',
  'professeur_principal',
  'nombre_eleves_suivis',
  'historique_affectations',
  'resultats_classes',
  'absences_enseignant',
  'observations_pedagogiques',
];

function normalizeOptionalValue(value) {
  if (Array.isArray(value) || (value && typeof value === 'object')) {
    return JSON.stringify(value);
  }
  if (value === undefined) return null;
  return value;
}

function normalizeEnseignantRequest(body = {}, existing = {}) {
  const normalized = { ...body };

  if (!normalized.nomComplet && normalized.full_name) normalized.nomComplet = normalized.full_name;
  if (!normalized.typePayement && normalized.type_payement) normalized.typePayement = normalized.type_payement;
  if (!normalized.typePayement && normalized.mode_paiement) normalized.typePayement = normalized.mode_paiement;
  if (!normalized.statut && normalized.status) normalized.statut = normalized.status;
  if (!normalized.salaire && normalized.salaire_base) normalized.salaire = normalized.salaire_base;
  if (!normalized.tauxHoraire && normalized.taux_horaire) normalized.tauxHoraire = normalized.taux_horaire;
  if (!normalized.matiere && normalized.poste && typeof normalized.poste === 'string') {
    normalized.matiere = normalized.poste.replace(/^Professeur de\s+/i, '').trim();
  }

  const currentType = normalized.typePayement || existing.typePayement || existing.type_payement;
  if (!normalized.typePayement) {
    if (normalized.tauxHoraire || existing.tauxHoraire || existing.taux_horaire) {
      normalized.typePayement = 'tauxHoraire';
    } else if (normalized.salaire || existing.salaire || existing.salaire_base) {
      normalized.typePayement = 'salaire';
    } else if (currentType) {
      normalized.typePayement = currentType;
    }
  }

  return normalized;
}

function formatEnseignantResponse(row) {
  if (!row) return row;
  const resolvedTypePayement = row.typePayement || row.type_payement || '';
  const resolvedSalaire = row.salaire ?? row.salaire_base ?? null;
  const resolvedTauxHoraire = row.tauxHoraire ?? row.taux_horaire ?? null;
  return {
    ...row,
    full_name: row.nomComplet || '',
    status: row.statut || row.status || '',
    typePayement: resolvedTypePayement,
    type_payement: resolvedTypePayement,
    salaire: resolvedSalaire,
    salaire_base: resolvedSalaire,
    tauxHoraire: resolvedTauxHoraire,
    taux_horaire: resolvedTauxHoraire,
    poste: row.poste || (row.matiere ? `Professeur de ${row.matiere}` : ''),
  };
}

function pickEnseignantPayload(body) {
  return enseignantColumns.reduce((acc, column) => {
    acc[column] = normalizeOptionalValue(body[column]);
    return acc;
  }, {});
}

function generateMatricule() {
  const suffix = `${Date.now()}`.slice(-6);
  const random = Math.floor(Math.random() * 900) + 100;
  return `ENS${suffix}${random}`;
}

function handleUniqueConstraint(res, err, entityLabel) {
  const message = String(err?.message || '');
  if (!message.includes('UNIQUE') && !message.includes('duplicate key') && !message.includes('constraint')) return false;

  if (message.includes('enseignants.email')) {
    res.status(400).json({ error: `Un ${entityLabel} avec cet email existe deja` });
    return true;
  }
  if (message.includes('enseignants.telephone')) {
    res.status(400).json({ error: `Un ${entityLabel} avec ce telephone existe deja` });
    return true;
  }
  if (message.includes('enseignants.matricule')) {
    res.status(400).json({ error: `Le matricule genere pour cet ${entityLabel} est deja utilise` });
    return true;
  }

  res.status(400).json({ error: `Donnees invalides pour cet ${entityLabel}` });
  return true;
}

exports.addEnseignant = async (req, res) => {
  const payload = pickEnseignantPayload(normalizeEnseignantRequest(req.body));
  const { nomComplet, email, telephone, matiere, typePayement, statut, salaire, tauxHoraire } = payload;
  const schoolId = req.user.school_id;
  const normalizedEmail = String(email || '').trim().toLowerCase();

  if (!nomComplet || !email || !telephone || !matiere || !typePayement || !schoolId || !statut) {
    return res.status(400).json({ error: 'Tous les champs obligatoires doivent etre remplis' });
  }

  if (typePayement === 'salaire' && (!salaire || Number(salaire) <= 0)) {
    return res.status(400).json({ error: 'Salaire valide requis pour les enseignants payes au salaire' });
  }

  if (typePayement === 'tauxHoraire' && (!tauxHoraire || Number(tauxHoraire) <= 0)) {
    return res.status(400).json({ error: "Taux horaire valide requis pour les enseignants payes a l'heure" });
  }

  const payloadWithMatricule = {
    ...payload,
    matricule: payload.matricule || generateMatricule(),
  };

  try {
    await ensureUserEmailAvailable(normalizedEmail);
  } catch (error) {
    if (error.message === 'USER_EMAIL_EXISTS') {
      return res.status(400).json({ error: 'Un compte utilisateur existe deja avec cet email' });
    }
    return res.status(500).json({ error: 'Erreur verification compte utilisateur' });
  }

  db.get(
    'SELECT * FROM enseignants WHERE (lower(trim(email)) = ? OR telephone = ?) AND school_id = ?',
    [normalizedEmail, telephone, schoolId],
    async (err, existingEnseignant) => {
      if (err) {
        console.error('Erreur verification enseignant:', err);
        return res.status(500).json({ error: 'Erreur serveur' });
      }

      if (existingEnseignant) {
        if (existingEnseignant.email === email) {
          return res.status(400).json({ error: 'Cet enseignant existe deja dans l ecole avec cet email' });
        }
        if (existingEnseignant.telephone === telephone) {
          return res.status(400).json({ error: 'Cet enseignant existe deja dans l ecole avec ce telephone' });
        }
      }

      const columns = [...enseignantColumns, 'school_id'];
      const placeholders = columns.map(() => '?').join(', ');
      const values = [...enseignantColumns.map((column) => payloadWithMatricule[column]), schoolId];

      db.run(
        `INSERT INTO enseignants (${columns.join(', ')}) VALUES (${placeholders})`,
        values,
        async function(insertErr) {
          if (insertErr) {
            console.error('Erreur ajout enseignant:', insertErr);
            if (handleUniqueConstraint(res, insertErr, 'enseignant')) return;
            return res.status(500).json({ error: "Erreur lors de l'ajout de l'enseignant" });
          }

          try {
            const account = await createStaffUserAccount({
              schoolId,
              name: nomComplet,
              email: normalizedEmail,
              phone: telephone,
              matricule: payloadWithMatricule.matricule,
              role: 'enseignant',
            });

            return res.status(201).json({
              message: 'Enseignant ajoute avec succes',
              id: this.lastID,
              matricule: payloadWithMatricule.matricule,
              compte: {
                email: account.email,
                role: account.role,
                mot_de_passe_genere: account.generatedPassword,
              },
            });
          } catch (accountErr) {
            console.error('Erreur creation compte enseignant:', accountErr);
            db.run('DELETE FROM enseignants WHERE id = ? AND school_id = ?', [this.lastID, schoolId], () => {
              if (String(accountErr.message || '').includes('UNIQUE') || String(accountErr?.message || '').includes('duplicate key')) {
                return res.status(400).json({ error: 'Un compte utilisateur existe deja avec cet email' });
              }
              return res.status(500).json({ error: 'Enseignant non enregistre car la creation du compte a echoue' });
            });
          }
        }
      );
    }
  );
};

exports.getEnseignants = (req, res) => {
  const schoolId = req.user.school_id;
  db.all('SELECT * FROM enseignants WHERE school_id = ?', [schoolId], (err, enseignants) => {
    if (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
    res.json((enseignants || []).map(formatEnseignantResponse));
  });
};

exports.getEnseignantById = (req, res) => {
  const schoolId = req.user.school_id;
  const enseignantId = req.params.id;
  db.get('SELECT * FROM enseignants WHERE id = ? AND school_id = ?', [enseignantId, schoolId], (err, enseignant) => {
    if (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
    if (!enseignant) {
      return res.status(404).json({ error: 'Enseignant non trouve' });
    }
    res.json(formatEnseignantResponse(enseignant));
  });
};

exports.updateEnseignant = async (req, res) => {
  const schoolId = req.user.school_id;
  const enseignantId = req.params.id;
  db.get('SELECT * FROM enseignants WHERE id = ? AND school_id = ?', [enseignantId, schoolId], async (fetchErr, existing) => {
    if (fetchErr) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
    if (!existing) {
      return res.status(404).json({ error: 'Enseignant non trouve ou pas autorise' });
    }

    const normalizedBody = normalizeEnseignantRequest(req.body, existing);
    const payload = pickEnseignantPayload(normalizedBody);
    const normalizedEmail = String(payload.email || existing.email || '').trim().toLowerCase();
    const payloadWithMatricule = {
      ...payload,
      email: normalizedEmail,
      matricule: payload.matricule || existing.matricule || generateMatricule(),
    };
    try {
      const linkedUser = await findStaffUserAccount({
        schoolId,
        email: existing.email,
        matricule: existing.matricule,
      });
      await ensureUserEmailAvailable(payloadWithMatricule.email, linkedUser?.id || null);
    } catch (accountErr) {
      if (accountErr.message === 'USER_EMAIL_EXISTS') {
        return res.status(400).json({ error: 'Un compte utilisateur existe deja avec ce nouvel email' });
      }
      return res.status(500).json({ error: 'Erreur verification compte utilisateur' });
    }
    const assignments = enseignantColumns.map((column) => `${column} = ?`).join(', ');
    const values = [...enseignantColumns.map((column) => payloadWithMatricule[column]), enseignantId, schoolId];

    db.run(`UPDATE enseignants SET ${assignments} WHERE id = ? AND school_id = ?`, values, async function(err) {
      if (err) {
        console.error('Erreur mise a jour enseignant:', err);
        if (handleUniqueConstraint(res, err, 'enseignant')) return;
        return res.status(500).json({ error: "Erreur lors de la mise a jour de l'enseignant" });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Enseignant non trouve ou pas autorise' });
      }
      try {
        await syncStaffUserAccount({
          schoolId,
          previousEmail: existing.email,
          previousMatricule: existing.matricule,
          name: payloadWithMatricule.nomComplet,
          email: payloadWithMatricule.email,
          phone: payloadWithMatricule.telephone,
          matricule: payloadWithMatricule.matricule,
          role: 'enseignant',
        });
      } catch (accountErr) {
        console.error('Erreur synchronisation compte enseignant:', accountErr);
        if (accountErr.message === 'USER_EMAIL_EXISTS') {
          return res.status(400).json({ error: 'Un compte utilisateur existe deja avec ce nouvel email' });
        }
        return res.status(500).json({ error: 'Enseignant mis a jour mais synchronisation du compte impossible' });
      }
      res.json({ message: 'Enseignant mis a jour avec succes' });
    });
  });
};

exports.suspendEnseignant = (req, res) => {
  const schoolId = req.user.school_id;
  const enseignantId = req.params.id;
  db.get('SELECT email, matricule FROM enseignants WHERE id = ? AND school_id = ?', [enseignantId, schoolId], (fetchErr, existing) => {
    if (fetchErr) {
      return res.status(500).json({ error: 'Erreur lors de la lecture de l enseignant' });
    }
    db.run('UPDATE enseignants SET statut = ? WHERE id = ? AND school_id = ?', ['suspendu', enseignantId, schoolId], async function(err) {
      if (err) {
        return res.status(500).json({ error: "Erreur lors de la suspension de l'enseignant" });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Enseignant non trouve ou pas autorise' });
      }
      try {
        if (existing) {
          await new Promise((resolve, reject) => {
            db.run(
              'UPDATE users SET is_active = 0 WHERE school_id = ? AND (lower(trim(email)) = lower(trim(?)) OR matricule = ?)',
              [schoolId, existing.email || '', existing.matricule || null],
              (userErr) => (userErr ? reject(userErr) : resolve())
            );
          });
        }
      } catch (accountErr) {
        console.error('Erreur desactivation compte enseignant:', accountErr);
      }
      res.json({ message: 'Enseignant suspendu avec succes' });
    });
  });
};

exports.deleteEnseignant = (req, res) => {
  const schoolId = req.user.school_id;
  const enseignantId = req.params.id;
  db.get('SELECT email, matricule FROM enseignants WHERE id = ? AND school_id = ?', [enseignantId, schoolId], (fetchErr, existing) => {
    if (fetchErr) {
      return res.status(500).json({ error: 'Erreur lors de la lecture de l enseignant' });
    }
    db.run('DELETE FROM enseignants WHERE id = ? AND school_id = ?', [enseignantId, schoolId], async function(err) {
      if (err) {
        return res.status(500).json({ error: "Erreur lors de la suppression de l'enseignant" });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Enseignant non trouve ou pas autorise' });
      }
      try {
        await deleteStaffUserAccount({
          schoolId,
          email: existing?.email,
          matricule: existing?.matricule,
        });
      } catch (accountErr) {
        console.error('Erreur suppression compte enseignant:', accountErr);
      }
      res.json({ message: 'Enseignant supprime avec succes' });
    });
  });
};
