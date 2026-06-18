const schemaStatements = [
  `
    CREATE TABLE IF NOT EXISTS schools (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      phone TEXT UNIQUE,
      address TEXT,
      plan TEXT DEFAULT 'basic',
      billing TEXT DEFAULT 'monthly',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      current_school_year TEXT,
      daterentrer TEXT,
      is_active INTEGER DEFAULT 1,
      subscription_plan TEXT,
      localisation TEXT,
      code_postal TEXT,
      logo_url TEXT,
      director_name TEXT,
      promoter_name TEXT
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS subscription_plans (
      id BIGSERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      price_monthly INTEGER NOT NULL DEFAULT 0,
      price_annual INTEGER NOT NULL DEFAULT 0,
      annual_discount_percent INTEGER NOT NULL DEFAULT 15,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS saas_subscriptions (
      id BIGSERIAL PRIMARY KEY,
      school_id BIGINT NOT NULL,
      plan_code TEXT NOT NULL,
      amount NUMERIC NOT NULL DEFAULT 0,
      billing_cycle TEXT NOT NULL DEFAULT 'monthly',
      status TEXT NOT NULL DEFAULT 'pending',
      starts_at DATE,
      expires_at DATE,
      notes TEXT,
      validated_at TIMESTAMP,
      validated_by BIGINT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS activity_logs (
      id BIGSERIAL PRIMARY KEY,
      actor_user_id BIGINT,
      school_id BIGINT,
      action TEXT NOT NULL,
      details TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS school_years (
      id BIGSERIAL PRIMARY KEY,
      school_id BIGINT NOT NULL,
      label TEXT NOT NULL,
      start_date DATE,
      end_date DATE,
      is_active INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (school_id, label)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'admin',
      school_id BIGINT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      is_active INTEGER DEFAULT 1,
      phone TEXT,
      matricule TEXT
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS classes (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      cycle TEXT NOT NULL,
      niveau TEXT NOT NULL,
      mensualite NUMERIC NOT NULL DEFAULT 0,
      frais_inscription NUMERIC DEFAULT 0,
      max_effectif INTEGER NOT NULL DEFAULT 0,
      school_id BIGINT,
      effectif INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      annee TEXT
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS eleves (
      id BIGSERIAL PRIMARY KEY,
      matricule TEXT NOT NULL UNIQUE,
      nom TEXT NOT NULL,
      prenom TEXT NOT NULL,
      date_naissance DATE NOT NULL,
      lieu_naissance TEXT,
      sexe TEXT,
      nationalite TEXT DEFAULT 'MALIENNE',
      adresse TEXT,
      telephone_parent TEXT,
      email_parent TEXT,
      nom_parent TEXT,
      profession_parent TEXT,
      classe_actuelle_id BIGINT,
      ecole_actuelle_id BIGINT,
      date_inscription DATE DEFAULT CURRENT_DATE,
      annee_scolaire_id BIGINT,
      photo TEXT,
      statut TEXT DEFAULT 'actif',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      motif_statut TEXT,
      telephone TEXT,
      email TEXT,
      serie TEXT,
      numero_table TEXT,
      classe_precedente TEXT,
      niveau_etude TEXT,
      etablissement_precedent TEXT,
      redoublant TEXT,
      option_etude TEXT,
      groupe_pedagogique TEXT,
      professeur_principal TEXT,
      lien_tuteur TEXT,
      adresse_tuteur TEXT,
      contact_urgence TEXT,
      frais_total NUMERIC,
      montant_paye NUMERIC,
      reste_a_payer NUMERIC,
      reduction NUMERIC,
      etat_paiement TEXT,
      dernier_paiement DATE,
      moyenne_generale NUMERIC,
      rang_eleve INTEGER,
      nombre_matieres INTEGER,
      notes_matieres TEXT,
      appreciations TEXT,
      nombre_absences INTEGER,
      absences_justifiees INTEGER,
      absences_non_justifiees INTEGER,
      retards INTEGER,
      sanctions TEXT,
      comportement TEXT,
      documents TEXT,
      statut_desactive_le TIMESTAMP,
      statut_desactive_par BIGINT,
      exonere_frais_inscription INTEGER DEFAULT 0
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS enseignants (
      id BIGSERIAL PRIMARY KEY,
      matricule TEXT UNIQUE,
      nomComplet TEXT NOT NULL,
      date_naissance DATE,
      lieu_naissance TEXT,
      sexe TEXT,
      nationalite TEXT DEFAULT 'MALIENNE',
      adresse TEXT,
      telephone TEXT UNIQUE,
      email TEXT UNIQUE,
      matiere TEXT NOT NULL,
      typePayement TEXT,
      statut TEXT DEFAULT 'actif',
      salaire NUMERIC,
      tauxHoraire NUMERIC,
      date_embauche DATE DEFAULT CURRENT_DATE,
      annee_scolaire_id BIGINT,
      photo TEXT,
      school_id BIGINT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      niveau_enseignement TEXT,
      departement TEXT,
      specialite TEXT,
      diplomes TEXT,
      niveau_etude TEXT,
      experience_professionnelle TEXT,
      competences TEXT,
      horaires_travail TEXT,
      numero_employe TEXT,
      type_contrat TEXT,
      date_debut_contrat DATE,
      date_fin_contrat DATE,
      temps_travail TEXT,
      nina TEXT,
      inps TEXT,
      references_administratives TEXT,
      documents_identite TEXT,
      diplomes_scannes TEXT,
      contrat_travail TEXT,
      cv TEXT,
      attestations TEXT,
      date_prise_service DATE,
      prime NUMERIC,
      indemnites NUMERIC,
      mode_paiement TEXT,
      historique_salaires TEXT,
      avances_salaire NUMERIC,
      retenues NUMERIC,
      regle_paiement_partiel TEXT,
      montant_creneau NUMERIC,
      montant_forfait_trimestre NUMERIC,
      echeance_paiement TEXT,
      bulletins_paie TEXT,
      etat_paiements TEXT,
      presences TEXT,
      absences INTEGER,
      retards INTEGER,
      permissions INTEGER,
      conges TEXT,
      sanctions_disciplinaires TEXT,
      historique_pointages TEXT,
      observations_administratives TEXT,
      contact_urgence_nom TEXT,
      contact_urgence_lien TEXT,
      contact_urgence_telephone TEXT,
      contact_urgence_adresse TEXT,
      documents TEXT,
      matieres_enseignees TEXT,
      classes_affectees TEXT,
      volume_horaire TEXT,
      emploi_du_temps TEXT,
      professeur_principal TEXT,
      nombre_eleves_suivis INTEGER,
      historique_affectations TEXT,
      resultats_classes TEXT,
      absences_enseignant INTEGER,
      observations_pedagogiques TEXT,
      type_payement TEXT,
      salaire_base NUMERIC,
      status TEXT,
      type_personnel TEXT,
      taux_horaire NUMERIC,
      situation_matrimoniale TEXT
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS personnels (
      id BIGSERIAL PRIMARY KEY,
      matricule TEXT UNIQUE,
      nomComplet TEXT NOT NULL,
      date_naissance DATE,
      lieu_naissance TEXT,
      sexe TEXT,
      nationalite TEXT DEFAULT 'MALIENNE',
      adresse TEXT,
      telephone TEXT UNIQUE,
      email TEXT UNIQUE,
      poste TEXT NOT NULL,
      typePayement TEXT,
      statut TEXT DEFAULT 'actif',
      salaire NUMERIC,
      tauxHoraire NUMERIC,
      date_embauche DATE DEFAULT CURRENT_DATE,
      annee_scolaire_id BIGINT,
      photo TEXT,
      school_id BIGINT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      situation_matrimoniale TEXT,
      type_personnel TEXT,
      departement TEXT,
      specialite TEXT,
      diplomes TEXT,
      niveau_etude TEXT,
      experience_professionnelle TEXT,
      competences TEXT,
      horaires_travail TEXT,
      numero_employe TEXT,
      type_contrat TEXT,
      date_debut_contrat DATE,
      date_fin_contrat DATE,
      temps_travail TEXT,
      nina TEXT,
      inps TEXT,
      references_administratives TEXT,
      documents_identite TEXT,
      diplomes_scannes TEXT,
      contrat_travail TEXT,
      cv TEXT,
      attestations TEXT,
      date_prise_service DATE,
      prime NUMERIC,
      indemnites NUMERIC,
      mode_paiement TEXT,
      historique_salaires TEXT,
      avances_salaire NUMERIC,
      retenues NUMERIC,
      regle_paiement_partiel TEXT,
      montant_creneau NUMERIC,
      montant_forfait_trimestre NUMERIC,
      echeance_paiement TEXT,
      bulletins_paie TEXT,
      etat_paiements TEXT,
      presences TEXT,
      absences INTEGER,
      retards INTEGER,
      permissions INTEGER,
      conges TEXT,
      sanctions_disciplinaires TEXT,
      historique_pointages TEXT,
      observations_administratives TEXT,
      contact_urgence_nom TEXT,
      contact_urgence_lien TEXT,
      contact_urgence_telephone TEXT,
      contact_urgence_adresse TEXT,
      documents TEXT,
      type_payement TEXT,
      salaire_base NUMERIC,
      taux_horaire NUMERIC,
      full_name TEXT,
      role TEXT
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS matieres (
      id BIGSERIAL PRIMARY KEY,
      nom TEXT NOT NULL,
      description TEXT,
      coefficient NUMERIC DEFAULT 1,
      school_id BIGINT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS affectation (
      id BIGSERIAL PRIMARY KEY,
      school_id BIGINT,
      school_year_id BIGINT,
      nom_matiere TEXT NOT NULL,
      enseignant_id TEXT NOT NULL,
      classe_id TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS paiements (
      id BIGSERIAL PRIMARY KEY,
      school_id BIGINT NOT NULL,
      eleve_id BIGINT,
      eleve_matricule TEXT,
      montant NUMERIC NOT NULL,
      mois TEXT,
      date_payement DATE,
      mode_payement TEXT,
      annee_scolaire TEXT,
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      school_year_id BIGINT
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS depenses (
      id BIGSERIAL PRIMARY KEY,
      school_id BIGINT NOT NULL,
      categorie TEXT,
      description TEXT,
      motif TEXT NOT NULL,
      montant NUMERIC NOT NULL,
      date_depenses DATE,
      valide_par TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      school_year_id BIGINT
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS salaires (
      id BIGSERIAL PRIMARY KEY,
      school_id BIGINT NOT NULL,
      personnel_matricule TEXT,
      source_type TEXT DEFAULT 'personnel',
      mois TEXT,
      montant NUMERIC NOT NULL,
      mode_payement TEXT,
      date_payement DATE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      school_year_id BIGINT
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS retraits_promoteur (
      id BIGSERIAL PRIMARY KEY,
      school_id BIGINT NOT NULL,
      montant NUMERIC NOT NULL,
      date_retrait DATE,
      motif TEXT,
      valide_par TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      school_year_id BIGINT
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS emplois (
      id BIGSERIAL PRIMARY KEY,
      school_id BIGINT NOT NULL,
      affectation_id BIGINT,
      jour TEXT NOT NULL,
      heure_debut TEXT NOT NULL,
      heure_fin TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      school_year_id BIGINT
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS trimestres (
      id BIGSERIAL PRIMARY KEY,
      school_id BIGINT NOT NULL,
      school_year_id BIGINT NOT NULL,
      school_year_label TEXT,
      code TEXT NOT NULL,
      label TEXT NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      is_validated INTEGER NOT NULL DEFAULT 0,
      validated_at TIMESTAMP,
      validated_by BIGINT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (school_id, school_year_id, code)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS school_calendar_days (
      id BIGSERIAL PRIMARY KEY,
      school_id BIGINT NOT NULL,
      date_value DATE NOT NULL,
      label TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'holiday',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS trimestre_workloads (
      id BIGSERIAL PRIMARY KEY,
      school_id BIGINT NOT NULL,
      trimestre_id BIGINT NOT NULL,
      affectation_id BIGINT,
      classe_id BIGINT,
      classe_nom TEXT,
      matiere TEXT NOT NULL,
      enseignant_id BIGINT,
      enseignant_nom TEXT,
      source_hours NUMERIC NOT NULL DEFAULT 0,
      source_slots INTEGER NOT NULL DEFAULT 0,
      adjusted_hours NUMERIC NOT NULL DEFAULT 0,
      adjusted_slots INTEGER NOT NULL DEFAULT 0,
      adjusted_enseignant_id BIGINT,
      adjusted_enseignant_nom TEXT,
      adjustment_reason TEXT,
      payment_rule TEXT,
      payment_schedule TEXT,
      hourly_rate NUMERIC,
      slot_rate NUMERIC,
      forfait_amount NUMERIC,
      forecast_amount NUMERIC NOT NULL DEFAULT 0,
      is_manual_override INTEGER NOT NULL DEFAULT 0,
      is_validated INTEGER NOT NULL DEFAULT 0,
      validated_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS notes (
      id BIGSERIAL PRIMARY KEY,
      school_id BIGINT NOT NULL,
      eleve_id BIGINT,
      eleve_matricule TEXT NOT NULL,
      matiere TEXT NOT NULL,
      trimestre TEXT NOT NULL,
      note NUMERIC NOT NULL,
      annee TEXT,
      note_type TEXT DEFAULT 'devoir',
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      school_year_id BIGINT
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS absences (
      id BIGSERIAL PRIMARY KEY,
      school_id BIGINT NOT NULL,
      eleve_id BIGINT NOT NULL,
      date DATE NOT NULL,
      type TEXT DEFAULT 'absence',
      justifie INTEGER DEFAULT 0,
      motif TEXT,
      duree_minutes INTEGER,
      enseignant_id BIGINT,
      school_year_id BIGINT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS teacher_absences (
      id BIGSERIAL PRIMARY KEY,
      school_id BIGINT NOT NULL,
      teacher_id BIGINT NOT NULL,
      date DATE NOT NULL,
      heure_debut TEXT,
      heure_fin TEXT,
      type TEXT DEFAULT 'absence',
      justifie INTEGER DEFAULT 0,
      motif TEXT,
      school_year_id BIGINT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS transfers (
      id BIGSERIAL PRIMARY KEY,
      school_id BIGINT NOT NULL,
      eleve_id BIGINT NOT NULL,
      matricule TEXT NOT NULL,
      from_classe_id BIGINT,
      to_classe_id BIGINT,
      status TEXT NOT NULL DEFAULT 'pending',
      reason TEXT,
      requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      responded_at TIMESTAMP,
      transfer_type TEXT DEFAULT 'internal',
      to_school_id BIGINT
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS notifications (
      id BIGSERIAL PRIMARY KEY,
      school_id BIGINT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      entity_type TEXT,
      entity_ref TEXT,
      metadata TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      read_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      unique_key TEXT
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS sync_state (
      table_name TEXT PRIMARY KEY,
      last_pulled_at TEXT
    )
  `,
];

const indexStatements = [
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_school_unique_key ON notifications (school_id, unique_key) WHERE NULLIF(BTRIM(COALESCE(unique_key, '')), '') IS NOT NULL",
  'CREATE INDEX IF NOT EXISTS idx_saas_subscriptions_school_created ON saas_subscriptions (school_id, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_activity_logs_school_created ON activity_logs (school_id, created_at DESC)',
];

async function ensureInscriptionPaymentGuard(db) {
  await db.query(`
    CREATE OR REPLACE FUNCTION prevent_inscription_payment_for_exempt_students_fn()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF LOWER(COALESCE(NEW.mois, '')) = 'inscription'
         AND NEW.eleve_id IS NOT NULL
         AND EXISTS (
           SELECT 1
           FROM eleves e
           WHERE e.id = NEW.eleve_id
             AND COALESCE(e.exonere_frais_inscription, 0) = 1
         )
      THEN
        RAISE EXCEPTION 'INSCRIPTION_FEE_WAIVED';
      END IF;
      RETURN NEW;
    END;
    $$;
  `);

  await db.query('DROP TRIGGER IF EXISTS prevent_inscription_payment_for_exempt_students ON paiements');
  await db.query(`
    CREATE TRIGGER prevent_inscription_payment_for_exempt_students
    BEFORE INSERT ON paiements
    FOR EACH ROW
    EXECUTE FUNCTION prevent_inscription_payment_for_exempt_students_fn()
  `);

  await db.query('DROP TRIGGER IF EXISTS prevent_inscription_payment_update_for_exempt_students ON paiements');
  await db.query(`
    CREATE TRIGGER prevent_inscription_payment_update_for_exempt_students
    BEFORE UPDATE OF mois, eleve_id ON paiements
    FOR EACH ROW
    EXECUTE FUNCTION prevent_inscription_payment_for_exempt_students_fn()
  `);
}

async function ensureBigIntColumn(db, tableName, columnName) {
  const column = await db.query(
    `SELECT data_type
       FROM information_schema.columns
      WHERE table_name = $1
        AND column_name = $2
      LIMIT 1`,
    [tableName, columnName]
  );

  const currentType = String(column?.rows?.[0]?.data_type || '').toLowerCase();
  if (!currentType || currentType === 'bigint' || currentType === 'integer' || currentType === 'smallint') {
    return;
  }

  await db.query(
    `ALTER TABLE ${tableName}
       ALTER COLUMN ${columnName}
       TYPE BIGINT
       USING CASE
         WHEN ${columnName} IS NULL OR BTRIM(${columnName}::text) = '' THEN NULL
         WHEN ${columnName}::text ~ '^[0-9]+$' THEN ${columnName}::bigint
         ELSE NULL
       END`
  );
}

async function ensurePostgresSchema(db) {
  if (!db || typeof db.query !== 'function') {
    throw new Error('A client with a query() method is required to initialise the PostgreSQL schema');
  }

  try {
    for (const statement of schemaStatements) {
      await db.query(statement);
    }

    for (const statement of indexStatements) {
      await db.query(statement);
    }

    await ensureBigIntColumn(db, 'affectation', 'enseignant_id');
    await ensureBigIntColumn(db, 'affectation', 'classe_id');

    await ensureInscriptionPaymentGuard(db);
  } catch (error) {
    throw error;
  }
}

module.exports = {
  ensurePostgresSchema,
};
