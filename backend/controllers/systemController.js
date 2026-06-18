const db = require('../database/db');
const bcrypt = require('bcryptjs');
const { normalizeRole, isSuperAdminRole } = require('../middleware/authMiddleware');
const { computeStudentFinanceSummary } = require('../utils/financeCalculations');
const { buildSubscriptionAccessStatus } = require('../utils/subscriptionAccess');
const { computeInscriptionForecast } = require('../utils/inscriptionForecast');


function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const allowedUserRoles = new Set(['directeur', 'promoteur', 'comptable', 'secretaire', 'censeur', 'surveillant', 'enseignant', 'personnel']);

async function ensureUniqueUserEmail(email, schoolId, ignoreUserId = null) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error('EMAIL_REQUIRED');
  }

  const query = ignoreUserId
    ? 'SELECT id FROM users WHERE lower(trim(email)) = ? AND school_id = ? AND id != ?'
    : 'SELECT id FROM users WHERE lower(trim(email)) = ? AND school_id = ?';
  const params = ignoreUserId ? [normalizedEmail, schoolId, ignoreUserId] : [normalizedEmail, schoolId];
  const row = await get(query, params);
  if (row) {
    throw new Error('USER_EMAIL_EXISTS');
  }
  return normalizedEmail;
}

async function addActivityLog(schoolId, actorUserId, action, details) {
  try {
    await run(
      'INSERT INTO activity_logs (actor_user_id, school_id, action, details) VALUES (?, ?, ?, ?)',
      [actorUserId || null, schoolId || null, action, details ? JSON.stringify(details) : null]
    );
  } catch (error) {
    console.error('Erreur activity log:', error);
  }
}

function monthKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function normalizeMonthValue(value, fallback = monthKey()) {
  const raw = String(value || '').trim();
  return /^\d{4}-\d{2}$/.test(raw) ? raw : fallback;
}

function parseDateOnly(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function formatDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseHoursValue(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  const raw = String(value).trim();
  if (!raw) return 0;

  const decimal = Number(raw.replace(',', '.'));
  if (Number.isFinite(decimal)) return decimal;

  const hoursMatch = raw.match(/^(\d{1,3}):(\d{2})$/);
  if (hoursMatch) {
    const hours = Number(hoursMatch[1]);
    const minutes = Number(hoursMatch[2]);
    if (Number.isFinite(hours) && Number.isFinite(minutes)) {
      return hours + (minutes / 60);
    }
  }

  return 0;
}

function extractHoursFromPayload(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number' || typeof value === 'string') {
    return parseHoursValue(value);
  }
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + extractHoursFromPayload(item), 0);
  }
  if (typeof value === 'object') {
    const hourKeys = new Set([
      'hours',
      'hour',
      'heures',
      'heure',
      'duree',
      'duration',
      'duration_hours',
      'worked_hours',
      'total_hours',
      'volume_horaire',
      'temps_travail',
    ]);
    return Object.entries(value).reduce((sum, [key, item]) => {
      if (hourKeys.has(String(key).toLowerCase())) {
        return sum + extractHoursFromPayload(item);
      }
      if (item && typeof item === 'object') {
        return sum + extractHoursFromPayload(item);
      }
      return sum;
    }, 0);
  }
  return 0;
}

function buildSalaryIdentity(sourceType, matricule, month) {
  return `${String(sourceType || 'personnel').trim().toLowerCase()}:${String(matricule || '').trim().toLowerCase()}:${normalizeMonthValue(month)}`;
}

function resolveSalarySourceType(sourceType) {
  const raw = String(sourceType || '').trim().toLowerCase();
  if (['enseignant', 'teacher', 'professeur'].includes(raw)) return 'enseignant';
  return 'personnel';
}

function countMatchingDates(startDate, endDate, dayIndex, excludedDates) {
  if (!(startDate instanceof Date) || !(endDate instanceof Date)) return 0;
  const current = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());

  let total = 0;
  while (current <= end) {
    const isoDate = formatDate(current);
    if (current.getDay() === dayIndex && !excludedDates.has(isoDate)) {
      total += 1;
    }
    current.setDate(current.getDate() + 1);
  }
  return total;
}

function computeDurationHours(start, end) {
  if (!start || !end) return 0;
  const [startH = 0, startM = 0] = String(start).split(':').map(Number);
  const [endH = 0, endM = 0] = String(end).split(':').map(Number);
  const totalMinutes = (endH * 60 + endM) - (startH * 60 + startM);
  return totalMinutes > 0 ? totalMinutes / 60 : 0;
}

async function getSalaryStaffRow(schoolId, sourceType, matricule) {
  const normalizedSourceType = resolveSalarySourceType(sourceType);
  const tableName = normalizedSourceType === 'enseignant' ? 'enseignants' : 'personnels';
  const statusExpression = tableName === 'enseignants' ? "COALESCE(status, statut, 'actif')" : "COALESCE(statut, 'actif')";
  const hoursColumns = tableName === 'enseignants'
    ? "COALESCE(volume_horaire, '') AS volume_horaire, COALESCE(temps_travail, '') AS temps_travail, COALESCE(historique_pointages, '') AS historique_pointages"
    : "COALESCE(temps_travail, '') AS temps_travail, COALESCE(historique_pointages, '') AS historique_pointages";
  return get(
    `SELECT id, matricule, nomComplet, COALESCE(salaire, salaire_base, 0) AS salaire_base,
            COALESCE(tauxHoraire, taux_horaire, 0) AS taux_horaire,
            COALESCE(typePayement, type_payement, '') AS type_payement,
            ${statusExpression} AS statut,
            ${hoursColumns}
       FROM ${tableName}
      WHERE school_id = ?
        AND lower(trim(matricule)) = lower(trim(?))
      LIMIT 1`,
    [schoolId, matricule || '']
  );
}

async function computeTeacherMonthlyHours(schoolId, teacherId, monthValue) {
  const range = monthRange(monthValue);
  if (!range) return 0;

  const [holidayRows, emploiRows, absenceRows] = await Promise.all([
    all(
      'SELECT date_value FROM school_calendar_days WHERE school_id = ? AND date_value BETWEEN ? AND ?',
      [schoolId, range.start, range.end]
    ),
    all(
      `SELECT em.jour, em.heure_debut, em.heure_fin
         FROM emplois em
         INNER JOIN affectation a ON a.id = em.affectation_id
        WHERE em.school_id = ?
          AND a.school_id = ?
          AND a.enseignant_id = ?`,
      [schoolId, schoolId, teacherId]
    ),
    all(
      `SELECT date, heure_debut, heure_fin
         FROM teacher_absences
        WHERE school_id = ?
          AND teacher_id = ?
          AND date BETWEEN ? AND ?`,
      [schoolId, teacherId, range.start, range.end]
    ),
  ]);

  const excludedDates = new Set((holidayRows || []).map((row) => row.date_value));
  const startDate = parseDateOnly(range.start);
  const endDate = parseDateOnly(range.end);
  if (!startDate || !endDate) return 0;
  const absenceMap = buildTeacherAbsenceMap(absenceRows);

  const dayIndexByLabel = {
    Lundi: 1,
    Mardi: 2,
    Mercredi: 3,
    Jeudi: 4,
    Vendredi: 5,
    Samedi: 6,
    Dimanche: 0,
  };

  const totalHours = (emploiRows || []).reduce((sum, row) => {
    const dayIndex = dayIndexByLabel[row.jour];
    if (dayIndex === undefined) return sum;
    const durationHours = computeDurationHours(row.heure_debut, row.heure_fin) || 1;
    const durationMinutes = Math.max(1, Math.round(durationHours * 60));
    const scheduleStartMinutes = normalizeTimeValue(row.heure_debut, '00:00') || 0;
    const scheduleEndMinutes = scheduleStartMinutes + durationMinutes;
    let rowHours = 0;
    const current = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    while (current <= endDate) {
      const isoDate = formatDate(current);
      if (current.getDay() === dayIndex && !excludedDates.has(isoDate)) {
        const intervals = absenceMap.get(isoDate) || [];
        const absenceMinutes = intervals.length
          ? computeOverlapMinutes(scheduleStartMinutes, scheduleEndMinutes, intervals)
          : 0;
        rowHours += Math.max(0, durationMinutes - absenceMinutes) / 60;
      }
      current.setDate(current.getDate() + 1);
    }
    return sum + rowHours;
  }, 0);

  return Number(totalHours.toFixed(2));
}

function countTrimesterOccurrences(startDate, endDate, dayIndex, excludedDates, todayStart) {
  if (!(startDate instanceof Date) || !(endDate instanceof Date)) {
    return {
      totalSlots: 0,
      passedSlots: 0,
      remainingSlots: 0,
    };
  }

  const current = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  const today = todayStart instanceof Date ? todayStart : new Date();
  today.setHours(0, 0, 0, 0);

  let totalSlots = 0;
  let passedSlots = 0;

  while (current <= end) {
    const isoDate = formatDate(current);
    if (current.getDay() === dayIndex && !excludedDates.has(isoDate)) {
      totalSlots += 1;
      if (current < today) {
        passedSlots += 1;
      }
    }
    current.setDate(current.getDate() + 1);
  }

  return {
    totalSlots,
    passedSlots,
    remainingSlots: Math.max(0, totalSlots - passedSlots),
  };
}

function listTrimesterOccurrenceDates(startDate, endDate, dayIndex, excludedDates) {
  if (!(startDate instanceof Date) || !(endDate instanceof Date)) return [];
  const current = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  const dates = [];

  while (current <= end) {
    const isoDate = formatDate(current);
    if (current.getDay() === dayIndex && !excludedDates.has(isoDate)) {
      dates.push(isoDate);
    }
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

function mergeMinuteIntervals(intervals) {
  const cleaned = (intervals || [])
    .map((item) => ({
      start: Math.max(0, Number(item?.start || 0)),
      end: Math.max(0, Number(item?.end || 0)),
    }))
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)
    .sort((a, b) => a.start - b.start);

  if (!cleaned.length) return [];

  const merged = [cleaned[0]];
  for (let index = 1; index < cleaned.length; index += 1) {
    const current = cleaned[index];
    const previous = merged[merged.length - 1];
    if (current.start <= previous.end) {
      previous.end = Math.max(previous.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

function buildTeacherAbsenceMap(absenceRows) {
  const map = new Map();

  for (const row of absenceRows || []) {
    const dateValue = normalizeDateInput(row.date);
    if (!dateValue) continue;
    const start = normalizeTimeValue(row.heure_debut, '00:00');
    const end = normalizeTimeValue(row.heure_fin, '23:59');
    const startMinutes = start === null ? 0 : start;
    const endMinutes = end === null ? (24 * 60) - 1 : end;
    const existing = map.get(dateValue) || [];
    existing.push({
      start: startMinutes,
      end: endMinutes > startMinutes ? endMinutes : (24 * 60),
      row,
    });
    map.set(dateValue, existing);
  }

  for (const [dateValue, intervals] of map.entries()) {
    map.set(dateValue, mergeMinuteIntervals(intervals));
  }

  return map;
}

function computeOverlapMinutes(slotStart, slotEnd, intervals) {
  if (!Number.isFinite(slotStart) || !Number.isFinite(slotEnd) || slotEnd <= slotStart) return 0;
  return (intervals || []).reduce((sum, interval) => {
    const overlapStart = Math.max(slotStart, Number(interval.start || 0));
    const overlapEnd = Math.min(slotEnd, Number(interval.end || 0));
    return sum + Math.max(0, overlapEnd - overlapStart);
  }, 0);
}

async function loadSalaryGenerationCandidates({ schoolId, month, mode }) {
  const normalizedMonth = normalizeMonthValue(month);
  const [personnels, enseignants] = await Promise.all([
    all(
      `SELECT id, matricule, nomComplet, COALESCE(salaire, salaire_base, 0) AS salaire_base,
              COALESCE(tauxHoraire, taux_horaire, 0) AS taux_horaire,
              COALESCE(typePayement, type_payement, '') AS type_payement,
              COALESCE(statut, 'actif') AS statut,
              COALESCE(temps_travail, '') AS temps_travail,
              COALESCE(historique_pointages, '') AS historique_pointages
         FROM personnels
        WHERE school_id = ?`,
      [schoolId]
    ),
    all(
      `SELECT id, matricule, nomComplet, COALESCE(salaire, salaire_base, 0) AS salaire_base,
              COALESCE(tauxHoraire, taux_horaire, 0) AS taux_horaire,
              COALESCE(typePayement, type_payement, '') AS type_payement,
              COALESCE(status, statut, 'actif') AS statut,
              COALESCE(volume_horaire, '') AS volume_horaire,
              COALESCE(temps_travail, '') AS temps_travail,
              COALESCE(historique_pointages, '') AS historique_pointages
         FROM enseignants
        WHERE school_id = ?`,
      [schoolId]
    ),
  ]);

  const rows = [
    ...((personnels || []).map((row) => ({ ...row, source_type: 'personnel' }))),
    ...((enseignants || []).map((row) => ({ ...row, source_type: 'enseignant' }))),
  ];

  const candidates = [];
  const skipped = [];

  for (const row of rows) {
    const status = String(row.statut || '').trim().toLowerCase();
    const typePayement = String(row.type_payement || '').trim();
    const matricule = String(row.matricule || '').trim();
    if (!matricule || status !== 'actif') continue;

    if (mode === 'monthly') {
      if (typePayement !== 'salaire' || toNumber(row.salaire_base) <= 0) continue;
      candidates.push({
        source_type: row.source_type,
        matricule,
        nomComplet: row.nomComplet || '',
        type_payement: typePayement,
        montant: toNumber(row.salaire_base),
        staffId: row.id,
        details: {
          salaire_base: toNumber(row.salaire_base),
        },
      });
      continue;
    }

    if (mode === 'hourly') {
      if (typePayement !== 'tauxHoraire' || toNumber(row.taux_horaire) <= 0) continue;
      let heures = 0;
      if (row.source_type === 'enseignant') {
        heures = await computeTeacherMonthlyHours(schoolId, row.id, normalizedMonth);
      }
      if (heures <= 0) {
        heures = extractHoursFromPayload(row.volume_horaire)
          || extractHoursFromPayload(row.temps_travail)
          || extractHoursFromPayload(row.historique_pointages);
      }
      if (heures <= 0) {
        skipped.push({
          source_type: row.source_type,
          matricule,
          nomComplet: row.nomComplet || '',
          reason: 'heures_introuvables',
        });
        continue;
      }
      candidates.push({
        source_type: row.source_type,
        matricule,
        nomComplet: row.nomComplet || '',
        type_payement: typePayement,
        montant: Number((heures * toNumber(row.taux_horaire)).toFixed(2)),
        staffId: row.id,
        details: {
          taux_horaire: toNumber(row.taux_horaire),
          heures: Number(heures.toFixed(2)),
        },
      });
    }
  }

  return {
    month: normalizedMonth,
    candidates,
    skipped,
  };
}

async function generateSalaryEntries({ schoolId, month, mode }) {
  const normalizedMonth = normalizeMonthValue(month);
  const schoolYear = await ensureSchoolYear(schoolId);
  const existingRows = await all(
    'SELECT personnel_matricule, source_type, montant FROM salaires WHERE school_id = ? AND mois = ?',
    [schoolId, normalizedMonth]
  );
  const existingKeys = new Set(
    (existingRows || []).map((row) => buildSalaryIdentity(row.source_type, row.personnel_matricule, normalizedMonth))
  );
  const datePayement = new Date().toISOString().slice(0, 10);
  const modePayement = mode === 'monthly' ? 'salaire_fixe' : 'taux_horaire';
  const inserted = [];
  const skipped = [];
  const { candidates, skipped: previewSkipped } = await loadSalaryGenerationCandidates({ schoolId, month: normalizedMonth, mode });
  skipped.push(...previewSkipped);

  await run('BEGIN TRANSACTION');
  try {
    for (const candidate of candidates) {
      const key = buildSalaryIdentity(candidate.source_type, candidate.matricule, normalizedMonth);
      if (existingKeys.has(key)) {
        skipped.push({
          source_type: candidate.source_type,
          matricule: candidate.matricule,
          reason: 'deja_genere',
        });
        continue;
      }

      const result = await run(
        `INSERT INTO salaires (school_id, school_year_id, personnel_matricule, source_type, mois, montant, mode_payement, date_payement)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          schoolId,
          schoolYear?.id || null,
          candidate.matricule,
          candidate.source_type,
          normalizedMonth,
          candidate.montant,
          modePayement,
          datePayement,
        ]
      );
      existingKeys.add(key);
      inserted.push({
        id: result.id,
        source_type: candidate.source_type,
        personnel_matricule: candidate.matricule,
        mois: normalizedMonth,
        montant: candidate.montant,
        hours: candidate.details?.heures || null,
      });
    }

    await run('COMMIT');
  } catch (error) {
    try {
      await run('ROLLBACK');
    } catch (rollbackError) {
      console.error('Erreur rollback generation salaires:', rollbackError);
    }
    throw error;
  }

  return {
    month: normalizedMonth,
    generated: inserted.length,
    skipped: skipped.length,
    inserted,
    skippedDetails: skipped,
  };
}

async function buildSalaryGenerationPreview({ schoolId, month }) {
  const normalizedMonth = normalizeMonthValue(month);
  const existingRows = await all(
    'SELECT personnel_matricule, source_type FROM salaires WHERE school_id = ? AND mois = ?',
    [schoolId, normalizedMonth]
  );
  const existingKeys = new Set(
    (existingRows || []).map((row) => buildSalaryIdentity(row.source_type, row.personnel_matricule, normalizedMonth))
  );

  const [monthly, hourly] = await Promise.all([
    loadSalaryGenerationCandidates({ schoolId, month: normalizedMonth, mode: 'monthly' }),
    loadSalaryGenerationCandidates({ schoolId, month: normalizedMonth, mode: 'hourly' }),
  ]);

  const toPreviewItem = (candidate, mode) => ({
    mode,
    source_type: candidate.source_type,
    matricule: candidate.matricule,
    nomComplet: candidate.nomComplet,
    type_payement: candidate.type_payement,
    montant: candidate.montant,
    already_generated: existingKeys.has(buildSalaryIdentity(candidate.source_type, candidate.matricule, normalizedMonth)),
    details: candidate.details || {},
  });

  return {
    month: normalizedMonth,
    fixed: {
      generated: monthly.candidates.length,
      skipped: monthly.skipped.length,
      items: monthly.candidates.map((candidate) => toPreviewItem(candidate, 'monthly')),
      skippedDetails: monthly.skipped,
    },
    hourly: {
      generated: hourly.candidates.length,
      skipped: hourly.skipped.length,
      items: hourly.candidates.map((candidate) => toPreviewItem(candidate, 'hourly')),
      skippedDetails: hourly.skipped,
    },
    totals: {
      fixed: monthly.candidates.reduce((sum, candidate) => sum + Number(candidate.montant || 0), 0),
      hourly: hourly.candidates.reduce((sum, candidate) => sum + Number(candidate.montant || 0), 0),
    },
  };
}

function buildSchoolMonthOptions(startDateText) {
  const now = new Date();
  const nowMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const parsed = new Date(startDateText);
  const startMonth = Number.isNaN(parsed.getTime())
    ? nowMonth
    : new Date(parsed.getFullYear(), parsed.getMonth(), 1);

  const begin = startMonth <= nowMonth ? startMonth : nowMonth;
  const cursor = new Date(begin.getFullYear(), begin.getMonth(), 1);
  const out = [];
  const fmt = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });

  while (cursor <= nowMonth) {
    const value = monthKey(cursor);
    const rawLabel = fmt.format(cursor);
    out.push({
      value,
      label: rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1),
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return out;
}

function monthRange(monthValue) {
  const raw = toTrimmed(monthValue);
  if (!/^\d{4}-\d{2}$/.test(raw)) return null;
  const [yearText, monthText] = raw.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  return {
    month: raw,
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function monthLabelFromKey(monthValue) {
  const range = monthRange(monthValue);
  if (!range) return monthValue;
  const [yearText, monthText] = String(range.month).split('-');
  const date = new Date(Number(yearText), Number(monthText) - 1, 1);
  if (Number.isNaN(date.getTime())) return monthValue;
  const label = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function listMonthsBetweenDates(startDate, endDate) {
  if (!(startDate instanceof Date) || !(endDate instanceof Date) || startDate > endDate) return [];
  const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const endCursor = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
  const months = [];
  while (cursor <= endCursor) {
    months.push(monthKey(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

function monthsElapsedFrom(startDateText) {
  const start = new Date(startDateText);
  if (Number.isNaN(start.getTime())) return 0;
  const now = new Date();
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) {
    months -= 1;
  }
  return Math.max(months, 0);
}

async function incrementClassEffectif(schoolId, classId) {
  if (!classId) return;
  await run(
    `UPDATE classes
     SET effectif = COALESCE(effectif, 0) + 1
     WHERE id = ? AND school_id = ?`,
    [classId, schoolId]
  );
}
async function desincrementClassEffectif(schoolId, classId) {
  if (!classId) return;
  await run(
    `UPDATE classes
     SET effectif = COALESCE(effectif, 0) -1
     WHERE id = ? AND school_id = ?`,
    [classId, schoolId]
  );
}

async function decrementClassEffectif(schoolId, classId) {
  if (!classId) return;
  await run(
    `UPDATE classes
     SET effectif = CASE WHEN COALESCE(effectif, 0) > 0 THEN effectif - 1 ELSE 0 END
     WHERE id = ? AND school_id = ?`,
    [classId, schoolId]
  );
}

async function syncEleveAttendanceCounters(schoolId, eleveId, schoolYearId = null) {
  if (!schoolId || !eleveId) return;
  const params = [schoolId, eleveId];
  let whereClause = 'WHERE school_id = ? AND eleve_id = ?';
  if (schoolYearId) {
    whereClause += ' AND school_year_id = ?';
    params.push(schoolYearId);
  }

  const totals = await get(
    `SELECT
        COUNT(CASE WHEN type = 'absence' THEN 1 END) AS total_absences,
        COUNT(CASE WHEN type = 'absence' AND COALESCE(justifie, 0) = 1 THEN 1 END) AS absences_justifiees,
        COUNT(CASE WHEN type = 'absence' AND COALESCE(justifie, 0) = 0 THEN 1 END) AS absences_non_justifiees,
        COUNT(CASE WHEN type = 'retard' THEN 1 END) AS total_retards
     FROM absences
     ${whereClause}`,
    params
  );

  await run(
    `UPDATE eleves
     SET nombre_absences = ?,
         absences_justifiees = ?,
         absences_non_justifiees = ?,
         retards = ?
     WHERE id = ? AND ecole_actuelle_id = ?`,
    [
      toNumber(totals?.total_absences),
      toNumber(totals?.absences_justifiees),
      toNumber(totals?.absences_non_justifiees),
      toNumber(totals?.total_retards),
      eleveId,
      schoolId,
    ]
  );
}

function buildStartDateFromSchoolYearLabel(label) {
  const raw = String(label || '').trim();
  const match = raw.match(/^(\d{4})\s*-\s*(\d{4})$/);
  if (!match) return null;
  const startYear = Number(match[1]);
  if (!Number.isInteger(startYear)) return null;
  return `${startYear}-09-01`;
}

async function getActiveSchoolYearContext(schoolId) {
  const activeYear = await get(
    `SELECT id, label, start_date, end_date, is_active
     FROM school_years
     WHERE school_id = ? AND is_active = 1
     ORDER BY id DESC
     LIMIT 1`,
    [schoolId]
  );

  const school = await get('SELECT current_school_year, daterentrer FROM schools WHERE id = ?', [schoolId]);
  const fallbackStart = new Date();
  fallbackStart.setMonth(8, 1);
  const fallbackDate = fallbackStart.toISOString().slice(0, 10);

  const startDate = activeYear?.start_date
    || buildStartDateFromSchoolYearLabel(activeYear?.label || school?.current_school_year)
    || school?.daterentrer
    || fallbackDate;

  return {
    school,
    activeYear,
    startDate,
  };
}

async function getLatestSubscriptionStatus(schoolId) {
  return get(
    `SELECT ss.status, ss.created_at, ss.starts_at, ss.expires_at, ss.plan_code, ss.billing_cycle, sp.name AS plan_name
     FROM saas_subscriptions ss
     LEFT JOIN subscription_plans sp ON sp.code = ss.plan_code
     WHERE ss.school_id = ?
     ORDER BY ss.created_at DESC, ss.id DESC
     LIMIT 1`,
    [schoolId]
  );
}

async function getDashboardTimeline(schoolId, monthOptions) {
  const options = monthOptions.slice(-6);
  if (!options.length) return [];

  const fromMonth = options[0].value;
  const toMonth = options[options.length - 1].value;

  const [paiements, depenses, salaires, retraits, personnelRows, enseignantRows] = await Promise.all([
    all(
      `SELECT strftime('%Y-%m', COALESCE(date_payement, created_at)) AS ym,
              COALESCE(SUM(montant), 0) AS total,
              COALESCE(SUM(CASE WHEN LOWER(COALESCE(mois, '')) <> 'inscription' THEN montant ELSE 0 END), 0) AS total_hors_inscription
       FROM paiements
       WHERE school_id = ? AND strftime('%Y-%m', COALESCE(date_payement, created_at)) BETWEEN ? AND ?
       GROUP BY ym`,
      [schoolId, fromMonth, toMonth]
    ),
    all(
      `SELECT strftime('%Y-%m', COALESCE(date_depenses, created_at)) AS ym, COALESCE(SUM(montant), 0) AS total
       FROM depenses
       WHERE school_id = ? AND strftime('%Y-%m', COALESCE(date_depenses, created_at)) BETWEEN ? AND ?
       GROUP BY ym`,
      [schoolId, fromMonth, toMonth]
    ),
    all(
      `SELECT strftime('%Y-%m', COALESCE(date_payement, created_at)) AS ym, COALESCE(SUM(montant), 0) AS total
       FROM salaires
       WHERE school_id = ? AND strftime('%Y-%m', COALESCE(date_payement, created_at)) BETWEEN ? AND ?
       GROUP BY ym`,
      [schoolId, fromMonth, toMonth]
    ),
    all(
      `SELECT strftime('%Y-%m', COALESCE(date_retrait, created_at)) AS ym, COALESCE(SUM(montant), 0) AS total
       FROM retraits_promoteur
       WHERE school_id = ? AND strftime('%Y-%m', COALESCE(date_retrait, created_at)) BETWEEN ? AND ?
       GROUP BY ym`,
      [schoolId, fromMonth, toMonth]
    ),
    all(
      `SELECT matricule, COALESCE(typePayement, type_payement, '') AS type_payement
       FROM personnels
       WHERE school_id = ?`,
      [schoolId]
    ),
    all(
      `SELECT matricule, COALESCE(typePayement, type_payement, '') AS type_payement
       FROM enseignants
       WHERE school_id = ?`,
      [schoolId]
    ),
  ]);

  const paiementsMap = new Map(paiements.map((row) => [row.ym, toNumber(row.total)]));
  const paiementsHorsInscriptionMap = new Map(paiements.map((row) => [row.ym, toNumber(row.total_hors_inscription)]));
  const depensesMap = new Map(depenses.map((row) => [row.ym, toNumber(row.total)]));
  const salairesMap = new Map(salaires.map((row) => [row.ym, toNumber(row.total)]));
  const retraitsMap = new Map(retraits.map((row) => [row.ym, toNumber(row.total)]));
  const salaryTypeMap = new Map([
    ...((personnelRows || []).map((row) => [`personnel::${String(row.matricule || '').trim().toLowerCase()}`, String(row.type_payement || '').trim().toLowerCase()])),
    ...((enseignantRows || []).map((row) => [`enseignant::${String(row.matricule || '').trim().toLowerCase()}`, String(row.type_payement || '').trim().toLowerCase()])),
  ]);
  const salarySplitRows = await all(
      `SELECT strftime('%Y-%m', COALESCE(date_payement, created_at)) AS ym,
            source_type,
            personnel_matricule,
            COALESCE(mode_payement, '') AS mode_payement,
            montant
     FROM salaires
     WHERE school_id = ? AND strftime('%Y-%m', COALESCE(date_payement, created_at)) BETWEEN ? AND ?`,
    [schoolId, fromMonth, toMonth]
  );
  const fixedSalaryMap = new Map();
  const hourlySalaryMap = new Map();
  for (const row of salarySplitRows || []) {
    const monthKey = String(row.ym || '').trim();
    const sourceType = String(row.source_type || '').trim().toLowerCase();
    const matricule = String(row.personnel_matricule || '').trim().toLowerCase();
    const paymentType = String(row.mode_payement || '').trim().toLowerCase() || salaryTypeMap.get(`${sourceType}::${matricule}`) || '';
    const currentFixed = toNumber(fixedSalaryMap.get(monthKey));
    const currentHourly = toNumber(hourlySalaryMap.get(monthKey));
    if (['tauxhoraire', 'taux_horaire', 'horaire'].includes(paymentType)) {
      hourlySalaryMap.set(monthKey, currentHourly + toNumber(row.montant));
    } else if (['salaire_fixe', 'salaire', 'mensuel', 'fixe'].includes(paymentType)) {
      fixedSalaryMap.set(monthKey, currentFixed + toNumber(row.montant));
    } else if (sourceType === 'enseignant') {
      hourlySalaryMap.set(monthKey, currentHourly + toNumber(row.montant));
    } else {
      fixedSalaryMap.set(monthKey, currentFixed + toNumber(row.montant));
    }
  }

  return options.map((option) => {
    const revenus = paiementsMap.get(option.value) || 0;
    const revenusHorsInscription = paiementsHorsInscriptionMap.get(option.value) || 0;
    const dep = depensesMap.get(option.value) || 0;
    const sal = salairesMap.get(option.value) || 0;
    const salairesFixes = fixedSalaryMap.get(option.value) || 0;
    const salairesHoraires = hourlySalaryMap.get(option.value) || 0;
    const ret = retraitsMap.get(option.value) || 0;
    const sorties = dep + sal + ret;
    return {
      key: option.value,
      label: option.label,
      revenus,
      revenus_hors_inscription: revenusHorsInscription,
      depenses: dep,
      salaires: sal,
      salaires_fixes: salairesFixes,
      salaires_horaires: salairesHoraires,
      retraits: ret,
      sorties,
      solde: revenus - sorties,
    };
  });
}

async function getMonthlySalaryForecast(schoolId, forecastMonth = monthKey(new Date())) {
  const normalizedForecastMonth = normalizeMonthValue(forecastMonth);
  const [staffRows, activeTrimestre] = await Promise.all([
    all(
      `SELECT 'personnel' AS source_type, id, matricule, nomComplet,
              COALESCE(salaire, salaire_base, 0) AS salaire_base,
              COALESCE(tauxHoraire, taux_horaire, 0) AS taux_horaire,
              COALESCE(typePayement, type_payement, '') AS type_payement,
              '' AS volume_horaire,
              COALESCE(temps_travail, '') AS temps_travail,
              COALESCE(historique_pointages, '') AS historique_pointages
         FROM personnels
        WHERE school_id = ? AND COALESCE(statut, 'actif') = 'actif'
       UNION ALL
       SELECT 'enseignant' AS source_type, id, matricule, nomComplet,
              COALESCE(salaire, salaire_base, 0) AS salaire_base,
              COALESCE(tauxHoraire, taux_horaire, 0) AS taux_horaire,
              COALESCE(typePayement, type_payement, '') AS type_payement,
              COALESCE(volume_horaire, '') AS volume_horaire,
              COALESCE(temps_travail, '') AS temps_travail,
              COALESCE(historique_pointages, '') AS historique_pointages
         FROM enseignants
        WHERE school_id = ? AND COALESCE(status, statut, 'actif') = 'actif'`,
      [schoolId, schoolId]
    ),
    get(
      `SELECT id, code, label
         FROM trimestres
        WHERE school_id = ?
          AND date('now') BETWEEN start_date AND end_date
        ORDER BY COALESCE(is_validated, 0) DESC, end_date DESC, id DESC
        LIMIT 1`,
      [schoolId]
    ),
  ]);

  const trimestreToUse = activeTrimestre
    || await get(
      `SELECT id, code, label
         FROM trimestres
        WHERE school_id = ?
        ORDER BY COALESCE(is_validated, 0) DESC, end_date DESC, id DESC
        LIMIT 1`,
      [schoolId]
    );

  const teacherSlotMap = new Map();
  if (trimestreToUse?.id) {
    const workloadRows = await all(
      `SELECT COALESCE(adjusted_enseignant_id, enseignant_id) AS enseignant_id,
              COALESCE(adjusted_slots, source_slots, 0) AS total_slots
         FROM trimestre_workloads
        WHERE school_id = ? AND trimestre_id = ?`,
      [schoolId, trimestreToUse.id]
    );

    for (const row of workloadRows || []) {
      const teacherId = String(row.enseignant_id || '').trim();
      if (!teacherId) continue;
      teacherSlotMap.set(teacherId, toNumber(teacherSlotMap.get(teacherId)) + toNumber(row.total_slots));
    }
  }

  const monthlyPaymentMarkers = new Set(['salaire', 'salaire_fixe', 'mensuel', 'fixe']);
  const hourlyPaymentMarkers = new Set(['tauxhoraire', 'taux_horaire', 'horaire']);
  let fixedMonthly = 0;
  let hourlyMonthly = 0;

  for (const row of staffRows || []) {
    const paymentType = String(row.type_payement || '').trim().toLowerCase();
    const monthlySalary = toNumber(row.salaire_base);
    const hourlyRate = toNumber(row.taux_horaire);
    const isHourly = hourlyPaymentMarkers.has(paymentType);
    const isMonthly = monthlyPaymentMarkers.has(paymentType) || (monthlySalary > 0 && !isHourly);

    if (isMonthly && monthlySalary > 0) {
      fixedMonthly += monthlySalary;
      continue;
    }

    if (!isHourly || hourlyRate <= 0) {
      continue;
    }

    if (row.source_type === 'enseignant') {
      let teacherHours = await computeTeacherMonthlyHours(schoolId, row.id, normalizedForecastMonth);
      if (teacherHours <= 0) {
        const teacherSlots = toNumber(teacherSlotMap.get(String(row.id || '').trim()));
        const fallbackCreneaux = extractHoursFromPayload(row.volume_horaire)
          || extractHoursFromPayload(row.temps_travail)
          || extractHoursFromPayload(row.historique_pointages);
        teacherHours = teacherSlots > 0 ? (teacherSlots / 3) : (fallbackCreneaux / 3);
      }
      if (teacherHours <= 0) continue;
      hourlyMonthly += hourlyRate * teacherHours;
      continue;
    }

    const fallbackCreneaux = extractHoursFromPayload(row.volume_horaire)
      || extractHoursFromPayload(row.temps_travail)
      || extractHoursFromPayload(row.historique_pointages);
    if (fallbackCreneaux <= 0) continue;

    hourlyMonthly += (hourlyRate * fallbackCreneaux) / 3;
  }

  return {
    fixedMonthly: Number(fixedMonthly.toFixed(2)),
    hourlyMonthly: Number(hourlyMonthly.toFixed(2)),
    total: Number((fixedMonthly + hourlyMonthly).toFixed(2)),
    trimestre: trimestreToUse ? {
      id: trimestreToUse.id,
      code: trimestreToUse.code || '',
      label: trimestreToUse.label || '',
    } : null,
  };
}

async function syncEleveFinanceSummary(schoolId, eleveId) {
  const { startDate } = await getActiveSchoolYearContext(schoolId);
  const eleve = await get(
    `SELECT e.id, e.date_inscription, e.reduction, c.mensualite
     FROM eleves e
     LEFT JOIN classes c ON c.id = e.classe_actuelle_id
     WHERE e.id = ? AND e.ecole_actuelle_id = ?`,
    [eleveId, schoolId]
  );

  if (!eleve) return null;

  const paymentSummary = await get(
    `SELECT
       COALESCE(SUM(montant), 0) AS total_verse,
       COALESCE(SUM(CASE WHEN LOWER(COALESCE(mois, '')) <> 'inscription' THEN montant ELSE 0 END), 0) AS total_hors_inscription,
       MAX(COALESCE(date_payement, created_at)) AS dernier_paiement
     FROM paiements
     WHERE school_id = ? AND eleve_id = ?`,
    [schoolId, eleveId]
  );

  const reduction = toNumber(eleve.reduction);
  const mensualite = toNumber(eleve.mensualite);
  const montantPaye = toNumber(paymentSummary?.total_verse);
  const totalHorsInscription = toNumber(paymentSummary?.total_hors_inscription);
  const inscriptionReference = eleve.date_inscription || startDate;
  const financeSummary = computeStudentFinanceSummary({
    mensualite,
    reduction,
    totalVerseHorsInscription: totalHorsInscription,
    dateInscription: inscriptionReference,
    schoolStartDate: startDate,
    currentDate: new Date(),
  });

  await run(
    `UPDATE eleves
     SET montant_paye = ?, reste_a_payer = ?, etat_paiement = ?, dernier_paiement = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND ecole_actuelle_id = ?`,
    [
      montantPaye,
      financeSummary.resteAPayer,
      financeSummary.etatPaiement,
      paymentSummary?.dernier_paiement || null,
      eleveId,
      schoolId,
    ]
  );

  return {
    montantPaye,
    resteAPayer: financeSummary.resteAPayer,
    etatPaiement: financeSummary.etatPaiement,
    dernierPaiement: paymentSummary?.dernier_paiement || null,
    mensualite,
    moisCouverts: financeSummary.moisCouverts,
  };
}

function toTrimmed(value) {
  return String(value || '').trim();
}

function safeParseJson(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function formatRoleLabel(role) {
  const normalized = normalizeRole(role);
  if (!normalized) return 'Utilisateur';
  if (normalized === 'super@admin') return 'Super administrateur';
  if (normalized === 'censeur') return 'Censeur';
  if (normalized === 'secretaire') return 'Secretaire';
  if (normalized === 'comptable') return 'Comptable';
  if (normalized === 'directeur') return 'Directeur';
  if (normalized === 'promoteur') return 'Promoteur';
  if (normalized === 'surveillant') return 'Surveillant';
  if (normalized === 'enseignant') return 'Enseignant';
  if (normalized === 'personnel') return 'Personnel';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatActionLabel(action, details = {}) {
  switch (action) {
    case 'auth_login':
      return 'Connexion utilisateur';
    case 'auth_logout':
      return 'Deconnexion utilisateur';
    case 'auth_change_password':
      return 'Changement de mot de passe';
    case 'school_year_transition':
      return 'Transition d annee scolaire';
    case 'cancel_inscription_payment':
      return 'Annulation inscription et paiement';
    case 'cancel_payment':
      return 'Annulation de paiement';
    case 'cancel_salary_payment':
      return 'Annulation paiement salaire';
    case 'api_write':
      return `${toTrimmed(details.method || 'ACTION')} ${toTrimmed(details.path || '').replace(/^\/api\//, '')}`.trim();
    default:
      return String(action || 'action_systeme').replace(/_/g, ' ').trim();
  }
}

function formatActivityDetails(action, details = {}) {
  if (details?.description) return String(details.description);
  if (action === 'api_write') {
    const fields = Array.isArray(details.bodyFields) && details.bodyFields.length
      ? `Champs: ${details.bodyFields.join(', ')}`
      : '';
    return [toTrimmed(details.path), fields].filter(Boolean).join(' | ');
  }
  if (action === 'school_year_transition') {
    const previousLabel = toTrimmed(details.previousSchoolYear?.label);
    const nextLabel = toTrimmed(details.newSchoolYear?.label);
    if (previousLabel || nextLabel) {
      return `${previousLabel || 'Ancienne annee'} -> ${nextLabel || 'Nouvelle annee'}`;
    }
  }
  if (details?.message) return String(details.message);
  if (details?.description) return String(details.description);
  if (details?.path) return String(details.path);
  return '';
}

function normalizeSex(value) {
  const raw = toTrimmed(value).toLowerCase();
  if (!raw) return '';
  if (['m', 'masculin', 'male', 'homme', 'garcon'].includes(raw)) return 'M';
  if (['f', 'feminin', 'female', 'femme', 'fille'].includes(raw)) return 'F';
  return '';
}

function normalizeBirthDate(value) {
  const raw = toTrimmed(value);
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const slash = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (slash) {
    const day = String(slash[1]).padStart(2, '0');
    const month = String(slash[2]).padStart(2, '0');
    const year = slash[3];
    return `${year}-${month}-${day}`;
  }
  return '';
}

function inferCycleFromNiveau(niveau) {
  const lvl = toTrimmed(niveau).toLowerCase();
  if (['jardin', '1ere', '2eme', '3eme', '4eme', '5eme', '6eme'].includes(lvl)) return 'primaire';
  if (['7eme', '8eme', '9eme'].includes(lvl)) return 'secondaire';
  if (['10eme', '11eme', 'terminale'].includes(lvl)) return 'lycee';
  return '';
}

function appreciationFromScore(score) {
  const value = toNumber(score);
  if (value >= 16) return 'Excellent';
  if (value >= 14) return 'Tres bien';
  if (value >= 12) return 'Bien';
  if (value >= 10) return 'Assez bien';
  if (value >= 8) return 'Moyen';
  return 'Insuffisant';
}

function disciplineFromStudent(student) {
  const sanctions = toTrimmed(student?.sanctions);
  const comportement = toTrimmed(student?.comportement);
  const retards = toNumber(student?.retards);
  const absences = toNumber(student?.nombre_absences);

  if (!sanctions && !comportement && retards === 0 && absences === 0) return 'Exemplaire';
  if (sanctions) return 'Sous surveillance';
  if (retards > 5 || absences > 10) return 'A ameliorer';
  return comportement || 'Satisfaisant';
}

function verificationCodeForBulletin(student, trimestre, schoolYear) {
  const raw = `${student?.matricule || 'NA'}-${trimestre || 'NA'}-${schoolYear || 'NA'}-${student?.id || '0'}`;
  return Buffer.from(raw).toString('base64').replace(/=/g, '').slice(0, 24).toUpperCase();
}

async function buildBulletinPayload({ schoolId, studentId, trimestre, requestedSchoolYear, studentOverride = null }) {
  const schoolYear = requestedSchoolYear?.label || '';
  const student = studentOverride || await get(
    `SELECT e.*, c.name AS classe_name, c.cycle AS classe_cycle, c.niveau AS classe_niveau,
            s.name AS school_name, s.address AS school_address, s.phone AS school_phone, s.email AS school_email
     FROM eleves e
     LEFT JOIN classes c ON c.id = e.classe_actuelle_id
     LEFT JOIN schools s ON s.id = e.ecole_actuelle_id
     WHERE e.id = ? AND e.ecole_actuelle_id = ?`,
    [studentId, schoolId]
  );

  if (!student) {
    return null;
  }

  const subjectAverages = await all(
    `SELECT n.matiere,
            ROUND(AVG(CASE WHEN lower(COALESCE(n.note_type, 'devoir')) = 'devoir' THEN n.note END), 2) AS devoir,
            ROUND(AVG(CASE WHEN lower(COALESCE(n.note_type, 'devoir')) = 'composition' THEN n.note END), 2) AS composition,
            ROUND(AVG(n.note), 2) AS moyenne_eleve,
            COUNT(*) AS total_evaluations
     FROM notes n
     WHERE n.school_id = ?
       AND n.eleve_id = ?
       AND n.trimestre = ?
       AND (
         n.school_year_id = ?
         OR (n.school_year_id IS NULL AND COALESCE(n.annee, '') = COALESCE(?, ''))
       )
       AND lower(COALESCE(n.note_type, 'devoir')) IN ('devoir', 'composition')
     GROUP BY n.matiere
     ORDER BY n.matiere`,
    [schoolId, student.id, trimestre, requestedSchoolYear?.id || null, schoolYear || '']
  );

  const subjects = [];

  for (const subject of subjectAverages) {
    const metadata = await get(
      `SELECT m.coefficient,
              e.nomComplet AS enseignant_nom
       FROM matieres m
       LEFT JOIN affectation a ON a.nom_matiere = m.nom AND CAST(a.classe_id AS TEXT) = CAST(? AS TEXT)
       LEFT JOIN enseignants e ON CAST(e.id AS TEXT) = CAST(a.enseignant_id AS TEXT)
       WHERE m.school_id = ? AND lower(trim(m.nom)) = lower(trim(?))
       LIMIT 1`,
      [student.classe_actuelle_id, schoolId, subject.matiere]
    );

    const classStats = await get(
      `SELECT ROUND(AVG(n.note), 2) AS moyenne_classe,
              MIN(n.note) AS note_min,
              MAX(n.note) AS note_max
       FROM notes n
       LEFT JOIN eleves e ON e.id = n.eleve_id
       WHERE n.school_id = ? AND e.classe_actuelle_id = ? AND n.trimestre = ? AND n.matiere = ?
         AND (
           n.school_year_id = ?
           OR (n.school_year_id IS NULL AND COALESCE(n.annee, '') = COALESCE(?, ''))
         )
         AND lower(COALESCE(n.note_type, 'devoir')) IN ('devoir', 'composition')`,
      [schoolId, student.classe_actuelle_id, trimestre, subject.matiere, requestedSchoolYear?.id || null, schoolYear || '']
    );

    const rankingRows = await all(
      `SELECT n.eleve_id, ROUND(AVG(n.note), 2) AS moyenne
       FROM notes n
       LEFT JOIN eleves e ON e.id = n.eleve_id
       WHERE n.school_id = ? AND e.classe_actuelle_id = ? AND n.trimestre = ? AND n.matiere = ?
         AND (
           n.school_year_id = ?
           OR (n.school_year_id IS NULL AND COALESCE(n.annee, '') = COALESCE(?, ''))
         )
         AND lower(COALESCE(n.note_type, 'devoir')) IN ('devoir', 'composition')
       GROUP BY n.eleve_id
       ORDER BY moyenne DESC`,
      [schoolId, student.classe_actuelle_id, trimestre, subject.matiere, requestedSchoolYear?.id || null, schoolYear || '']
    );

    const rank = Math.max(
      1,
      rankingRows.findIndex((row) => Number(row.eleve_id) === Number(student.id)) + 1
    );

    subjects.push({
      matiere: subject.matiere,
      enseignant: metadata?.enseignant_nom || 'Non assigne',
      coefficient: toNumber(metadata?.coefficient, 1),
      moyenneEleve: toNumber(subject.moyenne_eleve),
      moyenneClasse: toNumber(classStats?.moyenne_classe),
      noteMin: toNumber(classStats?.note_min),
      noteMax: toNumber(classStats?.note_max),
      rang: rank,
      appreciation: appreciationFromScore(subject.moyenne_eleve),
      progression: Math.max(0, Math.min(100, Math.round((toNumber(subject.moyenne_eleve) / 20) * 100))),
      totalEvaluations: toNumber(subject.total_evaluations),
    });
  }

  const weightedTotal = subjects.reduce((acc, item) => acc + item.moyenneEleve * item.coefficient, 0);
  const coefficientTotal = subjects.reduce((acc, item) => acc + item.coefficient, 0);
  const moyenneGenerale = coefficientTotal ? Number((weightedTotal / coefficientTotal).toFixed(2)) : 0;

  const classRanking = await all(
    `SELECT n.eleve_id,
            ROUND(SUM(n.note * COALESCE(m.coefficient, 1)) / NULLIF(SUM(COALESCE(m.coefficient, 1)), 0), 2) AS moyenne
     FROM notes n
     LEFT JOIN eleves e ON e.id = n.eleve_id
     LEFT JOIN matieres m ON m.school_id = n.school_id AND lower(trim(m.nom)) = lower(trim(n.matiere))
     WHERE n.school_id = ? AND e.classe_actuelle_id = ? AND n.trimestre = ?
       AND (
         n.school_year_id = ?
         OR (n.school_year_id IS NULL AND COALESCE(n.annee, '') = COALESCE(?, ''))
       )
       AND lower(COALESCE(n.note_type, 'devoir')) IN ('devoir', 'composition')
     GROUP BY n.eleve_id
     ORDER BY moyenne DESC`,
    [schoolId, student.classe_actuelle_id, trimestre, requestedSchoolYear?.id || null, schoolYear || '']
  );

  const classAverages = classRanking
    .map((row) => Number(row.moyenne))
    .filter((value) => Number.isFinite(value));
  const classBestAverage = classAverages.length ? Number(Math.max(...classAverages).toFixed(2)) : 0;
  const classWorstAverage = classAverages.length ? Number(Math.min(...classAverages).toFixed(2)) : 0;

  const overallRank = Math.max(
    1,
    classRanking.findIndex((row) => Number(row.eleve_id) === Number(student.id)) + 1
  );

  const attendanceStats = await get(
    `SELECT
        COUNT(CASE WHEN type = 'absence' THEN 1 END) AS absences,
        COUNT(CASE WHEN type = 'retard' THEN 1 END) AS retards
     FROM absences
     WHERE school_id = ?
       AND eleve_id = ?
       AND (
         school_year_id = ?
         OR school_year_id IS NULL
       )`,
    [schoolId, student.id, requestedSchoolYear?.id || null]
  );

  const absences = toNumber(attendanceStats?.absences, toNumber(student.nombre_absences));
  const retards = toNumber(attendanceStats?.retards, toNumber(student.retards));
  const tauxPresence = Math.max(0, Math.min(100, Number((100 - (absences / 180) * 100).toFixed(1))));
  const discipline = disciplineFromStudent(student);
  const verificationCode = verificationCodeForBulletin(student, trimestre, schoolYear);

  return {
    school: {
      name: student.school_name || '',
      address: student.school_address || '',
      phone: student.school_phone || '',
      email: student.school_email || '',
    },
    bulletin: {
      titre: 'Bulletin de performance scolaire',
      trimestre,
      schoolYear,
      generatedAt: new Date().toISOString(),
      verificationCode,
    },
    student: {
      id: student.id,
      nom: student.nom,
      prenom: student.prenom,
      matricule: student.matricule,
      classe: student.classe_name || '',
      filiere: student.serie || student.classe_cycle || '',
      dateNaissance: student.date_naissance || '',
      age: computeAge(student.date_naissance),
      statut: student.statut || 'actif',
      photo: student.photo || '',
      adresse: student.adresse || '',
      nationalite: student.nationalite || '',
    },
    parents: {
      pere: student.nom_parent || 'Non renseigne',
      mere: 'Non renseigne',
      telephone: student.telephone_parent || '',
      adresse: student.adresse_tuteur || student.adresse || '',
      email: student.email_parent || '',
    },
    stats: {
      moyenneGenerale,
      rang: overallRank,
      meilleureMoyenneClasse: classBestAverage,
      plusFaibleMoyenneClasse: classWorstAverage,
      tauxPresence,
      absences,
      discipline,
      retards,
    },
    notes: subjects,
    appreciation: {
      professeurPrincipal: student.professeur_principal || 'Professeur principal',
      commentaire: student.appreciations || appreciationFromScore(moyenneGenerale),
      conseils: moyenneGenerale >= 12
        ? 'Poursuivre les efforts et maintenir la regularite dans le travail.'
        : 'Renforcer la revision des matieres fondamentales et suivre un accompagnement pedagogique.',
      globale: appreciationFromScore(moyenneGenerale),
    },
    footer: {
      directeur: 'Direction',
      parent: 'Parents / Tuteurs',
      cachet: 'UNITECH ERP',
    },
  };
}

function computeAge(dateValue) {
  if (!dateValue) return '';
  const birth = new Date(dateValue);
  if (Number.isNaN(birth.getTime())) return '';
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const hasBirthdayPassed =
    now.getMonth() > birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() >= birth.getDate());
  if (!hasBirthdayPassed) age -= 1;
  return age;
}

function mapSetupStudentRow(row = {}) {
  return {
    matricule: toTrimmed(row.matricule),
    nom: toTrimmed(row.nom),
    prenom: toTrimmed(row.prenom),
    sexe: normalizeSex(row.sexe),
    dateNaissance: normalizeBirthDate(row.dateNaissance || row.date_naissance),
    classe: toTrimmed(row.classe),
    telparent: toTrimmed(row.telparent || row.telephone_parent),
    nomparent: toTrimmed(row.nomparent || row.nom_parent),
  };
}

async function validateSetupStudentRows(schoolId, rows) {
  const mappedRows = (Array.isArray(rows) ? rows : []).map(mapSetupStudentRow);
  const classes = await all('SELECT id, name FROM classes WHERE school_id = ?', [schoolId]);
  const classMap = new Map(classes.map((row) => [String(row.name || '').trim().toLowerCase(), row]));
  const existingMatriculesRows = await all('SELECT matricule FROM eleves WHERE ecole_actuelle_id = ?', [schoolId]);
  const existingNamesRows = await all(
    'SELECT lower(trim(nom)) AS nom, lower(trim(prenom)) AS prenom FROM eleves WHERE ecole_actuelle_id = ?',
    [schoolId]
  );

  const existingMatricules = new Set(existingMatriculesRows.map((row) => String(row.matricule || '').trim().toLowerCase()).filter(Boolean));
  const existingNames = new Set(existingNamesRows.map((row) => `${row.nom}__${row.prenom}`));
  const seenMatricules = new Set();
  const seenNames = new Set();
  const validRows = [];
  const errors = [];

  mappedRows.forEach((row, index) => {
    const rowNumber = index + 1;
    if (!row.nom || !row.prenom || !row.classe) {
      errors.push(`Ligne ${rowNumber}: nom, prenom et classe sont obligatoires`);
      return;
    }

    if (!classMap.has(row.classe.toLowerCase())) {
      errors.push(`Ligne ${rowNumber}: classe "${row.classe}" introuvable`);
      return;
    }

    if (row.matricule) {
      const key = row.matricule.toLowerCase();
      if (existingMatricules.has(key) || seenMatricules.has(key)) {
        errors.push(`Ligne ${rowNumber}: matricule en doublon (${row.matricule})`);
        return;
      }
      seenMatricules.add(key);
    }

    const fullKey = `${row.nom.toLowerCase()}__${row.prenom.toLowerCase()}`;
    if (existingNames.has(fullKey) || seenNames.has(fullKey)) {
      errors.push(`Ligne ${rowNumber}: eleve deja existant (${row.nom} ${row.prenom})`);
      return;
    }
    seenNames.add(fullKey);

    validRows.push({
      ...row,
      classe_id: classMap.get(row.classe.toLowerCase()).id,
    });
  });

  return { validRows, errors };
}

async function insertSetupStudent(schoolId, row) {
  const schoolYear = await ensureSchoolYear(schoolId);
  const classe = await get('SELECT id, name, frais_inscription FROM classes WHERE id = ? AND school_id = ?', [row.classe_id, schoolId]);
  if (!classe) {
    throw new Error(`Classe introuvable pour ${row.nom} ${row.prenom}`);
  }

  const matricule = row.matricule || `ELV${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 900 + 100)}`;
  const dateInscription = new Date().toISOString().slice(0, 10);

  const result = await run(
    `INSERT INTO eleves
     (matricule, nom, prenom, date_naissance, sexe, classe_actuelle_id, ecole_actuelle_id, annee_scolaire_id,
      nom_parent, telephone_parent, date_inscription, frais_total, montant_paye, reste_a_payer, etat_paiement, dernier_paiement, exonere_frais_inscription)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      matricule,
      row.nom,
      row.prenom,
      row.dateNaissance || '2000-01-01',
      row.sexe || null,
      classe.id,
      schoolId,
      schoolYear?.id || null,
      row.nomparent || null,
      row.telparent || null,
      dateInscription,
      0,
      0,
      0,
      'paye',
      dateInscription,
      1,
    ]
  );

  await incrementClassEffectif(schoolId, classe.id);

  return result.id;
}

async function ensureSchoolYear(schoolId) {
  const existing = await get('SELECT * FROM school_years WHERE school_id = ? AND is_active = 1', [schoolId]);
  if (existing) return existing;

  const school = await get('SELECT current_school_year FROM schools WHERE id = ?', [schoolId]);
  const label = school?.current_school_year || `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`;
  await run(
    'INSERT INTO school_years (school_id, label, is_active) VALUES (?, ?, 1) ON CONFLICT (school_id, label) DO NOTHING',
    [schoolId, label]
  );
  await run('UPDATE schools SET current_school_year = ? WHERE id = ?', [label, schoolId]);
  return get('SELECT * FROM school_years WHERE school_id = ? AND label = ?', [schoolId, label]);
}

async function resolveRequestedSchoolYear(schoolId, label = '') {
  const requestedLabel = toTrimmed(label);
  if (requestedLabel) {
    const explicitYear = await get(
      'SELECT id, label FROM school_years WHERE school_id = ? AND lower(trim(label)) = lower(trim(?)) LIMIT 1',
      [schoolId, requestedLabel]
    );
    return explicitYear || { id: null, label: requestedLabel };
  }

  const activeYear = await ensureSchoolYear(schoolId);
  return {
    id: activeYear?.id || null,
    label: activeYear?.label || '',
  };
}

function parseSchoolYearLabel(label) {
  const match = toTrimmed(label).match(/^(\d{4})\s*-\s*(\d{4})$/);
  if (!match) return null;
  return {
    startYear: Number(match[1]),
    endYear: Number(match[2]),
  };
}

function normalizeDateInput(value) {
  const raw = toTrimmed(value);
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return raw;
}

function normalizeAbsenceType(value) {
  const raw = toTrimmed(value).toLowerCase();
  return raw === 'retard' ? 'retard' : 'absence';
}

function normalizeTeacherAbsenceType(value) {
  const raw = toTrimmed(value).toLowerCase();
  if (['retard', 'conge', 'mission'].includes(raw)) return raw;
  return 'absence';
}

function shiftDateByYearDelta(dateText, yearDelta) {
  const raw = normalizeDateInput(dateText);
  if (!raw) return null;
  const source = new Date(`${raw}T00:00:00Z`);
  source.setUTCFullYear(source.getUTCFullYear() + yearDelta);
  return source.toISOString().slice(0, 10);
}

async function getSchoolYearTransitionContextData(schoolId) {
  const activeYear = await ensureSchoolYear(schoolId);
  const activeLabel = activeYear?.label || '';

  const [
    trimestres,
    eleves,
    enseignants,
    personnels,
    paiements,
    notes,
    emplois,
  ] = await Promise.all([
    all(
      `SELECT id, code, label, start_date, end_date, is_validated
       FROM trimestres
       WHERE school_id = ?
         AND (
           school_year_id = ?
           OR (school_year_id IS NULL AND COALESCE(school_year_label, '') = COALESCE(?, ''))
         )
       ORDER BY start_date ASC, id ASC`,
      [schoolId, activeYear?.id || null, activeLabel]
    ),
    get(
      `SELECT
         COUNT(*) AS total,
         COUNT(CASE WHEN COALESCE(statut, 'actif') = 'actif' THEN 1 END) AS actifs
       FROM eleves
       WHERE ecole_actuelle_id = ?`,
      [schoolId]
    ),
    get(
      `SELECT
         COUNT(*) AS total,
         COUNT(CASE WHEN COALESCE(statut, 'actif') = 'actif' THEN 1 END) AS actifs
       FROM enseignants
       WHERE school_id = ?`,
      [schoolId]
    ),
    get(
      `SELECT
         COUNT(*) AS total,
         COUNT(CASE WHEN COALESCE(statut, 'actif') = 'actif' THEN 1 END) AS actifs
       FROM personnels
       WHERE school_id = ?`,
      [schoolId]
    ),
    get(
      `SELECT COUNT(*) AS total
       FROM paiements
       WHERE school_id = ?
         AND (
           school_year_id = ?
           OR (school_year_id IS NULL AND COALESCE(annee_scolaire, '') = COALESCE(?, ''))
         )`,
      [schoolId, activeYear?.id || null, activeLabel]
    ),
    get(
      `SELECT COUNT(*) AS total
       FROM notes
       WHERE school_id = ?
         AND (
           school_year_id = ?
           OR (school_year_id IS NULL AND COALESCE(annee, '') = COALESCE(?, ''))
         )`,
      [schoolId, activeYear?.id || null, activeLabel]
    ),
    get(
      `SELECT COUNT(*) AS total
       FROM emplois
       WHERE school_id = ? AND school_year_id = ?`,
      [schoolId, activeYear?.id || null]
    ),
  ]);

  const validatedCount = trimestres.filter((item) => Number(item.is_validated || 0) === 1).length;
  const unvalidatedCount = trimestres.length - validatedCount;

  return {
    activeYear,
    stats: {
      trimestres: {
        total: trimestres.length,
        validated: validatedCount,
        unvalidated: unvalidatedCount,
        rows: trimestres,
      },
      eleves: {
        total: toNumber(eleves?.total),
        actifs: toNumber(eleves?.actifs),
      },
      enseignants: {
        total: toNumber(enseignants?.total),
        actifs: toNumber(enseignants?.actifs),
      },
      personnels: {
        total: toNumber(personnels?.total),
        actifs: toNumber(personnels?.actifs),
      },
      paiements: {
        total: toNumber(paiements?.total),
      },
      notes: {
        total: toNumber(notes?.total),
      },
      emplois: {
        total: toNumber(emplois?.total),
      },
    },
    warnings: [
      ...(unvalidatedCount > 0 ? [`${unvalidatedCount} trimestre(s) ne sont pas encore valides.`] : []),
      ...(toNumber(emplois?.total) === 0 ? ['Aucun emploi du temps n est rattache a l annee active actuelle.'] : []),
    ],
  };
}

async function addNotification(schoolId, payload) {
  const { type, title, message, entityType, entityRef, metadata, uniqueKey } = payload;
  await run(
    `INSERT INTO notifications
     (school_id, type, title, message, entity_type, entity_ref, metadata, unique_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (school_id, unique_key) DO NOTHING`,
      [
        schoolId,
        type,
      title,
      message,
      entityType || null,
      entityRef || null,
      metadata ? JSON.stringify(metadata) : null,
      uniqueKey || null,
    ]
  );
}

async function buildRetardsPayload(schoolId) {
  const { startDate } = await getActiveSchoolYearContext(schoolId);
  const elapsed = Math.max(monthsElapsedFrom(startDate) + 1, 1);
  const today = new Date();

  const eleves = await all(
    `SELECT e.id, e.matricule, e.nom, e.prenom, e.date_inscription, e.reduction,
            c.name AS classe, c.mensualite, c.frais_inscription,
            COALESCE(SUM(p.montant), 0) AS total_paye,
            COALESCE(SUM(CASE WHEN LOWER(COALESCE(p.mois, '')) <> 'inscription' THEN p.montant ELSE 0 END), 0) AS total_paye_hors_inscription,
            COALESCE(SUM(CASE WHEN LOWER(COALESCE(p.mois, '')) = 'inscription' THEN p.montant ELSE 0 END), 0) AS total_paye_inscription
     FROM eleves e
     LEFT JOIN classes c ON c.id = e.classe_actuelle_id
     LEFT JOIN paiements p ON p.school_id = e.ecole_actuelle_id AND p.eleve_id = e.id
     WHERE e.ecole_actuelle_id = ?
     GROUP BY e.id, e.matricule, e.nom, e.prenom, e.date_inscription, e.reduction, c.name, c.mensualite, c.frais_inscription
     ORDER BY e.nom, e.prenom`,
    [schoolId]
  );

  const personnelRows = await all(
    `SELECT matricule, nomComplet AS full_name, poste, COALESCE(salaire, salaire_base, 0) AS salaire_base,
            COALESCE(typePayement, type_payement, 'salaire') AS type_payement
     FROM personnels
     WHERE school_id = ? AND COALESCE(statut, 'actif') = 'actif'`,
    [schoolId]
  );
  const enseignantRows = await all(
    `SELECT matricule, nomComplet AS full_name, matiere AS poste, COALESCE(salaire, salaire_base, 0) AS salaire_base,
            COALESCE(typePayement, type_payement, 'salaire') AS type_payement
     FROM enseignants
     WHERE school_id = ? AND COALESCE(status, statut, 'actif') = 'actif'`,
    [schoolId]
  );
  const salairesPaye = await all(
    `SELECT personnel_matricule AS matricule, COALESCE(SUM(montant), 0) AS total_paye
     FROM salaires
     WHERE school_id = ?
     GROUP BY personnel_matricule`,
    [schoolId]
  );

  const payeMap = new Map((salairesPaye || []).map((row) => [row.matricule, toNumber(row.total_paye)]));

  const eleveRows = eleves.map((row) => {
    const mensuel = toNumber(row.mensualite);
    const fraisInscription = toNumber(row.frais_inscription);
    const reduction = toNumber(row.reduction);
    const inscriptionReference = row.date_inscription || startDate;
    const financeSummary = computeStudentFinanceSummary({
      mensualite: mensuel,
      reduction,
      totalVerseHorsInscription: row.total_paye_hors_inscription,
      dateInscription: inscriptionReference,
      schoolStartDate: startDate,
      currentDate: today,
    });
    const totalPaye = toNumber(row.total_paye);
    const totalPayeHorsInscription = toNumber(row.total_paye_hors_inscription);
    const totalPayeInscription = toNumber(row.total_paye_inscription);
    return {
      ...row,
      mois: financeSummary.moisAttendus,
      mensualite: mensuel,
      frais_inscription: fraisInscription,
      reduction,
      total_mensualites_dues: financeSummary.totalMensualitesDues,
      total_du: financeSummary.mensualitesNettes,
      total_paye: totalPaye,
      total_paye_hors_inscription: totalPayeHorsInscription,
      total_paye_inscription: totalPayeInscription,
      reste: financeSummary.resteAPayer,
    };
  });

  const personnelOverdueRows = personnelRows.map((row) => {
    const mensuel = toNumber(row.salaire_base);
    const totalDu = mensuel * elapsed;
    const totalPaye = toNumber(payeMap.get(row.matricule));
    return {
      ...row,
      type: 'personnel',
      montant_mensuel: mensuel,
      total_du: totalDu,
      total_paye: totalPaye,
      reste: Math.max(totalDu - totalPaye, 0),
    };
  });

  const enseignantOverdueRows = enseignantRows.map((row) => {
    const mensuel = toNumber(row.salaire_base);
    const totalDu = mensuel * elapsed;
    const totalPaye = toNumber(payeMap.get(row.matricule));
    return {
      ...row,
      type: 'enseignant',
      montant_mensuel: mensuel,
      total_du: totalDu,
      total_paye: totalPaye,
      reste: Math.max(totalDu - totalPaye, 0),
    };
  });

  return {
    mois: elapsed,
    eleves: eleveRows,
    personnels: personnelOverdueRows,
    enseignants: enseignantOverdueRows,
  };
}

async function resolveTeacherForUser(schoolId, user) {
  if (normalizeRole(user?.role) !== 'enseignant') return null;
  const email = String(user?.email || '').trim().toLowerCase();
  if (!email) return null;
  return get(
    `SELECT id, nomComplet, email
     FROM enseignants
     WHERE school_id = ? AND lower(trim(email)) = ?
     LIMIT 1`,
    [schoolId, email]
  );
}

exports.getDashboardSummary = async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    await ensureSchoolYear(schoolId);
    const { school, startDate } = await getActiveSchoolYearContext(schoolId);
    const monthOptions = buildSchoolMonthOptions(startDate);
    const requestedMonth = monthRange(req.query.month);
    const activeMonth = requestedMonth && monthOptions.some((row) => row.value === requestedMonth.month)
      ? requestedMonth.month
      : (monthOptions.length ? monthOptions[monthOptions.length - 1].value : monthKey(new Date()));
    const moisEcoules = Math.max((monthOptions.findIndex((row) => row.value === activeMonth) || 0) + 1, 1);

    const [classesCount, elevesCount, enseignantsCount, personnelsCount, finance, latestSubscription, recentClasses, timeline, classForecast, monthlySalaryForecast] = await Promise.all([
      get('SELECT COUNT(*) AS total FROM classes WHERE school_id = ?', [schoolId]),
      get('SELECT COUNT(*) AS total FROM eleves WHERE ecole_actuelle_id = ? AND statut = ?', [schoolId, 'actif']),
      get('SELECT COUNT(*) AS total FROM enseignants WHERE school_id = ?', [schoolId]),
      get('SELECT COUNT(*) AS total FROM personnels WHERE school_id = ?', [schoolId]),
      exports.computeFinanceOverviewRaw(schoolId),
      getLatestSubscriptionStatus(schoolId),
      all(
        `SELECT id, name, cycle, niveau, COALESCE(annee, ?) AS annee, mensualite, frais_inscription, effectif, max_effectif
         FROM classes
         WHERE school_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT 8`,
        [school?.current_school_year || '', schoolId]
      ),
      getDashboardTimeline(schoolId, monthOptions),
      all(
        `SELECT c.name, c.cycle, c.niveau, c.mensualite, c.frais_inscription, COALESCE(c.effectif, 0) AS effectif,
                COALESCE(free_students.free_effectif, 0) AS free_effectif
         FROM classes c
         LEFT JOIN (
           SELECT classe_actuelle_id, COUNT(*) AS free_effectif
           FROM eleves
           WHERE ecole_actuelle_id = ?
             AND COALESCE(statut, 'actif') = 'actif'
             AND COALESCE(exonere_frais_inscription, 0) = 1
           GROUP BY classe_actuelle_id
         ) free_students ON free_students.classe_actuelle_id = c.id
         WHERE c.school_id = ?
         ORDER BY c.name ASC`,
        [schoolId, schoolId]
      ),
      getMonthlySalaryForecast(schoolId, activeMonth),
    ]);

    const tuitionForecast = computeInscriptionForecast(classForecast || []);
    const totalMensuelPrevu = tuitionForecast.totalMensuelPrevu;
    const totalFraisInscriptionPrevu = tuitionForecast.totalFraisInscriptionPrevu;
    const depenseWindow = timeline.slice(-6);
    const moyenneDepenses6M = depenseWindow.length
      ? depenseWindow.reduce((sum, row) => sum + toNumber(row.depenses), 0) / depenseWindow.length
      : 0;
    const totalCumulePrevu = tuitionForecast.totalCumulePrevu;
    const sortieMensuelleSalaires = toNumber(monthlySalaryForecast?.total);
    const sortieMensuellePrevue = sortieMensuelleSalaires + moyenneDepenses6M;
    const totalPayeCumule = toNumber(finance?.totalPaiements);
    const totalResteCumule = Math.max(totalCumulePrevu - totalPayeCumule, 0);
    const timelineActive = timeline.length
      ? timeline.find((row) => row.key === activeMonth) || timeline[timeline.length - 1]
      : null;
    const subscriptionStatus = buildSubscriptionAccessStatus(latestSubscription);

    res.json({
      classes: toNumber(classesCount?.total),
      eleves: toNumber(elevesCount?.total),
      enseignants: toNumber(enseignantsCount?.total),
      personnels: toNumber(personnelsCount?.total),
      finances: finance,
      currentSchoolYear: school?.current_school_year || null,
      subscriptionStatus,
      monthOptions,
      activeMonth,
      timeline,
      forecast: {
        startDate,
        moisEcoules,
        totalMensuelPrevu,
        totalFraisInscriptionPrevu,
        totalCumulePrevu,
        totalPayeCumule,
        totalResteCumule,
        sortieMensuelleSalaires,
        sortieMensuellePrevue,
        sortieMensuelleFixe: toNumber(monthlySalaryForecast?.fixedMonthly),
        sortieMensuelleHoraire: toNumber(monthlySalaryForecast?.hourlyMonthly),
        moyenneDepenses6M,
        trimestreReference: monthlySalaryForecast?.trimestre || null,
        active: timelineActive,
      },
      recentClasses: recentClasses || [],
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.computeFinanceOverviewRaw = async function computeFinanceOverviewRaw(schoolId) {
  const [paiements, depenses, salaires, retraits, recentPaiements, recentDepenses, recentSalaires, recentRetraits] = await Promise.all([
    get('SELECT COALESCE(SUM(montant), 0) AS total FROM paiements WHERE school_id = ?', [schoolId]),
    get('SELECT COALESCE(SUM(montant), 0) AS total FROM depenses WHERE school_id = ?', [schoolId]),
    get('SELECT COALESCE(SUM(montant), 0) AS total FROM salaires WHERE school_id = ?', [schoolId]),
    get('SELECT COALESCE(SUM(montant), 0) AS total FROM retraits_promoteur WHERE school_id = ?', [schoolId]),
    all(`SELECT id, montant, date_payement AS date, mode_payement AS mode, description, eleve_matricule
         FROM paiements WHERE school_id = ? ORDER BY COALESCE(date_payement, created_at) DESC LIMIT 5`, [schoolId]),
    all(`SELECT id, montant, date_depenses AS date, categorie, motif
         FROM depenses WHERE school_id = ? ORDER BY COALESCE(date_depenses, created_at) DESC LIMIT 5`, [schoolId]),
    all(`SELECT id, montant, date_payement AS date, personnel_matricule, source_type
         FROM salaires WHERE school_id = ? ORDER BY COALESCE(date_payement, created_at) DESC LIMIT 5`, [schoolId]),
    all(`SELECT id, montant, date_retrait AS date, motif
         FROM retraits_promoteur WHERE school_id = ? ORDER BY COALESCE(date_retrait, created_at) DESC LIMIT 5`, [schoolId]),
  ]);

  const totalRevenus = toNumber(paiements?.total);
  const totalDepenses = toNumber(depenses?.total) + toNumber(salaires?.total) + toNumber(retraits?.total);
  const solde = totalRevenus - totalDepenses;

  const transactions = [
    ...recentPaiements.map((row) => ({
      id: `pay-${row.id}`,
      type: 'revenu',
      date: row.date || null,
      description: row.description || `Paiement eleve ${row.eleve_matricule || ''}`.trim(),
      amount: toNumber(row.montant),
      meta: row.mode || '',
    })),
    ...recentDepenses.map((row) => ({
      id: `dep-${row.id}`,
      type: 'depense',
      date: row.date || null,
      description: row.motif || row.categorie || 'Depense',
      amount: toNumber(row.montant),
      meta: row.categorie || '',
    })),
    ...recentSalaires.map((row) => ({
      id: `sal-${row.id}`,
      type: 'depense',
      date: row.date || null,
      description: `Salaire ${row.personnel_matricule || ''}`.trim(),
      amount: toNumber(row.montant),
      meta: row.source_type || '',
    })),
    ...recentRetraits.map((row) => ({
      id: `ret-${row.id}`,
      type: 'depense',
      date: row.date || null,
      description: row.motif || 'Retrait promoteur',
      amount: toNumber(row.montant),
      meta: 'promoteur',
    })),
  ]
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    .slice(0, 10);

  return {
    totalRevenus,
    totalDepenses,
    solde,
    totalPaiements: toNumber(paiements?.total),
    totalSalaires: toNumber(salaires?.total),
    totalRetraits: toNumber(retraits?.total),
    totalDepensesDirectes: toNumber(depenses?.total),
    transactions,
  };
};

exports.getFinanceOverview = async (req, res) => {
  try {
    res.json(await exports.computeFinanceOverviewRaw(req.user.school_id));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.listSchoolYears = async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    await ensureSchoolYear(schoolId);
    const rows = await all('SELECT * FROM school_years WHERE school_id = ? ORDER BY created_at DESC', [schoolId]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.getSchoolYearTransitionContext = async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const payload = await getSchoolYearTransitionContextData(schoolId);
    res.json(payload);
  } catch (error) {
    console.error('Erreur contexte transition annee:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.createSchoolYear = async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const { label, start_date, end_date, is_active } = req.body;
    if (!label) return res.status(400).json({ error: 'Libelle requis' });
    if (is_active) {
      await run('UPDATE school_years SET is_active = 0 WHERE school_id = ?', [schoolId]);
      await run('UPDATE schools SET current_school_year = ? WHERE id = ?', [label, schoolId]);
    }
    const result = await run(
      `INSERT INTO school_years (school_id, label, start_date, end_date, is_active)
       VALUES (?, ?, ?, ?, ?)`,
      [schoolId, label, start_date || null, end_date || null, is_active ? 1 : 0]
    );
    res.status(201).json({ id: result.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.transitionSchoolYear = async (req, res) => {
  const schoolId = req.user.school_id;
  const actorUserId = req.user?.id || null;
  let transactionStarted = false;

  try {
    const currentYear = await ensureSchoolYear(schoolId);
    const nextLabel = toTrimmed(req.body.label);
    const nextStartDate = normalizeDateInput(req.body.start_date);
    const nextEndDate = normalizeDateInput(req.body.end_date);
    const copyTrimestres = Number(req.body.copy_trimestres || 0) === 1 || req.body.copy_trimestres === true;
    const updateStudents = Number(req.body.update_student_school_year || 0) === 1 || req.body.update_student_school_year === true;
    const updateTeachers = Number(req.body.update_teacher_school_year || 0) === 1 || req.body.update_teacher_school_year === true;
    const updateStaff = Number(req.body.update_staff_school_year || 0) === 1 || req.body.update_staff_school_year === true;
    const checklist = req.body.checklist || {};

    if (!nextLabel) {
      return res.status(400).json({ error: 'Le libelle de la nouvelle annee est requis' });
    }
    if (!nextStartDate || !nextEndDate) {
      return res.status(400).json({ error: 'Les dates de debut et de fin de la nouvelle annee sont requises' });
    }
    if (nextStartDate > nextEndDate) {
      return res.status(400).json({ error: 'La date de fin doit etre posterieure a la date de debut' });
    }
    if (nextLabel === currentYear?.label) {
      return res.status(400).json({ error: 'La nouvelle annee doit etre differente de l annee active' });
    }

    const requiredChecklistKeys = [
      'confirm_trimestres_ready',
      'confirm_students_reviewed',
      'confirm_schedules_reviewed',
      'confirm_pricing_reviewed',
    ];
    const missingChecklist = requiredChecklistKeys.filter((key) => checklist[key] !== true);
    if (missingChecklist.length > 0) {
      return res.status(400).json({ error: 'Veuillez confirmer toutes les etapes de verification avant la transition' });
    }

    const duplicateYear = await get(
      'SELECT id FROM school_years WHERE school_id = ? AND lower(trim(label)) = lower(trim(?)) LIMIT 1',
      [schoolId, nextLabel]
    );
    if (duplicateYear) {
      return res.status(409).json({ error: 'Cette annee scolaire existe deja' });
    }

    const context = await getSchoolYearTransitionContextData(schoolId);
    if (toNumber(context?.stats?.trimestres?.unvalidated) > 0) {
      return res.status(409).json({
        error: 'Tous les trimestres de l annee en cours doivent etre valides avant la transition',
      });
    }

    await run('BEGIN TRANSACTION');
    transactionStarted = true;

    await run(
      `UPDATE trimestres
       SET is_validated = 1,
           validated_at = COALESCE(validated_at, CURRENT_TIMESTAMP),
           validated_by = COALESCE(validated_by, ?),
           updated_at = CURRENT_TIMESTAMP
       WHERE school_id = ?
         AND (
           school_year_id = ?
           OR (school_year_id IS NULL AND COALESCE(school_year_label, '') = COALESCE(?, ''))
         )`,
      [actorUserId, schoolId, currentYear?.id || null, currentYear?.label || null]
    );

    await run(
      `UPDATE trimestre_workloads
       SET is_validated = 1,
           validated_at = COALESCE(validated_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP
       WHERE school_id = ?
         AND trimestre_id IN (
           SELECT id
           FROM trimestres
           WHERE school_id = ?
             AND (
               school_year_id = ?
               OR (school_year_id IS NULL AND COALESCE(school_year_label, '') = COALESCE(?, ''))
             )
         )`,
      [schoolId, schoolId, currentYear?.id || null, currentYear?.label || null]
    );

    await run('UPDATE school_years SET is_active = 0 WHERE school_id = ?', [schoolId]);

    const createdYear = await run(
      `INSERT INTO school_years (school_id, label, start_date, end_date, is_active)
       VALUES (?, ?, ?, ?, 1)`,
      [schoolId, nextLabel, nextStartDate, nextEndDate]
    );
    const nextYearId = createdYear.id;

    await run('UPDATE schools SET current_school_year = ? WHERE id = ?', [nextLabel, schoolId]);

    if (updateStudents) {
      await run(
        `UPDATE eleves
         SET annee_scolaire_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE ecole_actuelle_id = ? AND COALESCE(statut, 'actif') = 'actif'`,
        [nextYearId, schoolId]
      );
    }

    if (updateTeachers) {
      await run(
        `UPDATE enseignants
         SET annee_scolaire_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE school_id = ? AND COALESCE(statut, 'actif') = 'actif'`,
        [nextYearId, schoolId]
      );
    }

    if (updateStaff) {
      await run(
        `UPDATE personnels
         SET annee_scolaire_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE school_id = ? AND COALESCE(statut, 'actif') = 'actif'`,
        [nextYearId, schoolId]
      );
    }

    let copiedTrimestres = 0;
    if (copyTrimestres) {
      const previousTrimestres = await all(
        `SELECT code, label, start_date, end_date
         FROM trimestres
         WHERE school_id = ?
           AND (
             school_year_id = ?
             OR (school_year_id IS NULL AND COALESCE(school_year_label, '') = COALESCE(?, ''))
           )
         ORDER BY start_date ASC, id ASC`,
        [schoolId, currentYear?.id || null, currentYear?.label || null]
      );

      const sourceLabelInfo = parseSchoolYearLabel(currentYear?.label);
      const targetLabelInfo = parseSchoolYearLabel(nextLabel);
      const yearDelta = sourceLabelInfo && targetLabelInfo
        ? targetLabelInfo.startYear - sourceLabelInfo.startYear
        : 1;

      for (const trimestre of previousTrimestres) {
        await run(
          `INSERT INTO trimestres (school_id, school_year_id, school_year_label, code, label, start_date, end_date, is_validated)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
          [
            schoolId,
            nextYearId,
            nextLabel,
            trimestre.code,
            trimestre.label,
            shiftDateByYearDelta(trimestre.start_date, yearDelta) || nextStartDate,
            shiftDateByYearDelta(trimestre.end_date, yearDelta) || nextEndDate,
          ]
        );
        copiedTrimestres += 1;
      }
    }

    await run('COMMIT');
    transactionStarted = false;

    await addActivityLog(schoolId, actorUserId, 'school_year_transition', {
      from_school_year_id: currentYear?.id || null,
      from_school_year_label: currentYear?.label || null,
      to_school_year_id: nextYearId,
      to_school_year_label: nextLabel,
      copy_trimestres: copyTrimestres,
      copied_trimestres: copiedTrimestres,
      update_student_school_year: updateStudents,
      update_teacher_school_year: updateTeachers,
      update_staff_school_year: updateStaff,
    });

    const refreshedContext = await getSchoolYearTransitionContextData(schoolId);
    res.status(201).json({
      message: 'Transition d annee effectuee avec succes',
      schoolYearId: nextYearId,
      copiedTrimestres,
      context: refreshedContext,
    });
  } catch (error) {
    if (transactionStarted) {
      try {
        await run('ROLLBACK');
      } catch (rollbackError) {
        console.error('Erreur rollback transition annee:', rollbackError);
      }
    }
    console.error('Erreur transition annee:', error);
    if (String(error?.message || '').includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'Impossible de copier les trimestres car certains existent deja pour la nouvelle annee' });
    }
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.getSetupContext = async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const schoolYear = await ensureSchoolYear(schoolId);
    const [classes, matieres] = await Promise.all([
      all(
        `SELECT id, name AS nom, name, cycle, niveau, mensualite AS mensuel, frais_inscription, max_effectif, COALESCE(annee, ?) AS annee
         FROM classes
         WHERE school_id = ?
         ORDER BY name ASC`,
        [schoolYear?.label || '', schoolId]
      ),
      all('SELECT id, nom FROM matieres WHERE school_id = ? ORDER BY nom ASC', [schoolId]),
    ]);

    res.json({
      activeSchoolYear: schoolYear?.label || null,
      classes,
      matieres,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.listActivityLogs = async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const limit = Math.min(500, Math.max(50, toNumber(req.query.limit, 200)));
    const action = toTrimmed(req.query.action);
    const actorUserId = toTrimmed(req.query.actor_user_id);
    const search = toTrimmed(req.query.q).toLowerCase();
    const type = toTrimmed(req.query.type).toLowerCase();

    const params = [schoolId];
    let whereSql = 'WHERE l.school_id = ?';

    if (action) {
      whereSql += ' AND l.action = ?';
      params.push(action);
    }

    if (actorUserId) {
      whereSql += ' AND CAST(l.actor_user_id AS TEXT) = CAST(? AS TEXT)';
      params.push(actorUserId);
    }

    const rows = await all(
      `SELECT
          l.id,
          l.actor_user_id,
          l.school_id,
          l.action,
          l.details,
          l.created_at,
          s.name AS school_name,
          u.name AS user_name,
          u.email AS user_email,
          u.phone AS user_phone,
          u.role AS user_role,
          COALESCE(
            (
              SELECT p.nomComplet
              FROM personnels p
              WHERE p.school_id = u.school_id
                AND (lower(trim(p.email)) = lower(trim(u.email)) OR (u.matricule IS NOT NULL AND p.matricule = u.matricule))
              ORDER BY p.id DESC
              LIMIT 1
            ),
            (
              SELECT e.nomComplet
              FROM enseignants e
              WHERE e.school_id = u.school_id
                AND (lower(trim(e.email)) = lower(trim(u.email)) OR (u.matricule IS NOT NULL AND e.matricule = u.matricule))
              ORDER BY e.id DESC
              LIMIT 1
            ),
            u.name
          ) AS full_name,
          COALESCE(
            (
              SELECT p.telephone
              FROM personnels p
              WHERE p.school_id = u.school_id
                AND (lower(trim(p.email)) = lower(trim(u.email)) OR (u.matricule IS NOT NULL AND p.matricule = u.matricule))
              ORDER BY p.id DESC
              LIMIT 1
            ),
            (
              SELECT e.telephone
              FROM enseignants e
              WHERE e.school_id = u.school_id
                AND (lower(trim(e.email)) = lower(trim(u.email)) OR (u.matricule IS NOT NULL AND e.matricule = u.matricule))
              ORDER BY e.id DESC
              LIMIT 1
            ),
            u.phone
          ) AS profile_phone,
          COALESCE(
            (
              SELECT p.poste
              FROM personnels p
              WHERE p.school_id = u.school_id
                AND (lower(trim(p.email)) = lower(trim(u.email)) OR (u.matricule IS NOT NULL AND p.matricule = u.matricule))
              ORDER BY p.id DESC
              LIMIT 1
            ),
            (
              SELECT CASE WHEN trim(COALESCE(e.matiere, '')) <> '' THEN 'Professeur de ' || e.matiere ELSE '' END
              FROM enseignants e
              WHERE e.school_id = u.school_id
                AND (lower(trim(e.email)) = lower(trim(u.email)) OR (u.matricule IS NOT NULL AND e.matricule = u.matricule))
              ORDER BY e.id DESC
              LIMIT 1
            ),
            u.role
          ) AS occupied_post,
          (
            SELECT sy.label
            FROM school_years sy
            WHERE sy.id = (
              SELECT p.annee_scolaire_id
              FROM personnels p
              WHERE p.school_id = u.school_id
                AND (lower(trim(p.email)) = lower(trim(u.email)) OR (u.matricule IS NOT NULL AND p.matricule = u.matricule))
              ORDER BY p.id DESC
              LIMIT 1
            )
          ) AS personnel_school_year_label,
          (
            SELECT sy.label
            FROM school_years sy
            WHERE sy.id = (
              SELECT e.annee_scolaire_id
              FROM enseignants e
              WHERE e.school_id = u.school_id
                AND (lower(trim(e.email)) = lower(trim(u.email)) OR (u.matricule IS NOT NULL AND e.matricule = u.matricule))
              ORDER BY e.id DESC
              LIMIT 1
            )
          ) AS enseignant_school_year_label,
          (
            SELECT sy.label
            FROM school_years sy
            WHERE sy.school_id = l.school_id AND sy.is_active = 1
            ORDER BY sy.id DESC
            LIMIT 1
          ) AS active_school_year_label
       FROM activity_logs l
       LEFT JOIN users u ON u.id = l.actor_user_id
       LEFT JOIN schools s ON s.id = l.school_id
       ${whereSql}
       ORDER BY l.created_at DESC, l.id DESC
       LIMIT ?`,
      [...params, limit]
    );

    const mapped = rows
      .map((row) => {
        const details = safeParseJson(row.details, {});
        const schoolYearLabel =
          toTrimmed(details?.schoolYearLabel) ||
          toTrimmed(details?.newSchoolYear?.label) ||
          toTrimmed(details?.previousSchoolYear?.label) ||
          toTrimmed(row.personnel_school_year_label) ||
          toTrimmed(row.enseignant_school_year_label) ||
          toTrimmed(row.active_school_year_label);
        const item = {
          id: row.id,
          action: row.action,
          actionLabel: formatActionLabel(row.action, details),
          actionType: row.action.startsWith('auth_') ? 'connexion' : 'operation',
          createdAt: row.created_at,
          schoolName: row.school_name || '',
          schoolYearLabel,
          actorUserId: row.actor_user_id,
          actor: {
            id: row.actor_user_id,
            fullName: row.full_name || row.user_name || 'Systeme',
            email: row.user_email || '',
            phone: row.profile_phone || '',
            role: normalizeRole(row.user_role),
            roleLabel: formatRoleLabel(row.user_role),
            occupiedPost: row.occupied_post || formatRoleLabel(row.user_role),
          },
          details,
          detailsText: formatActivityDetails(row.action, details),
        };
        return item;
      })
      .filter((item) => {
        if (type && item.actionType !== type) return false;
        if (!search) return true;
        const haystack = [
          item.actionLabel,
          item.actor.fullName,
          item.actor.phone,
          item.actor.occupiedPost,
          item.schoolYearLabel,
          item.schoolName,
          item.detailsText,
          item.actor.email,
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(search);
      });

    const users = await all(
      `SELECT id, name, email, role
       FROM users
       WHERE school_id = ?
       ORDER BY lower(trim(name)) ASC`,
      [schoolId]
    );
    const schoolYears = await all(
      'SELECT id, label, is_active FROM school_years WHERE school_id = ? ORDER BY start_date DESC, id DESC',
      [schoolId]
    );

    const actionOptions = Array.from(new Set(mapped.map((item) => item.action)))
      .filter(Boolean)
      .map((value) => ({
        value,
        label: formatActionLabel(value),
      }));

    res.json({
      logs: mapped,
      filters: {
        users: users.map((user) => ({
          id: user.id,
          name: user.name,
          email: user.email,
          role: normalizeRole(user.role),
        })),
        actions: actionOptions,
        schoolYears,
      },
      summary: {
        total: mapped.length,
        connections: mapped.filter((item) => item.actionType === 'connexion').length,
        operations: mapped.filter((item) => item.actionType === 'operation').length,
      },
    });
  } catch (error) {
    console.error('Erreur historique actions:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.createSetupClass = async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const schoolYear = await ensureSchoolYear(schoolId);
    const nom = toTrimmed(req.body.nom || req.body.className);
    const niveau = toTrimmed(req.body.niveau).toLowerCase();
    const cycle = toTrimmed(req.body.cycle).toLowerCase() || inferCycleFromNiveau(niveau);
    const mensuel = toNumber(req.body.mensuel ?? req.body.mensualite);
    const fraisInscription = toNumber(req.body.frais_inscription ?? req.body.fraisInscription);
    const effectifMax = toNumber(req.body.effectif_max ?? req.body.maxEffectif, 50);
    const annee = toTrimmed(req.body.annee) || schoolYear?.label || '';

    if (!nom || !niveau || !cycle) {
      return res.status(400).json({ error: 'Nom, niveau et cycle sont requis' });
    }

    const existingClass = await get(
      'SELECT id FROM classes WHERE school_id = ? AND lower(trim(name)) = lower(trim(?)) LIMIT 1',
      [schoolId, nom]
    );
    if (existingClass) {
      return res.status(409).json({ error: 'Une classe avec ce nom existe deja' });
    }

    const result = await run(
      `INSERT INTO classes (name, cycle, niveau, mensualite, frais_inscription, max_effectif, school_id, annee)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [nom, cycle, niveau, mensuel, fraisInscription, effectifMax || 50, schoolId, annee]
    );

    res.status(201).json({ id: result.id, message: 'Classe ajoutee' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.previewSetupStudents = async (req, res) => {
  try {
    const payload = await validateSetupStudentRows(req.user.school_id, req.body.rows);
    res.json(payload);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.commitSetupStudents = async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const payload = await validateSetupStudentRows(schoolId, req.body.rows);
    if (!payload.validRows.length) {
      return res.status(400).json({ error: 'Aucune ligne valide a importer', details: payload.errors });
    }

    let inserted = 0;
    for (const row of payload.validRows) {
      await insertSetupStudent(schoolId, row);
      inserted += 1;
    }

    res.status(201).json({ inserted, errors: payload.errors });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.createSetupStudentManual = async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const payload = await validateSetupStudentRows(schoolId, [req.body]);
    if (!payload.validRows.length) {
      return res.status(400).json({ error: payload.errors[0] || 'Donnees invalides' });
    }
    const id = await insertSetupStudent(schoolId, payload.validRows[0]);
    res.status(201).json({ id, message: 'Eleve ajoute' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.listSetupStudentsByClass = async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const classe = toTrimmed(req.query.classe);
    const matiere = toTrimmed(req.query.matiere);
    const trimestre = toTrimmed(req.query.trimestre);
    const annee = toTrimmed(req.query.annee);
    const noteType = toTrimmed(req.query.note_type) || 'devoir';
    if (!classe) return res.json([]);
    const classeRow = await get('SELECT id FROM classes WHERE school_id = ? AND lower(trim(name)) = ?', [schoolId, classe.toLowerCase()]);
    if (!classeRow) return res.json([]);

    const rows = await all(
      `SELECT matricule, nom, prenom
       FROM eleves
       WHERE ecole_actuelle_id = ? AND classe_actuelle_id = ?
       ORDER BY nom ASC, prenom ASC`,
      [schoolId, classeRow.id]
    );

    let noteMap = new Map();
    if (matiere && trimestre && annee) {
      const notes = await all(
        `SELECT n.eleve_matricule, n.note
         FROM notes n
         INNER JOIN (
           SELECT eleve_matricule, MAX(id) AS latest_id
           FROM notes
           WHERE school_id = ? AND matiere = ? AND trimestre = ? AND annee = ? AND note_type = ?
           GROUP BY eleve_matricule
         ) latest ON latest.latest_id = n.id`,
        [schoolId, matiere, trimestre, annee, noteType]
      );
      noteMap = new Map(notes.map((row) => [String(row.eleve_matricule || '').trim().toLowerCase(), row.note]));
    }

    res.json(
      rows.map((row) => ({
        ...row,
        note: noteMap.has(String(row.matricule || '').trim().toLowerCase()) ? noteMap.get(String(row.matricule || '').trim().toLowerCase()) : '',
      }))
    );
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.saveSetupNotes = async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const classe = toTrimmed(req.body.classe);
    const matiere = toTrimmed(req.body.matiere);
    const trimestre = toTrimmed(req.body.trimestre);
    const annee = toTrimmed(req.body.annee) || (await ensureSchoolYear(schoolId))?.label || '';
    const noteType = toTrimmed(req.body.note_type) || 'devoir';
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];

    if (!classe || !matiere || !trimestre || !annee) {
      return res.status(400).json({ error: 'Classe, matiere, trimestre et annee sont requis' });
    }

    const classeRow = await get('SELECT id FROM classes WHERE school_id = ? AND lower(trim(name)) = ?', [schoolId, classe.toLowerCase()]);
    if (!classeRow) return res.status(404).json({ error: 'Classe introuvable' });

    let inserted = 0;
    const errors = [];

    for (const row of rows) {
      const matricule = toTrimmed(row.matricule);
      const note = Number(row.note);
      if (!matricule || !Number.isFinite(note)) {
        errors.push(`Ligne invalide pour ${matricule || 'matricule vide'}`);
        continue;
      }

      const eleve = await get(
        `SELECT id, matricule
         FROM eleves
         WHERE ecole_actuelle_id = ? AND classe_actuelle_id = ? AND lower(trim(matricule)) = ?`,
        [schoolId, classeRow.id, matricule.toLowerCase()]
      );

      if (!eleve) {
        errors.push(`${matricule}: eleve introuvable dans cette classe`);
        continue;
      }

      const existingNote = await get(
        `SELECT id
         FROM notes
         WHERE school_id = ? AND eleve_id = ? AND matiere = ? AND trimestre = ? AND annee = ? AND note_type = ?
         ORDER BY id DESC
         LIMIT 1`,
        [schoolId, eleve.id, matiere, trimestre, annee, noteType]
      );

      if (existingNote?.id) {
        await run(
          `UPDATE notes
           SET note = ?, description = ?
           WHERE id = ?`,
          [note, 'setup', existingNote.id]
        );
      } else {
        const schoolYear = await ensureSchoolYear(schoolId);
        await run(
          `INSERT INTO notes (school_id, school_year_id, eleve_id, eleve_matricule, matiere, trimestre, note, annee, note_type, description)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [schoolId, schoolYear?.id || null, eleve.id, eleve.matricule, matiere, trimestre, note, annee, noteType, 'setup']
        );
      }
      inserted += 1;
    }

    res.status(201).json({ inserted, errors });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.listPaiements = async (req, res) => {
  try {
    const rows = await all(
      `SELECT p.*, e.nom, e.prenom, c.name AS classe
       FROM paiements p
       LEFT JOIN eleves e ON e.id = p.eleve_id
       LEFT JOIN classes c ON c.id = e.classe_actuelle_id
       WHERE p.school_id = ?
       ORDER BY COALESCE(p.date_payement, p.created_at) DESC`,
      [req.user.school_id]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.createPaiement = async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const { eleve_id, montant, mois, date_payement, mode_payement, description } = req.body;
    if (!eleve_id || !montant) return res.status(400).json({ error: 'Eleve et montant requis' });
    const eleve = await get(
      'SELECT id, matricule, COALESCE(exonere_frais_inscription, 0) AS exonere_frais_inscription FROM eleves WHERE id = ? AND ecole_actuelle_id = ?',
      [eleve_id, schoolId]
    );
    if (!eleve) return res.status(404).json({ error: 'Eleve introuvable' });
    if (String(mois || '').trim().toLowerCase() === 'inscription' && Number(eleve.exonere_frais_inscription || 0) === 1) {
      return res.status(403).json({ error: "Cet eleve est exonere des frais d'inscription" });
    }
    const schoolYear = await ensureSchoolYear(schoolId);
    const result = await run(
      `INSERT INTO paiements (school_id, school_year_id, eleve_id, eleve_matricule, montant, mois, date_payement, mode_payement, annee_scolaire, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        schoolId,
        schoolYear?.id || null,
        eleve.id,
        eleve.matricule,
        toNumber(montant),
        mois || monthKey(),
        date_payement || new Date().toISOString().slice(0, 10),
        mode_payement || 'cash',
        schoolYear?.label || null,
        description || null,
      ]
    );
    await syncEleveFinanceSummary(schoolId, eleve.id);
    res.status(201).json({ id: result.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.deletePaiement = async (req, res) => {
  return res.status(405).json({ error: "La suppression directe est desactivee. Utilisez l'annulation de paiement." });
};

exports.cancelPaiement = async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const role = normalizeRole(req.user?.role);
    const payment = await get(
      `SELECT p.*, e.id AS eleve_ref_id, e.classe_actuelle_id
       FROM paiements p
       LEFT JOIN eleves e ON e.id = p.eleve_id
       WHERE p.id = ? AND p.school_id = ?`,
      [req.params.id, schoolId]
    );
    if (!payment) {
      return res.status(404).json({ error: 'Paiement introuvable' });
    }

    const isInscription = String(payment.mois || '').trim().toLowerCase() === 'inscription';
    if (isInscription && role !== 'directeur' && !isSuperAdminRole(role)) {
      return res.status(403).json({ error: "Seul le directeur peut annuler un paiement d'inscription" });
    }

    if (isInscription) {
      if (payment.eleve_ref_id) {
        await run('DELETE FROM paiements WHERE school_id = ? AND eleve_id = ?', [schoolId, payment.eleve_ref_id]);
        await run('DELETE FROM eleves WHERE id = ? AND ecole_actuelle_id = ?', [payment.eleve_ref_id, schoolId]);
        await decrementClassEffectif(schoolId, payment.classe_actuelle_id);
      } else {
        await run('DELETE FROM paiements WHERE id = ? AND school_id = ?', [req.params.id, schoolId]);
      }
      await addActivityLog(schoolId, req.user?.id, 'cancel_inscription_payment', {
        paiement_id: payment.id,
        eleve_id: payment.eleve_ref_id,
        eleve_matricule: payment.eleve_matricule,
      });
      return res.json({ message: "Inscription annulee avec suppression de l'eleve et de l'historique de paiement" });
    }

    await run('DELETE FROM paiements WHERE id = ? AND school_id = ?', [req.params.id, schoolId]);
    if (payment.eleve_ref_id) {
      await syncEleveFinanceSummary(schoolId, payment.eleve_ref_id);
    }
    await addActivityLog(schoolId, req.user?.id, 'cancel_payment', {
      paiement_id: payment.id,
      eleve_id: payment.eleve_ref_id,
      eleve_matricule: payment.eleve_matricule,
      mois: payment.mois,
      montant: payment.montant,
    });
    res.json({ message: 'Paiement annule et retire de l historique' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.listDepenses = async (req, res) => {
  try {
    const rows = await all(
      'SELECT * FROM depenses WHERE school_id = ? ORDER BY COALESCE(date_depenses, created_at) DESC',
      [req.user.school_id]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.createDepense = async (req, res) => {
  try {
    const { categorie, description, motif, montant, date_depenses, valide_par } = req.body;
    if (!motif || !montant) return res.status(400).json({ error: 'Motif et montant requis' });
    const schoolYear = await ensureSchoolYear(req.user.school_id);
    const result = await run(
      `INSERT INTO depenses (school_id, school_year_id, categorie, description, motif, montant, date_depenses, valide_par)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.school_id,
        schoolYear?.id || null,
        categorie || null,
        description || null,
        motif,
        toNumber(montant),
        date_depenses || new Date().toISOString().slice(0, 10),
        valide_par || null,
      ]
    );
    res.status(201).json({ id: result.id });
  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.deleteDepense = async (req, res) => {
  try {
    await run('DELETE FROM depenses WHERE id = ? AND school_id = ?', [req.params.id, req.user.school_id]);
    res.json({ message: 'Depense supprimee' });
  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.listSalaires = async (req, res) => {
  try {
    const rows = await all(
      'SELECT * FROM salaires WHERE school_id = ? ORDER BY COALESCE(date_payement, created_at) DESC',
      [req.user.school_id]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.createSalaire = async (req, res) => {
  try {
    const { personnel_matricule, source_type, mois, montant, mode_payement, date_payement } = req.body;
    const normalizedSourceType = resolveSalarySourceType(source_type);
    const normalizedMonth = normalizeMonthValue(mois);
    const salaryAmount = toNumber(montant);

    if (!personnel_matricule || salaryAmount <= 0) {
      return res.status(400).json({ error: 'Matricule et montant requis' });
    }
    const staffRow = await getSalaryStaffRow(req.user.school_id, normalizedSourceType, personnel_matricule);
    if (!staffRow) {
      return res.status(404).json({ error: 'Personnel ou enseignant introuvable' });
    }
    const schoolYear = await ensureSchoolYear(req.user.school_id);
    const result = await run(
      `INSERT INTO salaires (school_id, school_year_id, personnel_matricule, source_type, mois, montant, mode_payement, date_payement)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.school_id,
        schoolYear?.id || null,
        String(personnel_matricule).trim(),
        normalizedSourceType,
        normalizedMonth,
        salaryAmount,
        mode_payement || 'cash',
        date_payement || new Date().toISOString().slice(0, 10),
      ]
    );
    res.status(201).json({ id: result.id });
  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.generateMonthlySalaries = async (req, res) => {
  try {
    const result = await generateSalaryEntries({
      schoolId: req.user.school_id,
      month: req.body?.month,
      mode: 'monthly',
    });
    res.status(201).json(result);
  } catch (error) {
    console.error('Erreur generation salaires fixes:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.generateHourlySalaries = async (req, res) => {
  try {
    const result = await generateSalaryEntries({
      schoolId: req.user.school_id,
      month: req.body?.month,
      mode: 'hourly',
    });
    res.status(201).json(result);
  } catch (error) {
    console.error('Erreur generation salaires horaires:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.previewSalaryGeneration = async (req, res) => {
  try {
    const result = await buildSalaryGenerationPreview({
      schoolId: req.user.school_id,
      month: req.query?.month || req.body?.month,
    });
    res.json(result);
  } catch (error) {
    console.error('Erreur preview generation salaires:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.deleteSalaire = async (req, res) => {
  return res.status(405).json({ error: 'La suppression directe est desactivee. Utilisez l annulation du salaire.' });
};

exports.cancelSalaire = async (req, res) => {
  try {
    const salary = await get('SELECT * FROM salaires WHERE id = ? AND school_id = ?', [req.params.id, req.user.school_id]);
    if (!salary) {
      return res.status(404).json({ error: 'Paiement RH introuvable' });
    }
    await run('DELETE FROM salaires WHERE id = ? AND school_id = ?', [req.params.id, req.user.school_id]);
    await addActivityLog(req.user.school_id, req.user?.id, 'cancel_salary_payment', {
      salaire_id: salary.id,
      matricule: salary.personnel_matricule,
      source_type: salary.source_type,
      mois: salary.mois,
      montant: salary.montant,
    });
    res.json({ message: 'Paiement RH annule et retire de l historique' });
  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.listRetraits = async (req, res) => {
  try {
    const rows = await all(
      'SELECT * FROM retraits_promoteur WHERE school_id = ? ORDER BY COALESCE(date_retrait, created_at) DESC',
      [req.user.school_id]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.createRetrait = async (req, res) => {
  try {
    const { montant, date_retrait, motif, valide_par } = req.body;
    if (!montant) return res.status(400).json({ error: 'Montant requis' });
    const schoolYear = await ensureSchoolYear(req.user.school_id);
    const result = await run(
      `INSERT INTO retraits_promoteur (school_id, school_year_id, montant, date_retrait, motif, valide_par)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        req.user.school_id,
        schoolYear?.id || null,
        toNumber(montant),
        date_retrait || new Date().toISOString().slice(0, 10),
        motif || null,
        valide_par || null,
      ]
    );
    res.status(201).json({ id: result.id });
  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.deleteRetrait = async (req, res) => {
  try {
    await run('DELETE FROM retraits_promoteur WHERE id = ? AND school_id = ?', [req.params.id, req.user.school_id]);
    res.json({ message: 'Retrait supprime' });
  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.getTresorerie = async (req, res) => {
  try {
    const overview = await exports.computeFinanceOverviewRaw(req.user.school_id);
    res.json({
      disponibilites: overview.solde,
      actifs: overview.totalRevenus,
      passifs: overview.totalDepenses,
      transactions: overview.transactions,
    });
  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.getRetardsPaiement = async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const payload = await buildRetardsPayload(schoolId);
    const overdue = payload.eleves.filter((row) => row.reste > 0);
    for (const row of overdue.slice(0, 20)) {
      await addNotification(schoolId, {
        type: 'retard_eleve',
        title: 'Retard paiement eleve',
        message: `${row.nom} ${row.prenom} a un retard de ${row.reste} FCFA.`,
        entityType: 'eleve',
        entityRef: row.matricule,
        metadata: { reste: row.reste, classe: row.classe, mois: payload.mois },
        uniqueKey: `retard-eleve-${monthKey()}-${row.matricule}`,
      });
    }
    res.json(payload);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.getNotifications = async (req, res) => {
  try {
    const rows = await all(
      'SELECT * FROM notifications WHERE school_id = ? ORDER BY created_at DESC LIMIT 100',
      [req.user.school_id]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.getTransferNotifications = async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const rows = await all(
      `SELECT t.*, e.nom, e.prenom, c1.name AS from_classe, c2.name AS to_classe,
              s1.name AS from_school_name, s2.name AS to_school_name
       FROM transfers t
       LEFT JOIN eleves e ON e.id = t.eleve_id
       LEFT JOIN classes c1 ON c1.id = t.from_classe_id
       LEFT JOIN classes c2 ON c2.id = t.to_classe_id
       LEFT JOIN schools s1 ON s1.id = t.school_id
       LEFT JOIN schools s2 ON s2.id = t.to_school_id
       WHERE t.school_id = ? OR t.to_school_id = ?
       ORDER BY COALESCE(t.responded_at, t.requested_at) DESC, t.id DESC`,
      [schoolId, schoolId]
    );

    const outgoing = (rows || []).filter((row) => Number(row.school_id) === Number(schoolId));
    const incoming = (rows || []).filter((row) => Number(row.to_school_id) === Number(schoolId) && Number(row.school_id) !== Number(schoolId));
    const ongoing = outgoing.filter((row) => row.status === 'pending');
    const receivedPending = incoming.filter((row) => row.status === 'pending');

    res.json({
      stats: {
        ongoing: ongoing.length,
        receivedPending: receivedPending.length,
        accepted: rows.filter((row) => row.status === 'accepted').length,
        rejected: rows.filter((row) => row.status === 'rejected').length,
      },
      ongoing,
      incoming,
      outgoing,
      recent: rows.slice(0, 20),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.listEmplois = async (req, res) => {
  try {
    const teacher = await resolveTeacherForUser(req.user.school_id, req.user);
    if (normalizeRole(req.user?.role) === 'enseignant' && !teacher) {
      return res.status(403).json({ error: 'Compte enseignant non relie a une fiche enseignant' });
    }
    const classeId = toTrimmed(req.query.classe_id);
    const params = [req.user.school_id];
    const teacherFilter = teacher ? ' AND CAST(a.enseignant_id AS TEXT) = CAST(? AS TEXT)' : '';
    const classeFilter = classeId ? ' AND a.classe_id = ?' : '';
    if (teacher) params.push(teacher.id);
    if (classeId) params.push(classeId);
    const rows = await all(
      `SELECT em.id, em.jour, em.heure_debut, em.heure_fin,
              a.nom_matiere AS matiere,
              a.classe_id,
              c.name AS classe,
              a.enseignant_id,
              e.nomComplet AS enseignant_nom
       FROM emplois em
       LEFT JOIN affectation a ON a.id = em.affectation_id
       LEFT JOIN classes c ON c.id = a.classe_id
       LEFT JOIN enseignants e ON e.id = a.enseignant_id
       WHERE em.school_id = ? ${teacherFilter} ${classeFilter}
       ORDER BY em.jour, em.heure_debut`,
      params
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

async function buildTeacherTrimesterWorkloadSummary(schoolId, teacherId, trimestreId) {
  const teacher = await get(
    `SELECT id, nomComplet, matricule,
            COALESCE(typePayement, type_payement, '') AS type_payement,
            COALESCE(tauxHoraire, taux_horaire, 0) AS taux_horaire,
            COALESCE(salaire, salaire_base, 0) AS salaire_base
       FROM enseignants
      WHERE id = ? AND school_id = ?`,
    [teacherId, schoolId]
  );

  if (!teacher) {
    return { error: { status: 404, message: 'Enseignant introuvable' } };
  }

  const trimestre = await get(
    'SELECT id, code, label, start_date, end_date FROM trimestres WHERE id = ? AND school_id = ?',
    [trimestreId, schoolId]
  );

  if (!trimestre) {
    return { error: { status: 404, message: 'Trimestre introuvable' } };
  }

  const hourlyRate = toNumber(teacher.taux_horaire);
  const normalizedPaymentType = String(teacher.type_payement || '').trim().toLowerCase();
  const isHourly = normalizedPaymentType === 'tauxhoraire' || normalizedPaymentType === 'taux_horaire' || hourlyRate > 0;
  const startDate = parseDateOnly(trimestre.start_date);
  const endDate = parseDateOnly(trimestre.end_date);
  if (!startDate || !endDate || startDate > endDate) {
    return { error: { status: 400, message: 'Les dates du trimestre sont invalides' } };
  }

  const [holidayRows, emploiRows, salaryRows, absenceRows] = await Promise.all([
    all(
      'SELECT date_value FROM school_calendar_days WHERE school_id = ? AND date_value BETWEEN ? AND ?',
      [schoolId, trimestre.start_date, trimestre.end_date]
    ),
    all(
      `SELECT em.id, em.jour, em.heure_debut, em.heure_fin, a.nom_matiere AS matiere, c.name AS classe
         FROM emplois em
         INNER JOIN affectation a ON a.id = em.affectation_id
         LEFT JOIN classes c ON c.id = a.classe_id
        WHERE em.school_id = ?
          AND a.school_id = ?
          AND a.enseignant_id = ?
        ORDER BY em.jour, em.heure_debut`,
      [schoolId, schoolId, teacherId]
    ),
    all(
      `SELECT COALESCE(SUM(montant), 0) AS total_paye
         FROM salaires
        WHERE school_id = ?
          AND source_type = 'enseignant'
          AND personnel_matricule = ?
          AND date_payement BETWEEN ? AND ?`,
      [schoolId, String(teacher.matricule || '').trim(), trimestre.start_date, trimestre.end_date]
    ),
    all(
      `SELECT id, date, heure_debut, heure_fin, type, COALESCE(justifie, 0) AS justifie, motif
         FROM teacher_absences
        WHERE school_id = ?
          AND teacher_id = ?
          AND date BETWEEN ? AND ?
        ORDER BY date DESC, heure_debut ASC, id DESC`,
      [schoolId, teacherId, trimestre.start_date, trimestre.end_date]
    ),
  ]);

  const excludedDates = new Set((holidayRows || []).map((row) => row.date_value));
  const totalPaidAmount = toNumber(salaryRows?.[0]?.total_paye);
  const absenceMap = buildTeacherAbsenceMap(absenceRows);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const dayIndexByLabel = {
    Dimanche: 0,
    Lundi: 1,
    Mardi: 2,
    Mercredi: 3,
    Jeudi: 4,
    Vendredi: 5,
    Samedi: 6,
  };

  const rows = [];
  let totalSlots = 0;
  let passedSlots = 0;
  let totalHours = 0;
  let passedHours = 0;
  let totalAbsenceSlots = 0;
  let totalAbsenceHours = 0;
  let totalAbsenceAmount = 0;

  for (const row of emploiRows || []) {
    const dayIndex = dayIndexByLabel[row.jour];
    if (dayIndex === undefined) continue;

    const rowDates = listTrimesterOccurrenceDates(startDate, endDate, dayIndex, excludedDates);
    const durationHours = computeDurationHours(row.heure_debut, row.heure_fin) || 1;
    const durationMinutes = Math.max(1, Math.round(durationHours * 60));
    const scheduleStartMinutes = normalizeTimeValue(row.heure_debut, '00:00') || 0;
    const scheduleEndMinutes = scheduleStartMinutes + durationMinutes;
    let rowPassedSlots = 0;
    let rowAbsenceSlots = 0;
    let rowAbsenceMinutes = 0;

    for (const dateValue of rowDates) {
      const slotDate = parseDateOnly(dateValue);
      if (slotDate && slotDate < todayStart) {
        rowPassedSlots += 1;
      }
      const intervals = absenceMap.get(dateValue) || [];
      if (!intervals.length) continue;
      const overlapMinutes = computeOverlapMinutes(scheduleStartMinutes, scheduleEndMinutes, intervals);
      if (overlapMinutes > 0) {
        rowAbsenceSlots += 1;
        rowAbsenceMinutes += overlapMinutes;
      }
    }

    const rowTotalSlots = rowDates.length;
    const rowRemainingSlots = Math.max(0, rowTotalSlots - rowPassedSlots);
    const rowTotalHours = Number((rowTotalSlots * durationHours).toFixed(2));
    const rowPassedHours = Number((rowPassedSlots * durationHours).toFixed(2));
    const rowRemainingHours = Number((rowRemainingSlots * durationHours).toFixed(2));
    const rowAbsenceHours = Number((rowAbsenceMinutes / 60).toFixed(2));
    const rowAbsenceAmount = Number((rowAbsenceHours * hourlyRate).toFixed(2));
    const rowNetAmount = Math.max(0, Number(((rowTotalHours * hourlyRate) - rowAbsenceAmount).toFixed(2)));

    totalSlots += rowTotalSlots;
    passedSlots += rowPassedSlots;
    totalHours += rowTotalHours;
    passedHours += rowPassedHours;
    totalAbsenceSlots += rowAbsenceSlots;
    totalAbsenceHours += rowAbsenceHours;
    totalAbsenceAmount += rowAbsenceAmount;

    rows.push({
      id: row.id,
      jour: row.jour,
      heure_debut: row.heure_debut,
      heure_fin: row.heure_fin,
      matiere: row.matiere || '',
      classe: row.classe || '',
      duration_hours: Number(durationHours.toFixed(2)),
      total_slots: rowTotalSlots,
      passed_slots: rowPassedSlots,
      remaining_slots: rowRemainingSlots,
      total_hours: rowTotalHours,
      passed_hours: rowPassedHours,
      remaining_hours: rowRemainingHours,
      absence_slots: rowAbsenceSlots,
      absence_hours: rowAbsenceHours,
      absence_amount: rowAbsenceAmount,
      total_amount: Number((rowTotalHours * hourlyRate).toFixed(2)),
      net_amount: rowNetAmount,
      passed_amount: Number((rowPassedHours * hourlyRate).toFixed(2)),
      remaining_amount: Number((rowRemainingHours * hourlyRate).toFixed(2)),
    });
  }

  const remainingSlots = Math.max(0, totalSlots - passedSlots);
  const remainingHours = Number((totalHours - passedHours).toFixed(2));
  const totalAmount = Number((totalHours * hourlyRate).toFixed(2));
  const absenceDeductionAmount = Number(totalAbsenceAmount.toFixed(2));
  const netAmountDue = Math.max(0, Number((totalAmount - absenceDeductionAmount).toFixed(2)));
  const remainingAmount = Math.max(0, Number((netAmountDue - totalPaidAmount).toFixed(2)));
  const remainingAmountBySchedule = Math.max(0, Number((netAmountDue - (passedHours * hourlyRate)).toFixed(2)));
  const absenceDetails = [];

  for (const absenceRow of absenceRows || []) {
    const absenceDate = normalizeDateInput(absenceRow.date);
    if (!absenceDate) continue;
    const absenceDay = parseDateOnly(absenceDate);
    if (!absenceDay) continue;
    const dayIndex = absenceDay.getDay();
    const absenceIntervals = mergeMinuteIntervals([
      {
        start: normalizeTimeValue(absenceRow.heure_debut, '00:00') || 0,
        end: normalizeTimeValue(absenceRow.heure_fin, '23:59') || (24 * 60),
      },
    ]);

    let missedSlots = 0;
    let missedMinutes = 0;

    for (const scheduleRow of emploiRows || []) {
      const scheduleDayIndex = dayIndexByLabel[scheduleRow.jour];
      if (scheduleDayIndex !== dayIndex) continue;

      const rowDates = listTrimesterOccurrenceDates(startDate, endDate, scheduleDayIndex, excludedDates);
      if (!rowDates.includes(absenceDate)) continue;

      const durationHours = computeDurationHours(scheduleRow.heure_debut, scheduleRow.heure_fin) || 1;
      const durationMinutes = Math.max(1, Math.round(durationHours * 60));
      const scheduleStartMinutes = normalizeTimeValue(scheduleRow.heure_debut, '00:00') || 0;
      const scheduleEndMinutes = scheduleStartMinutes + durationMinutes;
      const overlapMinutes = computeOverlapMinutes(scheduleStartMinutes, scheduleEndMinutes, absenceIntervals);
      if (overlapMinutes > 0) {
        missedSlots += 1;
        missedMinutes += overlapMinutes;
      }
    }

    const missedHours = Number((missedMinutes / 60).toFixed(2));
    absenceDetails.push({
      id: absenceRow.id,
      date: absenceDate,
      heure_debut: absenceRow.heure_debut || '',
      heure_fin: absenceRow.heure_fin || '',
      type: absenceRow.type || 'absence',
      justifie: Number(absenceRow.justifie || 0),
      motif: absenceRow.motif || '',
      missed_slots: missedSlots,
      missed_hours: missedHours,
      missed_amount: Number((missedHours * hourlyRate).toFixed(2)),
    });
  }

  return {
    teacher: {
      id: teacher.id,
      nomComplet: teacher.nomComplet || '',
      matricule: teacher.matricule || '',
    },
    trimestre: {
      id: trimestre.id,
      code: trimestre.code || '',
      label: trimestre.label || '',
      start_date: trimestre.start_date,
      end_date: trimestre.end_date,
    },
    hourlyRate,
    totalSlots,
    passedSlots,
    remainingSlots,
    totalHours: Number(totalHours.toFixed(2)),
    passedHours: Number(passedHours.toFixed(2)),
    remainingHours,
    totalAmount,
    totalPaidAmount: Number(totalPaidAmount.toFixed(2)),
    absenceSlots: totalAbsenceSlots,
    absenceHours: Number(totalAbsenceHours.toFixed(2)),
    absenceDeductionAmount,
    netAmountDue,
    passedAmount: Number((passedHours * hourlyRate).toFixed(2)),
    remainingAmount,
    remainingAmountBySchedule,
    rows,
    absences: (absenceRows || []).map((row) => ({
      id: row.id,
      date: row.date,
      heure_debut: row.heure_debut || '',
      heure_fin: row.heure_fin || '',
      type: row.type || 'absence',
      justifie: Number(row.justifie || 0),
      motif: row.motif || '',
    })),
    absenceDetails,
    isHourly,
  };
}

exports.getTeacherTrimesterHourlySummary = async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const teacherId = toTrimmed(req.params.teacherId);
    const trimestreId = toTrimmed(req.query.trimestre_id);
    if (!teacherId || !trimestreId) {
      return res.status(400).json({ error: 'Enseignant et trimestre requis' });
    }

    const currentTeacher = await resolveTeacherForUser(schoolId, req.user);
    if (normalizeRole(req.user?.role) === 'enseignant' && (!currentTeacher || String(currentTeacher.id) !== String(teacherId))) {
      return res.status(403).json({ error: 'Vous ne pouvez consulter que votre propre remuneration horaire' });
    }

    const summary = await buildTeacherTrimesterWorkloadSummary(schoolId, teacherId, trimestreId);
    if (summary.error) {
      return res.status(summary.error.status).json({ error: summary.error.message });
    }
    return res.json(summary);
  } catch (error) {
    console.error('Erreur synthese remuneration trimestrielle:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.getTeacherTrimesterAbsenceSummary = async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const teacherId = toTrimmed(req.params.teacherId);
    const trimestreId = toTrimmed(req.query.trimestre_id);
    if (!teacherId || !trimestreId) {
      return res.status(400).json({ error: 'Enseignant et trimestre requis' });
    }

    const currentTeacher = await resolveTeacherForUser(schoolId, req.user);
    if (normalizeRole(req.user?.role) === 'enseignant' && (!currentTeacher || String(currentTeacher.id) !== String(teacherId))) {
      return res.status(403).json({ error: 'Vous ne pouvez consulter que votre propre suivi des absences' });
    }

    const summary = await buildTeacherTrimesterWorkloadSummary(schoolId, teacherId, trimestreId);
    if (summary.error) {
      return res.status(summary.error.status).json({ error: summary.error.message });
    }
    return res.json(summary);
  } catch (error) {
    console.error('Erreur synthese absences enseignant:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.createTeacherAbsence = async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const teacherId = toTrimmed(req.params.teacherId);
    const dateValue = normalizeDateInput(req.body?.date);
    const type = normalizeTeacherAbsenceType(req.body?.type || req.body?.statut_presence);
    const motif = toTrimmed(req.body?.motif) || null;
    const heureDebut = toTrimmed(req.body?.heure_debut) || null;
    const heureFin = toTrimmed(req.body?.heure_fin) || null;
    const justifie = Number(req.body?.justifie) ? 1 : 0;

    if (!teacherId || !dateValue) {
      return res.status(400).json({ error: 'Enseignant et date requis' });
    }

    const currentTeacher = await resolveTeacherForUser(schoolId, req.user);
    if (normalizeRole(req.user?.role) === 'enseignant' && (!currentTeacher || String(currentTeacher.id) !== String(teacherId))) {
      return res.status(403).json({ error: 'Vous ne pouvez gerer que vos propres absences' });
    }

    const teacher = await get('SELECT id FROM enseignants WHERE id = ? AND school_id = ?', [teacherId, schoolId]);
    if (!teacher) {
      return res.status(404).json({ error: 'Enseignant introuvable' });
    }

    if ((heureDebut && !heureFin) || (!heureDebut && heureFin)) {
      return res.status(400).json({ error: 'L heure de debut et de fin doivent etre fournies ensemble' });
    }

    if (heureDebut && heureFin) {
      const start = normalizeTimeValue(heureDebut, null);
      const end = normalizeTimeValue(heureFin, '23:59');
      if (start === null || end === null || end <= start) {
        return res.status(400).json({ error: 'Les heures d absence sont invalides' });
      }
    }

    const schoolYear = await ensureSchoolYear(schoolId);
    const result = await run(
      `INSERT INTO teacher_absences
       (school_id, teacher_id, date, heure_debut, heure_fin, type, justifie, motif, school_year_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        schoolId,
        teacherId,
        dateValue,
        heureDebut,
        heureFin,
        type,
        justifie,
        motif,
        schoolYear?.id || null,
      ]
    );

    res.status(201).json({ id: result.id });
  } catch (error) {
    console.error('Erreur creation absence enseignant:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.deleteTeacherAbsence = async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const absenceId = toTrimmed(req.params.absenceId);
    if (!absenceId) {
      return res.status(400).json({ error: 'Absence requise' });
    }

    const absence = await get(
      'SELECT id, teacher_id FROM teacher_absences WHERE id = ? AND school_id = ?',
      [absenceId, schoolId]
    );
    if (!absence) {
      return res.status(404).json({ error: 'Absence introuvable' });
    }

    const currentTeacher = await resolveTeacherForUser(schoolId, req.user);
    if (normalizeRole(req.user?.role) === 'enseignant' && (!currentTeacher || String(currentTeacher.id) !== String(absence.teacher_id))) {
      return res.status(403).json({ error: 'Vous ne pouvez gerer que vos propres absences' });
    }

    await run('DELETE FROM teacher_absences WHERE id = ? AND school_id = ?', [absenceId, schoolId]);
    res.json({ message: 'Absence enseignant supprimee' });
  } catch (error) {
    console.error('Erreur suppression absence enseignant:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.listTeacherAbsences = async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const trimestreId = toTrimmed(req.query.trimestre_id);
    const teacherIdFilter = toTrimmed(req.query.teacher_id);
    const motifFilter = toTrimmed(req.query.motif);
    const justifieFilter = toTrimmed(req.query.justifie);
    const searchFilter = toTrimmed(req.query.search);

    if (!trimestreId) {
      return res.status(400).json({ error: 'Trimestre requis' });
    }

    const trimestre = await get(
      'SELECT id, code, label, start_date, end_date FROM trimestres WHERE id = ? AND school_id = ?',
      [trimestreId, schoolId]
    );
    if (!trimestre) {
      return res.status(404).json({ error: 'Trimestre introuvable' });
    }

    const normalizedRole = normalizeRole(req.user?.role);
    if (normalizedRole === 'enseignant') {
      return res.status(403).json({ error: 'Acces reserve au personnel administratif' });
    }
    const scopedTeacherId = teacherIdFilter;

    const where = [
      'ta.school_id = ?',
      'ta.date BETWEEN ? AND ?',
    ];
    const params = [schoolId, trimestre.start_date, trimestre.end_date];

    if (scopedTeacherId) {
      where.push('ta.teacher_id = ?');
      params.push(scopedTeacherId);
    }

    if (motifFilter) {
      where.push('lower(COALESCE(ta.motif, \'\')) LIKE ?');
      params.push(`%${motifFilter.toLowerCase()}%`);
    }

    if (justifieFilter === '0' || justifieFilter === '1') {
      where.push('COALESCE(ta.justifie, 0) = ?');
      params.push(Number(justifieFilter));
    }

    if (searchFilter) {
      const like = `%${searchFilter.toLowerCase()}%`;
      where.push('(lower(COALESCE(e.nomComplet, \'\')) LIKE ? OR lower(COALESCE(e.matricule, \'\')) LIKE ? OR lower(COALESCE(ta.motif, \'\')) LIKE ?)');
      params.push(like, like, like);
    }

    const absenceRows = await all(
      `SELECT ta.id,
              ta.teacher_id,
              ta.date,
              ta.heure_debut,
              ta.heure_fin,
              ta.type,
              COALESCE(ta.justifie, 0) AS justifie,
              ta.motif,
              e.nomComplet AS teacher_nomComplet,
              e.matricule AS teacher_matricule
         FROM teacher_absences ta
         LEFT JOIN enseignants e ON e.id = ta.teacher_id AND e.school_id = ta.school_id
        WHERE ${where.join(' AND ')}
        ORDER BY ta.date DESC, ta.heure_debut ASC, ta.id DESC`,
      params
    );

    const teacherIds = [...new Set((absenceRows || []).map((row) => String(row.teacher_id || '').trim()).filter(Boolean))];
    const holidayRows = await all(
      'SELECT date_value FROM school_calendar_days WHERE school_id = ? AND date_value BETWEEN ? AND ?',
      [schoolId, trimestre.start_date, trimestre.end_date]
    );
    const excludedDates = new Set((holidayRows || []).map((row) => row.date_value));

    const scheduleRows = teacherIds.length
      ? await all(
        `SELECT a.enseignant_id AS teacher_id,
                em.jour,
                em.heure_debut,
                em.heure_fin
           FROM emplois em
           INNER JOIN affectation a ON a.id = em.affectation_id
          WHERE em.school_id = ?
            AND a.school_id = ?
            AND a.enseignant_id IN (${teacherIds.map(() => '?').join(',')})
          ORDER BY a.enseignant_id, em.jour, em.heure_debut`,
        [schoolId, schoolId, ...teacherIds]
      )
      : [];

    const scheduleMap = new Map();
    for (const row of scheduleRows || []) {
      const key = String(row.teacher_id);
      if (!scheduleMap.has(key)) {
        scheduleMap.set(key, []);
      }
      scheduleMap.get(key).push(row);
    }

    const dayIndexByLabel = {
      Dimanche: 0,
      Lundi: 1,
      Mardi: 2,
      Mercredi: 3,
      Jeudi: 4,
      Vendredi: 5,
      Samedi: 6,
    };

    const enrichedRows = (absenceRows || []).map((row) => {
      const absenceDate = normalizeDateInput(row.date);
      const absenceDay = parseDateOnly(absenceDate);
      const teacherSchedules = scheduleMap.get(String(row.teacher_id)) || [];
      const intervals = mergeMinuteIntervals([
        {
          start: row.heure_debut ? (normalizeTimeValue(row.heure_debut, '00:00') || 0) : 0,
          end: row.heure_fin ? (normalizeTimeValue(row.heure_fin, '23:59') || (24 * 60)) : (24 * 60),
        },
      ]);

      let missedSlots = 0;
      let missedMinutes = 0;

      if (absenceDay) {
        const absenceDayIndex = absenceDay.getDay();
        for (const scheduleRow of teacherSchedules) {
          const scheduleDayIndex = dayIndexByLabel[scheduleRow.jour];
          if (scheduleDayIndex !== absenceDayIndex) continue;
          const rowDates = listTrimesterOccurrenceDates(
            parseDateOnly(trimestre.start_date),
            parseDateOnly(trimestre.end_date),
            scheduleDayIndex,
            excludedDates
          );
          if (!rowDates.includes(absenceDate)) continue;
          const durationHours = computeDurationHours(scheduleRow.heure_debut, scheduleRow.heure_fin) || 1;
          const scheduleStartMinutes = normalizeTimeValue(scheduleRow.heure_debut, '00:00') || 0;
          const scheduleEndMinutes = scheduleStartMinutes + Math.max(1, Math.round(durationHours * 60));
          const overlapMinutes = computeOverlapMinutes(scheduleStartMinutes, scheduleEndMinutes, intervals);
          if (overlapMinutes > 0) {
            missedSlots += 1;
            missedMinutes += overlapMinutes;
          }
        }
      }

      return {
        id: row.id,
        teacher_id: row.teacher_id,
        teacher_nomComplet: row.teacher_nomComplet || '',
        teacher_matricule: row.teacher_matricule || '',
        date: row.date,
        heure_debut: row.heure_debut || '',
        heure_fin: row.heure_fin || '',
        type: row.type || 'absence',
        justifie: Number(row.justifie || 0),
        motif: row.motif || '',
        missed_slots: missedSlots,
        missed_hours: Number((missedMinutes / 60).toFixed(2)),
      };
    });

    const summary = enrichedRows.reduce((acc, row) => {
      acc.totalAbsences += 1;
      acc.justifiees += Number(row.justifie || 0) === 1 ? 1 : 0;
      acc.nonJustifiees += Number(row.justifie || 0) === 0 ? 1 : 0;
      acc.missedSlots += Number(row.missed_slots || 0);
      acc.missedHours += Number(row.missed_hours || 0);
      acc.teachers.add(String(row.teacher_id));
      return acc;
    }, {
      totalAbsences: 0,
      justifiees: 0,
      nonJustifiees: 0,
      missedSlots: 0,
      missedHours: 0,
      teachers: new Set(),
    });

    let scopeTeacher = null;
    if (normalizedRole === 'enseignant') {
      scopeTeacher = currentTeacher ? {
        id: currentTeacher.id,
        nomComplet: currentTeacher.nomComplet || '',
        matricule: currentTeacher.matricule || '',
      } : null;
    } else if (scopedTeacherId) {
      const teacherRow = await get(
        'SELECT id, nomComplet, matricule FROM enseignants WHERE id = ? AND school_id = ?',
        [scopedTeacherId, schoolId]
      );
      if (teacherRow) {
        scopeTeacher = {
          id: teacherRow.id,
          nomComplet: teacherRow.nomComplet || '',
          matricule: teacherRow.matricule || '',
        };
      }
    }

    return res.json({
      trimestre: {
        id: trimestre.id,
        code: trimestre.code || '',
        label: trimestre.label || '',
        start_date: trimestre.start_date,
        end_date: trimestre.end_date,
      },
      scopeTeacher,
      rows: enrichedRows,
      summary: {
        totalAbsences: summary.totalAbsences,
        justifiees: summary.justifiees,
        nonJustifiees: summary.nonJustifiees,
        missedSlots: summary.missedSlots,
        missedHours: Number(summary.missedHours.toFixed(2)),
        teachersCount: summary.teachers.size,
      },
    });
  } catch (error) {
    console.error('Erreur liste absences enseignants:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.getTeacherTrimesterMonthlySummary = async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const teacherId = toTrimmed(req.params.teacherId);
    const trimestreId = toTrimmed(req.query.trimestre_id);
    if (!teacherId || !trimestreId) {
      return res.status(400).json({ error: 'Enseignant et trimestre requis' });
    }

    const currentTeacher = await resolveTeacherForUser(schoolId, req.user);
    if (normalizeRole(req.user?.role) === 'enseignant' && (!currentTeacher || String(currentTeacher.id) !== String(teacherId))) {
      return res.status(403).json({ error: 'Vous ne pouvez consulter que votre propre remuneration mensuelle' });
    }

    const teacher = await get(
      `SELECT id, nomComplet, matricule,
              COALESCE(typePayement, type_payement, '') AS type_payement,
              COALESCE(salaire, salaire_base, 0) AS salaire_base
         FROM enseignants
        WHERE id = ? AND school_id = ?`,
      [teacherId, schoolId]
    );

    if (!teacher) {
      return res.status(404).json({ error: 'Enseignant introuvable' });
    }

    const trimestre = await get(
      'SELECT id, code, label, start_date, end_date FROM trimestres WHERE id = ? AND school_id = ?',
      [trimestreId, schoolId]
    );

    if (!trimestre) {
      return res.status(404).json({ error: 'Trimestre introuvable' });
    }

    const monthlySalary = toNumber(teacher.salaire_base);
    const normalizedPaymentType = String(teacher.type_payement || '').trim().toLowerCase();
    const isMonthly = ['salaire', 'salaire_fixe', 'mensuel', 'fixe'].includes(normalizedPaymentType) || monthlySalary > 0;

    if (!isMonthly || monthlySalary <= 0) {
      return res.json({
        teacher: {
          id: teacher.id,
          nomComplet: teacher.nomComplet || '',
          matricule: teacher.matricule || '',
        },
        trimestre: {
          id: trimestre.id,
          code: trimestre.code || '',
          label: trimestre.label || '',
          start_date: trimestre.start_date,
          end_date: trimestre.end_date,
        },
        monthlySalary,
        totalMonths: 0,
        paidMonths: 0,
        remainingMonths: 0,
        totalDue: 0,
        totalPaid: 0,
        remainingAmount: 0,
        months: [],
        paidMonthsList: [],
        isMonthly: false,
      });
    }

    const startDate = parseDateOnly(trimestre.start_date);
    const endDate = parseDateOnly(trimestre.end_date);
    if (!startDate || !endDate || startDate > endDate) {
      return res.status(400).json({ error: 'Les dates du trimestre sont invalides' });
    }

    const monthKeys = listMonthsBetweenDates(startDate, endDate);
    const [salaryRows] = await Promise.all([
      all(
        `SELECT mois, COALESCE(SUM(montant), 0) AS total_paye
           FROM salaires
          WHERE school_id = ?
            AND source_type = 'enseignant'
            AND personnel_matricule = ?
            AND mois IN (${monthKeys.map(() => '?').join(',') || 'NULL'})
          GROUP BY mois`,
        [schoolId, String(teacher.matricule || '').trim(), ...monthKeys]
      ),
    ]);

    const paidMap = new Map((salaryRows || []).map((row) => [String(row.mois || '').trim(), toNumber(row.total_paye)]));
    const months = monthKeys.map((monthValue) => {
      const paidAmount = toNumber(paidMap.get(monthValue));
      const dueAmount = monthlySalary;
      const remainingAmount = Math.max(0, Number((dueAmount - paidAmount).toFixed(2)));
      return {
        month: monthValue,
        label: monthLabelFromKey(monthValue),
        due_amount: Number(dueAmount.toFixed(2)),
        paid_amount: Number(paidAmount.toFixed(2)),
        remaining_amount: remainingAmount,
        is_paid: paidAmount >= dueAmount && dueAmount > 0,
        is_partial: paidAmount > 0 && paidAmount < dueAmount,
      };
    });

    const totalDue = Number((monthlySalary * months.length).toFixed(2));
    const totalPaid = Number(months.reduce((sum, item) => sum + item.paid_amount, 0).toFixed(2));
    const remainingAmount = Math.max(0, Number((totalDue - totalPaid).toFixed(2)));
    const paidMonthsList = months.filter((item) => item.paid_amount > 0);

    return res.json({
      teacher: {
        id: teacher.id,
        nomComplet: teacher.nomComplet || '',
        matricule: teacher.matricule || '',
      },
      trimestre: {
        id: trimestre.id,
        code: trimestre.code || '',
        label: trimestre.label || '',
        start_date: trimestre.start_date,
        end_date: trimestre.end_date,
      },
      monthlySalary: Number(monthlySalary.toFixed(2)),
      totalMonths: months.length,
      paidMonths: paidMonthsList.length,
      remainingMonths: Math.max(0, months.length - paidMonthsList.length),
      totalDue,
      totalPaid,
      remainingAmount,
      months,
      paidMonthsList,
      isMonthly: true,
    });
  } catch (error) {
    console.error('Erreur synthese remuneration mensuelle:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

function normalizeTimeValue(value, fallback) {
  const raw = toTrimmed(value) || fallback;
  if (!raw) return null;
  const [hours, minutes] = String(raw).split(':');
  const hour = Number(hours);
  const minute = Number(minutes);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  return (hour * 60) + minute;
}

async function validateTeacherScheduleConflict({ schoolId, affectationId, jour, heureDebut, heureFin, excludeEmploiId = null }) {
  const affectation = await get(
    'SELECT id, enseignant_id, classe_id FROM affectation WHERE id = ? AND school_id = ?',
    [affectationId, schoolId]
  );

  if (!affectation) {
    return { status: 404, error: 'Affectation introuvable' };
  }

  const startMinutes = normalizeTimeValue(heureDebut, null);
  const endMinutes = normalizeTimeValue(heureFin, '23:59');
  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
    return { status: 400, error: 'Les heures du creneau sont invalides' };
  }

  const params = [schoolId, jour, affectation.enseignant_id, affectationId];
  let query = `
    SELECT em.id, em.heure_debut, em.heure_fin, a.classe_id, c.name AS classe_nom
    FROM emplois em
    INNER JOIN affectation a ON a.id = em.affectation_id
    LEFT JOIN classes c ON c.id = a.classe_id
    WHERE em.school_id = ?
      AND em.jour = ?
      AND a.enseignant_id = ?
      AND em.affectation_id <> ?
  `;

  if (excludeEmploiId) {
    query += ' AND em.id <> ?';
    params.push(excludeEmploiId);
  }

  const conflicts = await all(query, params);
  const overlapping = (conflicts || []).find((row) => {
    const existingStart = normalizeTimeValue(row.heure_debut, null);
    const existingEnd = normalizeTimeValue(row.heure_fin, '23:59');
    if (existingStart === null || existingEnd === null) return false;
    return startMinutes < existingEnd && endMinutes > existingStart;
  });

  if (overlapping) {
    return {
      status: 409,
      error: `Cet enseignant a deja un creneau dans une autre classe sur ${jour} entre ${overlapping.heure_debut} et ${overlapping.heure_fin || '23:59'}${overlapping.classe_nom ? ` (${overlapping.classe_nom})` : ''}`,
    };
  }

  return { affectation };
}

exports.createEmploi = async (req, res) => {
  try {
    const { affectation_id, jour, heure_debut, heure_fin } = req.body;
    if (!affectation_id || !jour || !heure_debut) {
      return res.status(400).json({ error: 'Affectation, jour et heure de debut requis' });
    }

    const validation = await validateTeacherScheduleConflict({
      schoolId: req.user.school_id,
      affectationId: affectation_id,
      jour,
      heureDebut: heure_debut,
      heureFin: heure_fin,
    });
    if (validation.error) {
      return res.status(validation.status).json({ error: validation.error });
    }

    const schoolYear = await ensureSchoolYear(req.user.school_id);
    const result = await run(
      'INSERT INTO emplois (school_id, school_year_id, affectation_id, jour, heure_debut, heure_fin) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.school_id, schoolYear?.id || null, affectation_id, jour, heure_debut, heure_fin || null]
    );
    res.status(201).json({ id: result.id });
  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.updateEmploi = async (req, res) => {
  try {
    const { affectation_id, jour, heure_debut, heure_fin } = req.body;
    if (!jour || !heure_debut) {
      return res.status(400).json({ error: 'Jour et heure de debut requis' });
    }

    const existing = await get('SELECT id, affectation_id FROM emplois WHERE id = ? AND school_id = ?', [req.params.id, req.user.school_id]);
    if (!existing) {
      return res.status(404).json({ error: 'Creneau introuvable' });
    }

    const nextAffectationId = affectation_id || existing.affectation_id;
    const validation = await validateTeacherScheduleConflict({
      schoolId: req.user.school_id,
      affectationId: nextAffectationId,
      jour,
      heureDebut: heure_debut,
      heureFin: heure_fin,
      excludeEmploiId: req.params.id,
    });
    if (validation.error) {
      return res.status(validation.status).json({ error: validation.error });
    }

    await run(
      `UPDATE emplois
       SET affectation_id = COALESCE(?, affectation_id),
           jour = ?,
           heure_debut = ?,
           heure_fin = ?
       WHERE id = ? AND school_id = ?`,
      [affectation_id || null, jour, heure_debut, heure_fin || null, req.params.id, req.user.school_id]
    );

    res.json({ message: 'Creneau mis a jour' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.deleteEmploi = async (req, res) => {
  try {
    await run('DELETE FROM emplois WHERE id = ? AND school_id = ?', [req.params.id, req.user.school_id]);
    res.json({ message: 'Creneau supprime' });
  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.getAttendanceSheet = async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const classeId = toTrimmed(req.query.classe_id);
    const dateValue = normalizeDateInput(req.query.date) || new Date().toISOString().slice(0, 10);
    if (!classeId) {
      return res.status(400).json({ error: 'Classe requise' });
    }

    const classe = await get(
      'SELECT id, name, cycle, niveau FROM classes WHERE id = ? AND school_id = ?',
      [classeId, schoolId]
    );
    if (!classe) {
      return res.status(404).json({ error: 'Classe introuvable' });
    }

    const teacher = await resolveTeacherForUser(schoolId, req.user);
    if (teacher) {
      const assignment = await get(
        `SELECT id
         FROM affectation
         WHERE school_id = ?
           AND CAST(classe_id AS TEXT) = CAST(? AS TEXT)
           AND CAST(enseignant_id AS TEXT) = CAST(? AS TEXT)
         LIMIT 1`,
        [schoolId, classeId, teacher.id]
      );
      if (!assignment) {
        return res.status(403).json({ error: 'Vous ne pouvez gerer les absences que pour vos classes affectees' });
      }
    }

    const schoolYear = await ensureSchoolYear(schoolId);
    const [students, rows] = await Promise.all([
      all(
        `SELECT id, matricule, nom, prenom
         FROM eleves
         WHERE ecole_actuelle_id = ?
           AND CAST(classe_actuelle_id AS TEXT) = CAST(? AS TEXT)
           AND COALESCE(statut, 'actif') = 'actif'
         ORDER BY nom ASC, prenom ASC`,
        [schoolId, classeId]
      ),
      all(
        `SELECT a.id, a.eleve_id, a.date, a.type, COALESCE(a.justifie, 0) AS justifie, a.motif, a.duree_minutes
         FROM absences a
         INNER JOIN eleves e ON e.id = a.eleve_id
         WHERE a.school_id = ?
           AND a.date = ?
           AND CAST(e.classe_actuelle_id AS TEXT) = CAST(? AS TEXT)
           AND (
             a.school_year_id = ?
             OR a.school_year_id IS NULL
           )`,
        [schoolId, dateValue, classeId, schoolYear?.id || null]
      ),
    ]);

    const absenceMap = new Map((rows || []).map((row) => [Number(row.eleve_id), row]));
    res.json({
      date: dateValue,
      schoolYear: schoolYear?.label || '',
      classe,
      students: (students || []).map((student) => {
        const saved = absenceMap.get(Number(student.id));
        return {
          id: student.id,
          matricule: student.matricule,
          nom: student.nom,
          prenom: student.prenom,
          statut_presence: saved ? saved.type : 'present',
          justifie: saved ? Number(saved.justifie) : 0,
          motif: saved?.motif || '',
          duree_minutes: saved?.duree_minutes || null,
        };
      }),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.saveAttendanceSheet = async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const classeId = toTrimmed(req.body.classe_id);
    const dateValue = normalizeDateInput(req.body.date);
    const entries = Array.isArray(req.body.entries) ? req.body.entries : [];
    if (!classeId || !dateValue) {
      return res.status(400).json({ error: 'Classe et date requises' });
    }

    const classe = await get(
      'SELECT id, name FROM classes WHERE id = ? AND school_id = ?',
      [classeId, schoolId]
    );
    if (!classe) {
      return res.status(404).json({ error: 'Classe introuvable' });
    }

    const teacher = await resolveTeacherForUser(schoolId, req.user);
    if (teacher) {
      const assignment = await get(
        `SELECT id
         FROM affectation
         WHERE school_id = ?
           AND CAST(classe_id AS TEXT) = CAST(? AS TEXT)
           AND CAST(enseignant_id AS TEXT) = CAST(? AS TEXT)
         LIMIT 1`,
        [schoolId, classeId, teacher.id]
      );
      if (!assignment) {
        return res.status(403).json({ error: 'Vous ne pouvez gerer les absences que pour vos classes affectees' });
      }
    }

    const students = await all(
      `SELECT id
       FROM eleves
       WHERE ecole_actuelle_id = ?
         AND CAST(classe_actuelle_id AS TEXT) = CAST(? AS TEXT)`,
      [schoolId, classeId]
    );
    const studentIds = new Set((students || []).map((row) => Number(row.id)));
    const schoolYear = await ensureSchoolYear(schoolId);

    for (const student of students) {
      await run(
        'DELETE FROM absences WHERE school_id = ? AND eleve_id = ? AND date = ?',
        [schoolId, student.id, dateValue]
      );
    }

    let saved = 0;
    for (const entry of entries) {
      const eleveId = Number(entry?.eleve_id);
      if (!studentIds.has(eleveId)) continue;
      const type = normalizeAbsenceType(entry?.type || entry?.statut_presence);
      if (type !== 'absence' && type !== 'retard') continue;
      if (toTrimmed(entry?.statut_presence).toLowerCase() === 'present') continue;
      const dureeMinutes = entry?.duree_minutes === undefined || entry?.duree_minutes === null || entry?.duree_minutes === ''
        ? null
        : Math.max(0, toNumber(entry?.duree_minutes));

      await run(
        `INSERT INTO absences
         (school_id, eleve_id, date, type, justifie, motif, duree_minutes, enseignant_id, school_year_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          schoolId,
          eleveId,
          dateValue,
          type,
          Number(entry?.justifie) ? 1 : 0,
          toTrimmed(entry?.motif) || null,
          dureeMinutes,
          teacher?.id || null,
          schoolYear?.id || null,
        ]
      );
      await syncEleveAttendanceCounters(schoolId, eleveId, schoolYear?.id || null);
      saved += 1;
    }

    for (const student of students) {
      if (!(entries || []).some((entry) => Number(entry?.eleve_id) === Number(student.id))) {
        await syncEleveAttendanceCounters(schoolId, student.id, schoolYear?.id || null);
      }
    }

    res.json({
      message: 'Absences enregistrees',
      saved,
      presents: Math.max((students || []).length - saved, 0),
      date: dateValue,
      classe: classe.name,
      schoolYear: schoolYear?.label || '',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.getEleveAttendanceHistory = async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const eleveId = Number(req.params.eleveId);
    if (!eleveId) {
      return res.status(400).json({ error: 'Eleve requis' });
    }

    const student = await get(
      `SELECT e.id, e.matricule, e.nom, e.prenom, e.classe_actuelle_id, c.name AS classe_name
       FROM eleves e
       LEFT JOIN classes c ON c.id = e.classe_actuelle_id
       WHERE e.id = ? AND e.ecole_actuelle_id = ?`,
      [eleveId, schoolId]
    );

    if (!student) {
      return res.status(404).json({ error: 'Eleve introuvable' });
    }

    const teacher = await resolveTeacherForUser(schoolId, req.user);
    if (teacher) {
      const assignment = await get(
        `SELECT id
         FROM affectation
         WHERE school_id = ?
           AND CAST(classe_id AS TEXT) = CAST(? AS TEXT)
           AND CAST(enseignant_id AS TEXT) = CAST(? AS TEXT)
         LIMIT 1`,
        [schoolId, student.classe_actuelle_id, teacher.id]
      );
      if (!assignment) {
        return res.status(403).json({ error: 'Vous ne pouvez consulter que vos classes affectees' });
      }
    }

    const schoolYear = await ensureSchoolYear(schoolId);
    const rows = await all(
      `SELECT a.id, a.date, a.type, COALESCE(a.justifie, 0) AS justifie, a.motif, a.duree_minutes,
              a.created_at, sy.label AS school_year_label
       FROM absences a
       LEFT JOIN school_years sy ON sy.id = a.school_year_id
       WHERE a.school_id = ?
         AND a.eleve_id = ?
       ORDER BY a.date DESC, a.id DESC`,
      [schoolId, eleveId]
    );

    const summary = (rows || []).reduce((acc, row) => {
      if (row.type === 'retard') {
        acc.retards += 1;
      } else {
        acc.absences += 1;
      }
      if (Number(row.justifie || 0) === 1) {
        acc.justifiees += 1;
      } else if (row.type !== 'present') {
        acc.nonJustifiees += 1;
      }
      return acc;
    }, { absences: 0, retards: 0, justifiees: 0, nonJustifiees: 0 });

    res.json({
      student: {
        id: student.id,
        matricule: student.matricule,
        nom: student.nom,
        prenom: student.prenom,
        classe: student.classe_name || '-',
      },
      schoolYear: schoolYear?.label || '',
      summary,
      rows,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.getNotesContext = async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const schoolYear = await ensureSchoolYear(schoolId);
    const teacher = await resolveTeacherForUser(schoolId, req.user);

    let affectations = [];
    let eleves = [];
    let matieres = [];

    if (teacher) {
      affectations = await all(
        `SELECT a.id, a.nom_matiere, a.classe_id, c.name AS classe_nom, a.enseignant_id
         FROM affectation a
         LEFT JOIN classes c ON c.id = a.classe_id
         WHERE a.school_id = ?
           AND CAST(a.enseignant_id AS TEXT) = CAST(? AS TEXT)
         ORDER BY c.name ASC, a.nom_matiere ASC`,
        [schoolId, teacher.id]
      );

      const classeIds = Array.from(new Set(
        (affectations || [])
          .map((item) => toTrimmed(item.classe_id))
          .filter(Boolean)
      ));

      if (classeIds.length) {
        const placeholders = classeIds.map(() => '?').join(', ');
        eleves = await all(
          `SELECT id, matricule, nom, prenom, classe_actuelle_id
           FROM eleves
           WHERE ecole_actuelle_id = ?
             AND COALESCE(statut, 'actif') = 'actif'
             AND CAST(classe_actuelle_id AS TEXT) IN (${placeholders})
           ORDER BY nom ASC, prenom ASC`,
          [schoolId, ...classeIds]
        );
      }

      const matiereNames = Array.from(new Set(
        (affectations || [])
          .map((item) => toTrimmed(item.nom_matiere))
          .filter(Boolean)
      ));
      matieres = matiereNames.map((nom, index) => ({ id: `${index}-${nom}`, nom }));
    } else {
      const [eleveRows, matiereRows, affectationRows] = await Promise.all([
        all(
          `SELECT id, matricule, nom, prenom, classe_actuelle_id
           FROM eleves
           WHERE ecole_actuelle_id = ?
           ORDER BY nom ASC, prenom ASC`,
          [schoolId]
        ),
        all('SELECT id, nom FROM matieres WHERE school_id = ? ORDER BY nom ASC', [schoolId]),
        all(
          `SELECT a.id, a.nom_matiere, a.classe_id, c.name AS classe_nom, a.enseignant_id
           FROM affectation a
           LEFT JOIN classes c ON c.id = a.classe_id
           WHERE a.school_id = ?
           ORDER BY c.name ASC, a.nom_matiere ASC`,
          [schoolId]
        ),
      ]);
      eleves = eleveRows || [];
      matieres = matiereRows || [];
      affectations = affectationRows || [];
    }

    const trimestres = await all(
      `SELECT id, code, label, start_date, end_date, is_validated
       FROM trimestres
       WHERE school_id = ?
         AND (
           school_year_id = ?
           OR (school_year_id IS NULL AND COALESCE(school_year_label, '') = COALESCE(?, ''))
         )
       ORDER BY start_date ASC, id ASC`,
      [schoolId, schoolYear?.id || null, schoolYear?.label || '']
    );

    res.json({
      eleves,
      matieres,
      affectations,
      trimestres,
      schoolYear: schoolYear?.label || '',
    });
  } catch (error) {
    console.error('Erreur contexte notes:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.listNotes = async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const requestedSchoolYear = await resolveRequestedSchoolYear(schoolId, req.query.annee);
    const teacher = await resolveTeacherForUser(schoolId, req.user);
    if (normalizeRole(req.user?.role) === 'enseignant' && !teacher) {
      return res.status(403).json({ error: 'Compte enseignant non relie a une fiche enseignant' });
    }
    const teacherFilter = teacher
      ? ` AND EXISTS (
            SELECT 1
            FROM affectation a
            WHERE a.school_id = n.school_id
              AND CAST(a.classe_id AS TEXT) = CAST(e.classe_actuelle_id AS TEXT)
              AND lower(trim(a.nom_matiere)) = lower(trim(n.matiere))
              AND CAST(a.enseignant_id AS TEXT) = CAST(? AS TEXT)
          )`
      : '';
    const teacherParams = teacher ? [teacher.id] : [];
    const schoolYearFilter = ` AND (
        n.school_year_id = ?
        OR (n.school_year_id IS NULL AND COALESCE(n.annee, '') = COALESCE(?, ''))
      )`;

    const rows = await all(
      `SELECT n.*, e.nom, e.prenom, c.name AS classe
       FROM notes n
       LEFT JOIN eleves e ON e.id = n.eleve_id
       LEFT JOIN classes c ON c.id = e.classe_actuelle_id
       WHERE n.school_id = ?${schoolYearFilter}${teacherFilter}
       ORDER BY n.created_at DESC`,
      [schoolId, requestedSchoolYear?.id || null, requestedSchoolYear?.label || '', ...teacherParams]
    );
    const summary = await all(
      `SELECT c.name AS classe, ROUND(AVG(n.note), 2) AS moyenne, COUNT(*) AS total_notes
       FROM notes n
       LEFT JOIN eleves e ON e.id = n.eleve_id
       LEFT JOIN classes c ON c.id = e.classe_actuelle_id
       WHERE n.school_id = ?${schoolYearFilter}${teacherFilter}
       GROUP BY c.name
       ORDER BY c.name`,
      [schoolId, requestedSchoolYear?.id || null, requestedSchoolYear?.label || '', ...teacherParams]
    );
    res.json({ notes: rows, summary, schoolYear: requestedSchoolYear?.label || '' });
  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.createNote = async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const { eleve_id, matiere, trimestre, note, annee, note_type, description } = req.body;
    if (!eleve_id || !matiere || !trimestre || note === undefined) {
      return res.status(400).json({ error: 'Eleve, matiere, trimestre et note requis' });
    }
    const eleve = await get('SELECT id, matricule, classe_actuelle_id FROM eleves WHERE id = ? AND ecole_actuelle_id = ?', [eleve_id, schoolId]);
    if (!eleve) return res.status(404).json({ error: 'Eleve introuvable' });
    const teacher = await resolveTeacherForUser(schoolId, req.user);
    if (normalizeRole(req.user?.role) === 'enseignant' && !teacher) {
      return res.status(403).json({ error: 'Compte enseignant non relie a une fiche enseignant' });
    }
    if (teacher) {
      const assignment = await get(
        `SELECT id
         FROM affectation
         WHERE school_id = ?
           AND CAST(classe_id AS TEXT) = CAST(? AS TEXT)
           AND CAST(enseignant_id AS TEXT) = CAST(? AS TEXT)
           AND lower(trim(nom_matiere)) = lower(trim(?))
         LIMIT 1`,
        [schoolId, eleve.classe_actuelle_id, teacher.id, matiere]
      );
      if (!assignment) {
        return res.status(403).json({ error: 'Vous pouvez seulement saisir les notes de vos classes et matieres affectees' });
      }
    }
    const schoolYear = await ensureSchoolYear(schoolId);
    const result = await run(
      `INSERT INTO notes (school_id, school_year_id, eleve_id, eleve_matricule, matiere, trimestre, note, annee, note_type, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        schoolId,
        schoolYear?.id || null,
        eleve.id,
        eleve.matricule,
        matiere,
        trimestre,
        toNumber(note),
        annee || schoolYear?.label || null,
        note_type || 'devoir',
        description || null,
      ]
    );
    res.status(201).json({ id: result.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.deleteNote = async (req, res) => {
  try {
    if (normalizeRole(req.user?.role) === 'enseignant') {
      return res.status(403).json({ error: 'Un enseignant ne peut pas supprimer une note' });
    }
    await run('DELETE FROM notes WHERE id = ? AND school_id = ?', [req.params.id, req.user.school_id]);
    res.json({ message: 'Note supprimee' });
  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.getBulletin = async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const studentId = req.params.id;
    const trimestre = toTrimmed(req.query.trimestre) || '1';
    const requestedSchoolYear = await resolveRequestedSchoolYear(schoolId, req.query.annee);
    const payload = await buildBulletinPayload({ schoolId, studentId, trimestre, requestedSchoolYear });
    if (!payload) {
      return res.status(404).json({ error: 'Eleve introuvable' });
    }
    res.json(payload);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.verifyBulletinPublic = async (req, res) => {
  try {
    const studentId = req.params.id;
    const trimestre = toTrimmed(req.query.trimestre) || '1';
    const student = await get(
      `SELECT e.*, c.name AS classe_name, c.cycle AS classe_cycle, c.niveau AS classe_niveau,
              s.name AS school_name, s.address AS school_address, s.phone AS school_phone, s.email AS school_email
       FROM eleves e
       LEFT JOIN classes c ON c.id = e.classe_actuelle_id
       LEFT JOIN schools s ON s.id = e.ecole_actuelle_id
       WHERE e.id = ?`,
      [studentId]
    );

    if (!student) {
      return res.status(404).json({ error: 'Bulletin introuvable' });
    }

    const requestedSchoolYear = await resolveRequestedSchoolYear(student.ecole_actuelle_id, req.query.annee);
    const expectedCode = verificationCodeForBulletin(student, trimestre, requestedSchoolYear?.label || '');
    const providedCode = toTrimmed(req.query.code).toUpperCase();

    if (!providedCode || providedCode !== expectedCode) {
      return res.status(403).json({ error: 'Code de verification invalide' });
    }

    const payload = await buildBulletinPayload({
      schoolId: student.ecole_actuelle_id,
      studentId: student.id,
      trimestre,
      requestedSchoolYear,
      studentOverride: student,
    });

    if (!payload) {
      return res.status(404).json({ error: 'Bulletin introuvable' });
    }

    res.json(payload);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.listTransfers = async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const rows = await all(
      `SELECT t.*, e.nom, e.prenom, c1.name AS from_classe, c2.name AS to_classe,
              s1.name AS from_school_name, s2.name AS to_school_name
       FROM transfers t
       LEFT JOIN eleves e ON e.id = t.eleve_id
       LEFT JOIN classes c1 ON c1.id = t.from_classe_id
       LEFT JOIN classes c2 ON c2.id = t.to_classe_id
        LEFT JOIN schools s1 ON s1.id = t.school_id
        LEFT JOIN schools s2 ON s2.id = t.to_school_id
       WHERE t.school_id = ? OR t.to_school_id = ?
       ORDER BY t.requested_at DESC`,
      [schoolId, schoolId]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.getTransferOptions = async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const [schools, classes] = await Promise.all([
      all('SELECT id, name FROM schools WHERE id != ? ORDER BY name ASC', [schoolId]),
      all(
        `SELECT c.id, c.name, c.school_id, s.name AS school_name
         FROM classes c
         LEFT JOIN schools s ON s.id = c.school_id
         ORDER BY s.name ASC, c.name ASC`,
        []
      ),
    ]);
    res.json({ schools: schools || [], classes: classes || [] });
  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.createTransfer = async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const { eleve_id, to_classe_id, to_school_id, reason, transfer_type } = req.body;
    const transferType = String(transfer_type || 'internal').trim().toLowerCase() === 'external' ? 'external' : 'internal';
    if (!eleve_id) return res.status(400).json({ error: 'Eleve requis' });
    const eleve = await get(
      'SELECT id, matricule, classe_actuelle_id, nom, prenom FROM eleves WHERE id = ? AND ecole_actuelle_id = ?',
      [eleve_id, schoolId]
    );
    if (!eleve) return res.status(404).json({ error: 'Eleve introuvable' });

    let targetSchoolId = schoolId;
    let targetClasseId = to_classe_id || null;

    if (transferType === 'internal') {
      if (!targetClasseId) return res.status(400).json({ error: 'Classe cible requise pour un transfert interne' });
      const targetClass = await get('SELECT id FROM classes WHERE id = ? AND school_id = ?', [targetClasseId, schoolId]);
      if (!targetClass) return res.status(404).json({ error: 'Classe cible introuvable dans cet etablissement' });
    } else {
      if (!to_school_id) return res.status(400).json({ error: 'Etablissement cible requis pour un transfert inter-etablissements' });
      targetSchoolId = Number(to_school_id);
      const targetSchool = await get('SELECT id FROM schools WHERE id = ?', [targetSchoolId]);
      if (!targetSchool || Number(targetSchool.id) === Number(schoolId)) {
        return res.status(404).json({ error: 'Etablissement cible invalide' });
      }
      if (targetClasseId) {
        const targetClass = await get('SELECT id FROM classes WHERE id = ? AND school_id = ?', [targetClasseId, targetSchoolId]);
        if (!targetClass) return res.status(404).json({ error: 'Classe cible introuvable dans l etablissement choisi' });
      } else {
        targetClasseId = null;
      }
    }

    const result = await run(
      `INSERT INTO transfers (school_id, eleve_id, matricule, from_classe_id, to_classe_id, to_school_id, transfer_type, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [schoolId, eleve.id, eleve.matricule, eleve.classe_actuelle_id || null, targetClasseId, targetSchoolId, transferType, reason || null]
    );
    await addNotification(schoolId, {
      type: 'transfer_request',
      title: 'Nouvelle demande de transfert',
      message: `${eleve.nom} ${eleve.prenom} demande un transfert ${transferType === 'external' ? 'vers un autre etablissement' : 'de classe'}.`,
      entityType: 'transfer',
      entityRef: String(result.id),
      metadata: { eleve_id, to_classe_id: targetClasseId, to_school_id: targetSchoolId, transfer_type: transferType },
      uniqueKey: `transfer-${result.id}`,
    });
    if (transferType === 'external' && Number(targetSchoolId) !== Number(schoolId)) {
      await addNotification(targetSchoolId, {
        type: 'transfer_request',
        title: 'Demande de transfert inter-etablissements',
        message: `${eleve.nom} ${eleve.prenom} est propose pour integration dans votre etablissement.`,
        entityType: 'transfer',
        entityRef: String(result.id),
        metadata: { eleve_id, from_school_id: schoolId, to_classe_id: targetClasseId, transfer_type: transferType },
        uniqueKey: `transfer-target-${result.id}`,
      });
    }
    res.status(201).json({ id: result.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.updateTransferStatus = async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const { status } = req.body;
    if (!['accepted', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Statut invalide' });
    }
    const transfer = await get('SELECT * FROM transfers WHERE id = ? AND (school_id = ? OR to_school_id = ?)', [req.params.id, schoolId, schoolId]);
    if (!transfer) return res.status(404).json({ error: 'Transfert introuvable' });
    if (transfer.transfer_type === 'external' && Number(transfer.to_school_id) !== Number(schoolId)) {
      return res.status(403).json({ error: 'Seul l etablissement cible peut valider un transfert inter-etablissements' });
    }
    await run('UPDATE transfers SET status = ?, responded_at = CURRENT_TIMESTAMP WHERE id = ? AND school_id = ?', [
      status,
      req.params.id,
      transfer.school_id,
    ]);
    if (status === 'accepted') {
      if (transfer.transfer_type === 'external') {
        await run('UPDATE eleves SET ecole_actuelle_id = ?, classe_actuelle_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND ecole_actuelle_id = ?', [
          transfer.to_school_id,
          transfer.to_classe_id || null,
          transfer.eleve_id,
          transfer.school_id,
        ]);
        await desincrementClassEffectif(transfer.from_classe_id, transfer.school_id);
        if (transfer.to_classe_id) {
          await incrementClassEffectif(transfer.to_classe_id, transfer.to_school_id);
        }
       
      } else {
        await run('UPDATE eleves SET classe_actuelle_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND ecole_actuelle_id = ?', [
          transfer.to_classe_id,
          transfer.eleve_id,
          transfer.school_id,
        ]);
        await desincrementClassEffectif(transfer.from_classe_id, transfer.school_id);
        if (transfer.to_classe_id) {
          await incrementClassEffectif(transfer.to_classe_id, transfer.school_id);
        }
      }
    }
    res.json({ message: 'Transfert mis a jour' });
  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.getReports = async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const [finance, retards, notes, emploisCount] = await Promise.all([
      exports.computeFinanceOverviewRaw(schoolId),
      buildRetardsPayload(schoolId),
      get(`SELECT ROUND(AVG(note), 2) AS moyenne FROM notes WHERE school_id = ?`, [schoolId]),
      get('SELECT COUNT(*) AS total FROM emplois WHERE school_id = ?', [schoolId]),
    ]);
    res.json({
      finances: finance,
      retards: {
        eleves: retards.eleves.filter((row) => row.reste > 0).length,
        personnels: retards.personnels.filter((row) => row.reste > 0).length + retards.enseignants.filter((row) => row.reste > 0).length,
      },
      academique: {
        moyenneGenerale: toNumber(notes?.moyenne),
        emploisCount: toNumber(emploisCount?.total),
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.getSyncStatus = async (req, res) => {
  try {
    const queue = await get(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM (
         SELECT 'synced' AS status
       )`,
      []
    );
    const notifications = await get(
      'SELECT COUNT(*) AS unread FROM notifications WHERE school_id = ? AND is_read = 0',
      [req.user.school_id]
    );
    const last = await get('SELECT last_pulled_at FROM sync_state WHERE table_name = ?', ['__manual_sync_at']);
    res.json({
      lastSync: last?.last_pulled_at || null,
      pending: toNumber(queue?.pending),
      failed: toNumber(queue?.failed),
      unreadNotifications: toNumber(notifications?.unread),
      status: toNumber(queue?.failed) > 0 ? 'warning' : 'ok',
    });
  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.triggerSync = async (req, res) => {
  try {
    await run(
      `INSERT INTO sync_state (table_name, last_pulled_at)
       VALUES (?, CURRENT_TIMESTAMP)
       ON CONFLICT(table_name) DO UPDATE SET last_pulled_at = CURRENT_TIMESTAMP`,
      ['__manual_sync_at']
    );
    res.json({ message: 'Synchronisation simulee' });
  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

exports.getUsers = async (req, res) => {
  try {
    const rows = await all(
      'SELECT id, name, email, role, school_id, is_active, phone, matricule, created_at FROM users WHERE school_id = ? ORDER BY created_at DESC',
      [req.user.school_id]
    );
    res.json((rows || []).map((row) => ({
      ...row,
      role: normalizeRole(row.role),
    })));
  } catch (error) {
    res.status(500).json({ message: 'Erreur lors de la recuperation des utilisateurs' });
  }
};

exports.addUser = async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const { name, email, password, role, phone } = req.body;
    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: 'Tous les champs sont requis' });
    }
    const normalizedRole = normalizeRole(role);
    if (!allowedUserRoles.has(normalizedRole)) {
      return res.status(400).json({ message: 'Role utilisateur invalide' });
    }
    const normalizedEmail = String(email || '').trim().toLowerCase();
    try {
      await ensureUniqueUserEmail(normalizedEmail, schoolId);
    } catch (emailError) {
      if (emailError.message === 'USER_EMAIL_EXISTS') {
        return res.status(400).json({ message: 'Un utilisateur avec cet email existe deja' });
      }
      return res.status(400).json({ message: 'Adresse email invalide' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await run(
      `INSERT INTO users (name, email, password, role, school_id, phone, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [name, normalizedEmail, hashedPassword, normalizedRole, schoolId, phone || null]
    );
    res.status(201).json({ id: result.id });
  } catch (error) {
    console.error(error);
    if (String(error.message || '').includes('UNIQUE')) {
      return res.status(400).json({ message: 'Un utilisateur avec cet email existe deja' });
    }
    res.status(500).json({ message: "Erreur lors de l'ajout de l'utilisateur" });
  }
};

exports.updateUser = async (req, res) => {
  try {
    const schoolId = req.user.school_id;
    const { name, email, role, phone, is_active } = req.body;
    const normalizedRole = normalizeRole(role);
    if (!allowedUserRoles.has(normalizedRole)) {
      return res.status(400).json({ message: 'Role utilisateur invalide' });
    }
    const normalizedEmail = String(email || '').trim().toLowerCase();
    try {
      await ensureUniqueUserEmail(normalizedEmail, schoolId, req.params.id);
    } catch (emailError) {
      if (emailError.message === 'USER_EMAIL_EXISTS') {
        return res.status(400).json({ message: 'Un autre utilisateur utilise deja cet email' });
      }
      return res.status(400).json({ message: 'Adresse email invalide' });
    }
    const result = await run(
      `UPDATE users
       SET name = ?, email = ?, role = ?, phone = ?, is_active = ?
       WHERE id = ? AND school_id = ?`,
      [name, normalizedEmail, normalizedRole, phone || null, is_active ? 1 : 0, req.params.id, schoolId]
    );
    if (!result.changes) return res.status(404).json({ message: 'Utilisateur non trouve' });
    res.json({ message: 'Utilisateur mis a jour' });
  } catch (error) {
    console.error(error);
    if (String(error.message || '').includes('UNIQUE')) {
      return res.status(400).json({ message: 'Un autre utilisateur utilise deja cet email' });
    }
    res.status(500).json({ message: 'Erreur lors de la mise a jour' });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    const result = await run('DELETE FROM users WHERE id = ? AND school_id = ?', [req.params.id, req.user.school_id]);
    if (!result.changes) return res.status(404).json({ message: 'Utilisateur non trouve' });
    res.json({ message: 'Utilisateur supprime' });
  } catch (error) {
    res.status(500).json({ message: 'Erreur lors de la suppression' });
  }
};
