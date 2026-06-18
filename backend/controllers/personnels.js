const db = require('../database/db');
const {
  createStaffUserAccount,
  deleteStaffUserAccount,
  ensureUserEmailAvailable,
  findStaffUserAccount,
  resolvePersonnelRole,
  syncStaffUserAccount,
} = require('../utils/staffAccounts');

const personnelColumns = [
  'nomComplet',
  'email',
  'telephone',
  'poste',
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
];

function normalizeOptionalValue(value) {
  if (Array.isArray(value) || (value && typeof value === 'object')) {
    return JSON.stringify(value);
  }
  if (value === undefined) return null;
  return value;
}
function generateMatricule() {
  const suffix = `${Date.now()}`.slice(-6);
  const random = Math.floor(Math.random() * 900) + 100;
  return `PER${suffix}${random}`;
}

function handleUniqueConstraint(res, err, entityLabel) {
  const message = String(err?.message || '');
  if (!message.includes('UNIQUE') && !message.includes('duplicate key') && !message.includes('constraint')) return false;

  if (message.includes('personnels.email')) {
    res.status(400).json({ error: `Un ${entityLabel} avec cet email existe deja` });
    return true;
  }
  if (message.includes('personnels.telephone')) {
    res.status(400).json({ error: `Un ${entityLabel} avec ce telephone existe deja` });
    return true;
  }
  if (message.includes('personnels.matricule')) {
    res.status(400).json({ error: `Le matricule genere pour ce ${entityLabel} est deja utilise` });
    return true;
  }

  res.status(400).json({ error: `Donnees invalides pour ce ${entityLabel}` });
  return true;
}
function normalizePersonnelRequest(body = {}, existing = {}) {
  const normalized = { ...body };

  if (!normalized.nomComplet && normalized.full_name) normalized.nomComplet = normalized.full_name;
  if (!normalized.typePayement && normalized.type_payement) normalized.typePayement = normalized.type_payement;
  if (!normalized.typePayement && normalized.mode_paiement) normalized.typePayement = normalized.mode_paiement;
  if (!normalized.salaire && normalized.salaire_base) normalized.salaire = normalized.salaire_base;
  if (!normalized.tauxHoraire && normalized.taux_horaire) normalized.tauxHoraire = normalized.taux_horaire;
  if (!normalized.poste && normalized.role) normalized.poste = normalized.role;
  if (!normalized.typePayement) {
    if (normalized.tauxHoraire || existing.tauxHoraire || existing.taux_horaire) {
      normalized.typePayement = 'tauxHoraire';
    } else if (normalized.salaire || existing.salaire || existing.salaire_base) {
      normalized.typePayement = 'salaire';
    } else if (existing.typePayement || existing.type_payement) {
      normalized.typePayement = existing.typePayement || existing.type_payement;
    }
  }

  return normalized;
}

function formatPersonnelResponse(row) {
  if (!row) return row;
  return {
    ...row,
    full_name: row.nomComplet || '',
    role: row.poste || row.role || '',
    type_payement: row.typePayement || row.type_payement || '',
    salaire_base: row.salaire ?? row.salaire_base ?? null,
    taux_horaire: row.tauxHoraire ?? row.taux_horaire ?? null,
  };
}

function pickPersonnelPayload(body) {
  return personnelColumns.reduce((acc, column) => {
    acc[column] = normalizeOptionalValue(body[column]);
    return acc;
  }, {});
}

exports.addpersonnel = async (req, res) => {
  const payload = pickPersonnelPayload(normalizePersonnelRequest(req.body));
  const {
    nomComplet,
    email,
    telephone,
    poste,
    typePayement,
    salaire,
    tauxHoraire,
  } = payload;
  const schoolId = req.user.school_id;
  const normalizedEmail = String(email || '').trim().toLowerCase();

  if (!nomComplet || !email || !telephone || !poste) {
    return res.status(400).json({ error: 'les donnees sont invalident' });
  }

  if (typePayement === 'salaire' && (!salaire || Number(salaire) <= 0)) {
    return res.status(400).json({ error: 'les donnees du salaire ne sont pas valident' });
  }

  if (typePayement === 'tauxHoraire' && (!tauxHoraire || Number(tauxHoraire) <= 0)) {
    return res.status(400).json({ error: 'les donnees du taux horaire ne sont pas valident' });
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
    `SELECT * FROM personnels WHERE (lower(trim(email)) = ? OR telephone = ?) AND school_id = ?`,
    [normalizedEmail, telephone, schoolId],
    async (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'erreur serveur' });
      }

      if (row) {
        if (row.email === email) {
          return res.status(400).json({ error: 'Ce personnel existe deja avec cet email' });
        }
        if (row.telephone === telephone) {
          return res.status(400).json({ error: 'Ce personnel existe deja avec ce telephone' });
        }
      }

      const columns = [...personnelColumns, 'school_id'];
      const placeholders = columns.map(() => '?').join(', ');
      const values = [...personnelColumns.map((column) => payloadWithMatricule[column]), schoolId];

      db.run(
        `INSERT INTO personnels (${columns.join(', ')}) VALUES (${placeholders})`,
        values,
        async function(insertErr) {
          if (insertErr) {
            if (handleUniqueConstraint(res, insertErr, 'personnel')) return;
            return res.status(500).json({ error: "echec de l'ajout du personnel" });
          }

          try {
            const account = await createStaffUserAccount({
              schoolId,
              name: nomComplet,
              email: normalizedEmail,
              phone: telephone,
              matricule: payloadWithMatricule.matricule,
              role: resolvePersonnelRole(poste),
            });

            return res.status(201).json({
              message: 'personnel ajoute avec succes',
              id: this.lastID,
              matricule: payloadWithMatricule.matricule,
              compte: {
                email: account.email,
                role: account.role,
                mot_de_passe_genere: account.generatedPassword,
              },
            });
          } catch (accountErr) {
            console.error('Erreur creation compte personnel:', accountErr);
            db.run('DELETE FROM personnels WHERE id = ? AND school_id = ?', [this.lastID, schoolId], () => {
              if (String(accountErr.message || '').includes('UNIQUE') || String(accountErr?.message || '').includes('duplicate key')) {
                return res.status(400).json({ error: 'Un compte utilisateur existe deja avec cet email' });
              }
              return res.status(500).json({ error: 'Personnel non enregistre car la creation du compte a echoue' });
            });
          }
        }
      );
    }
  );
};

exports.getpersonnel = (req, res) => {
  const schoolId = req.user.school_id;

  db.all(`SELECT * FROM personnels WHERE school_id = ?`, [schoolId], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'echec de la recuperation des personnels dans db' });
    }
    res.json((row || []).map(formatPersonnelResponse));
  });
};

exports.getpersonnelById = (req, res) => {
  const schoolId = req.user.school_id;
  const personnelId = req.params.id;

  db.get(`SELECT * FROM personnels WHERE id = ? AND school_id = ?`, [personnelId, schoolId], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'echec de la recuperation du personnel dans db' });
    }
    if (!row) {
      return res.status(404).json({ error: 'personnel non trouve' });
    }
    res.json(formatPersonnelResponse(row));
  });
};

exports.updatepersonnel = async (req, res) => {
  const schoolId = req.user.school_id;
  const personnelId = req.params.id;
  db.get(`SELECT * FROM personnels WHERE id = ? AND school_id = ?`, [personnelId, schoolId], async (fetchErr, existing) => {
    if (fetchErr) {
      return res.status(500).json({ error: 'echec de la recuperation du personnel' });
    }
    if (!existing) {
      return res.status(404).json({ error: 'personnel non trouve' });
    }

    const payload = pickPersonnelPayload(normalizePersonnelRequest(req.body, existing));
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
    const assignments = personnelColumns.map((column) => `${column} = ?`).join(', ');
    const values = [...personnelColumns.map((column) => payloadWithMatricule[column]), personnelId, schoolId];

    db.run(`UPDATE personnels SET ${assignments} WHERE id = ? AND school_id = ?`, values, async function(err) {
      if (err) {
        if (handleUniqueConstraint(res, err, 'personnel')) return;
        return res.status(500).json({ error: 'echec de la mise a jour du personnel' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'personnel non trouve' });
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
          role: resolvePersonnelRole(payloadWithMatricule.poste),
        });
      } catch (accountErr) {
        console.error('Erreur synchronisation compte personnel:', accountErr);
        if (accountErr.message === 'USER_EMAIL_EXISTS') {
          return res.status(400).json({ error: 'Un compte utilisateur existe deja avec ce nouvel email' });
        }
        return res.status(500).json({ error: 'Personnel mis a jour mais synchronisation du compte impossible' });
      }
      res.json({ message: 'personnel mis a jour avec succes' });
    });
  });
};

exports.deletepersonnel = (req, res) => {
  const schoolId = req.user.school_id;
  const personnelId = req.params.id;

  db.get(`SELECT email, matricule FROM personnels WHERE id = ? AND school_id = ?`, [personnelId, schoolId], (fetchErr, existing) => {
    if (fetchErr) {
      return res.status(500).json({ error: 'echec de la lecture du personnel' });
    }

    db.run(`DELETE FROM personnels WHERE id = ? AND school_id = ?`, [personnelId, schoolId], async function(err) {
      if (err) {
        return res.status(500).json({ error: 'echec de la suppression du personnel' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'personnel non trouve' });
      }
      try {
        await deleteStaffUserAccount({
          schoolId,
          email: existing?.email,
          matricule: existing?.matricule,
        });
      } catch (accountErr) {
        console.error('Erreur suppression compte personnel:', accountErr);
      }
      res.json({ message: 'personnel supprime avec succes' });
    });
  });
};
