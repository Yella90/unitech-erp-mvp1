const bcrypt = require('bcryptjs');
const db = require('../database/db');
const { computeStudentFinanceSummary } = require('../utils/financeCalculations');


const eleveColumns = [
  'matricule',
  'nom',
  'prenom',
  'date_naissance',
  'lieu_naissance',
  'sexe',
  'nationalite',
  'adresse',
  'telephone',
  'email',
  'telephone_parent',
  'email_parent',
  'nom_parent',
  'profession_parent',
  'lien_tuteur',
  'adresse_tuteur',
  'contact_urgence',
  'classe_actuelle_id',
  'date_inscription',
  'annee_scolaire_id',
  'photo',
  'statut',
  'serie',
  'numero_table',
  'classe_precedente',
  'niveau_etude',
  'etablissement_precedent',
  'redoublant',
  'option_etude',
  'groupe_pedagogique',
  'professeur_principal',
  'frais_total',
  'montant_paye',
  'reste_a_payer',
  'reduction',
  'etat_paiement',
  'dernier_paiement',
  'moyenne_generale',
  'rang_eleve',
  'nombre_matieres',
  'notes_matieres',
  'appreciations',
  'nombre_absences',
  'absences_justifiees',
  'absences_non_justifiees',
  'retards',
  'sanctions',
  'comportement',
  'documents',
];

function normalizeOptionalValue(value) {
  if (Array.isArray(value) || (value && typeof value === 'object')) {
    return JSON.stringify(value);
  }
  if (value === undefined) return null;
  return value;
}
function decrementClassEffectif(classId, schoolId, callback) {
  db.run(
    `UPDATE classes
      SET effectif = COALESCE(effectif, 0) - 1
      WHERE id = ? AND school_id = ? AND effectif > 0`,
    [classId, schoolId],
    function(err) {
      if (err) {
        return callback(err);
      }
      if (this.changes === 0) {
        // Aucune ligne mise à jour, peut-être car effectif était déjà 0
        return callback(null, { changes: 0, message: 'Aucun changement, effectif déjà à 0 ou classe introuvable' });
      }
      callback(null, { changes: this.changes });
    }
  );
}
function pickElevePayload(body) {
  return eleveColumns.reduce((acc, column) => {
    acc[column] = normalizeOptionalValue(body[column]);
    return acc;
  }, {});
}

function generateMatricule(nom, prenom) {
  const timestamp = Date.now().toString().slice(-6);
  const randomNum = Math.floor(Math.random() * 900) + 100;
  const nomPart = String(nom || '').substring(0, 3).toUpperCase().padEnd(3, 'X');
  const prenomPart = String(prenom || '').substring(0, 3).toUpperCase().padEnd(3, 'X');
  return `${nomPart}${prenomPart}${timestamp}${randomNum}`;
}

function incrementClassEffectif(classId, schoolId, callback) {
  db.run(
    `UPDATE classes
     SET effectif = COALESCE(effectif, 0) + 1
     WHERE id = ? AND school_id = ?`,
    [classId, schoolId],
    callback
  );
}
exports.incrementClassEffectif = incrementClassEffectif;

exports.addEleve = (req, res) => {
  const schoolId = req.user.school_id;
  const payload = pickElevePayload({
    ...req.body,
    nom_parent: req.body.nom_parent || req.body.nomparent,
    telephone_parent: req.body.telephone_parent || req.body.contactparent,
  });

  payload.matricule = payload.matricule || generateMatricule(payload.nom, payload.prenom);

  if (!payload.nom || !payload.prenom || !payload.date_naissance || !payload.classe_actuelle_id || !schoolId) {
    return res.status(400).json({ error: 'Tous les champs obligatoires doivent etre remplis' });
  }

  db.get(
    'SELECT id, name, frais_inscription FROM classes WHERE id = ? AND school_id = ?',
    [payload.classe_actuelle_id, schoolId],
    (classErr, classe) => {
      if (classErr) {
        console.error("Erreur lors de la recuperation de la classe:", classErr);
        return res.status(500).json({ error: 'Erreur serveur' });
      }
      if (!classe) {
        return res.status(404).json({ error: 'Classe introuvable' });
      }

      const fraisInscription = Number(classe.frais_inscription || 0);
      payload.frais_total = payload.frais_total ?? fraisInscription;
      payload.montant_paye = payload.montant_paye ?? fraisInscription;
      payload.reste_a_payer = payload.reste_a_payer ?? Math.max(Number(payload.frais_total || fraisInscription) - Number(payload.montant_paye || fraisInscription), 0);
      payload.etat_paiement = payload.etat_paiement || (payload.reste_a_payer > 0 ? 'partiel' : 'paye');
      payload.dernier_paiement = payload.dernier_paiement || new Date().toISOString().slice(0, 10);

      db.run(
        `INSERT INTO eleves (${eleveColumns.join(', ')}, ecole_actuelle_id)
         VALUES (${eleveColumns.map(() => '?').join(', ')}, ?)`,
        [...eleveColumns.map((column) => payload[column]), schoolId],
        function(err) {
          if (err) {
            console.error("Erreur lors de l'ajout de l'eleve:", err);
            return res.status(500).json({ error: 'Erreur serveur' });
          }

          const eleveId = this.lastID;
          incrementClassEffectif(payload.classe_actuelle_id, schoolId, (effectifErr) => {
            if (effectifErr) {
              console.error("Erreur lors de la mise a jour de l'effectif de la classe:", effectifErr);
              return res.status(500).json({ error: 'Eleve ajoute mais effectif de classe non mis a jour' });
            }

            if (fraisInscription <= 0) {
              return res.status(201).json({ message: 'Eleve ajoute avec succes', eleveId });
            }

            db.get('SELECT current_school_year FROM schools WHERE id = ?', [schoolId], (schoolErr, schoolRow) => {
              if (schoolErr) {
                console.error("Erreur lors de la recuperation de l'annee scolaire:", schoolErr);
                return res.status(201).json({
                  message: 'Eleve ajoute avec succes, mais la recette d inscription n a pas ete enregistree',
                  eleveId,
                });
              }

              db.run(
                `INSERT INTO paiements
                 (school_id, eleve_id, eleve_matricule, montant, mois, date_payement, mode_payement, annee_scolaire, description)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  schoolId,
                  eleveId,
                  payload.matricule,
                  fraisInscription,
                  'inscription',
                  new Date().toISOString().slice(0, 10),
                  'inscription',
                  schoolRow?.current_school_year || null,
                  `Frais d'inscription - ${classe.name}`,
                ],
                (paymentErr) => {
                  if (paymentErr) {
                    console.error("Erreur lors de l'enregistrement de la recette d'inscription:", paymentErr);
                    return res.status(201).json({
                      message: 'Eleve ajoute avec succes, mais la recette d inscription n a pas ete enregistree',
                      eleveId,
                    });
                  }

                  return res.status(201).json({
                    message: 'Eleve ajoute avec succes et frais d inscription enregistres en recette',
                    eleveId,
                  });
                }
              );
            });
          });
        }
      );
    }
  );
};

exports.getEleves = (req, res) => {
  const schoolId = req.user.school_id;
  db.all('SELECT * FROM eleves WHERE ecole_actuelle_id = ?', [schoolId], (err, eleves) => {
    if (err) {
      console.error("Erreur lors de la recuperation des eleves:", err);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
    res.json(eleves);
  });
};

exports.getEleveById = (req, res) => {
  const schoolId = req.user.school_id;
  const eleveId = req.params.id;
  db.get(
    `SELECT
       e.*,
       c.mensualite AS mensualite_classe,
       COALESCE(p.total_verse, e.montant_paye, 0) AS total_verse,
       COALESCE(p.total_hors_inscription, 0) AS total_verse_hors_inscription,
       CASE
         WHEN COALESCE(c.mensualite, 0) > 0
           THEN CAST(COALESCE(p.total_hors_inscription, 0) / c.mensualite AS INTEGER)
         ELSE 0
       END AS mois_couverts,
       COALESCE(p.dernier_paiement_calcule, e.dernier_paiement) AS dernier_paiement_calcule
     FROM eleves e
     LEFT JOIN classes c ON c.id = e.classe_actuelle_id
     LEFT JOIN (
       SELECT
         eleve_id,
         SUM(montant) AS total_verse,
         SUM(CASE WHEN LOWER(COALESCE(mois, '')) <> 'inscription' THEN montant ELSE 0 END) AS total_hors_inscription,
         MAX(COALESCE(date_payement, created_at)) AS dernier_paiement_calcule
       FROM paiements
     WHERE school_id = ?
     GROUP BY eleve_id
     ) p ON p.eleve_id = e.id
     WHERE e.id = ? AND e.ecole_actuelle_id = ?`,
    [schoolId, eleveId, schoolId],
    (err, eleve) => {
      if (err) {
        console.error("Erreur lors de la recuperation de l'eleve:", err);
        return res.status(500).json({ error: 'Erreur serveur' });
      }
      if (!eleve) {
        return res.status(404).json({ error: 'Eleve non trouve' });
      }
      const mensualite = Number(eleve.mensualite_classe || 0);
      const totalVerseHorsInscription = Number(eleve.total_verse_hors_inscription || 0);
      const reduction = Number(eleve.reduction || 0);
      const dateDebut = eleve.date_inscription || eleve.created_at;
      const financeSummary = computeStudentFinanceSummary({
        mensualite,
        reduction,
        totalVerseHorsInscription,
        dateInscription: dateDebut,
        currentDate: new Date(),
      });
      res.json({
        ...eleve,
        mois_couverts: financeSummary.moisCouverts,
        reste_a_payer: financeSummary.resteAPayer,
        etat_paiement: financeSummary.etatPaiement,
        total_mensualites_dues: financeSummary.totalMensualitesDues,
        total_mensualites_nettes: financeSummary.mensualitesNettes,
      });
    }
  );
};

exports.updateEleve = (req, res) => {
  const schoolId = req.user.school_id;
  const eleveId = req.params.id;
  const payload = pickElevePayload({
    ...req.body,
    nom_parent: req.body.nom_parent || req.body.nomparent,
    telephone_parent: req.body.telephone_parent || req.body.contactparent,
  });
  payload.matricule = payload.matricule || generateMatricule(payload.nom, payload.prenom);

  const assignments = eleveColumns.map((column) => `${column} = ?`).join(', ');
  const values = [...eleveColumns.map((column) => payload[column]), eleveId, schoolId];

  db.run(
    `UPDATE eleves
     SET ${assignments}, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND ecole_actuelle_id = ?`,
    values,
    function(err) {
      if (err) {
        console.error("Erreur lors de la mise a jour de l'eleve:", err);
        return res.status(500).json({ error: 'Erreur serveur' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Eleve non trouve ou pas modifie' });
      }
      res.json({ message: 'Eleve mis a jour avec succes' });
    }
  );
};

exports.deactivateEleve = (req, res) => {
  const schoolId = req.user.school_id;
  const userId = req.user.id;
  const eleveId = req.params.id;
  const statusReason = String(req.body?.statusReason || '').trim();
  const statusReasonDetails = String(req.body?.statusReasonDetails || '').trim();
  const motifStatut = statusReasonDetails ? `${statusReason} - ${statusReasonDetails}` : statusReason;

  if (!req.body?.currentPassword) {
    return res.status(400).json({ error: 'Mot de passe requis pour confirmer la desactivation' });
  }

  if (!statusReason) {
    return res.status(400).json({ error: 'Le motif de desactivation est requis' });
  }

  db.get('SELECT id, password FROM users WHERE id = ? AND school_id = ?', [userId, schoolId], (userErr, user) => {
    if (userErr) {
      console.error("Erreur lors de la verification de l'utilisateur:", userErr);
      return res.status(500).json({ error: 'Erreur serveur' });
    }

    if (!user || !bcrypt.compareSync(String(req.body.currentPassword), user.password)) {
      return res.status(401).json({ error: 'Mot de passe incorrect' });
    }

    db.get(
      'SELECT * FROM eleves WHERE id = ? AND ecole_actuelle_id = ?',
      [eleveId, schoolId],
      (eleveErr, eleve) => {
        if (eleveErr) {
          console.error("Erreur lors de la recherche de l'eleve:", eleveErr);
          return res.status(500).json({ error: 'Erreur serveur' });
        }

        if (!eleve) {
          return res.status(404).json({ error: 'Eleve non trouve ou pas autorise' });
        }

        db.run(
          `UPDATE eleves
           SET statut = ?, motif_statut = ?, statut_desactive_par = ?, statut_desactive_le = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND ecole_actuelle_id = ?`,
          ['exclu', motifStatut, userId, eleveId, schoolId],
          function(err) {
            if (err) {
              console.error("Erreur lors de la desactivation de l'eleve:", err);
              return res.status(500).json({ error: 'Erreur serveur' });
            }

            if (this.changes === 0) {
              return res.status(404).json({ error: 'Eleve non trouve ou pas autorise' });
            }
            //update the class effectif
            console.log('classe_actuelle_id:', eleve.classe_actuelle_id, 'schoolId:', schoolId);
          decrementClassEffectif(eleve.classe_actuelle_id, schoolId, (effectifErr) => {
            if (effectifErr) {
              console.error("Erreur lors de la mise a jour de l'effectif de la classe:", effectifErr);
              return res.status(500).json({ error: 'Eleve desactive mais effectif de classe non mis a jour' });
            }})
            return res.json({
              message: `Eleve desactive avec succes: ${eleve.nom || ''} ${eleve.prenom || ''}`.trim(),
              statut: 'exclu',
              motif_statut: motifStatut,
            });
          }
        );
      }
    );
  });
};
