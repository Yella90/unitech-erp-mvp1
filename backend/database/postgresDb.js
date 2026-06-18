const path = require('node:path');
try {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
} catch {
  // En production, les variables sont fournies par l'environnement.
}
const { Pool } = require('pg');

function safeDecodeUriComponent(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function buildConnectionStringFromParts() {
  const host = String(
    process.env.DATABASE_HOST ||
    process.env.POSTGRES_HOST ||
    process.env.host ||
    process.env.HOST ||
    ''
  ).trim();
  const user = String(
    process.env.DATABASE_USER ||
    process.env.POSTGRES_USER ||
    process.env.user ||
    process.env.USER ||
    ''
  ).trim();
  const passwordWithDatabaseFallback = safeDecodeUriComponent(
    process.env.DATABASE_PASSWORD ||
    process.env.POSTGRES_PASSWORD ||
    process.env.PASSWORD ||
    ''
  );
  const database = String(
    process.env.DATABASE_NAME ||
    process.env.POSTGRES_DB ||
    process.env.Database ||
    process.env.DATABASE ||
    process.env.DB_NAME ||
    'postgres'
  ).trim() || 'postgres';
  const port = String(
    process.env.DATABASE_PORT ||
    process.env.POSTGRES_PORT ||
    process.env.Database_port ||
    process.env.PORT_PG ||
    '5432'
  ).trim() || '5432';

  if (!host || !user) return '';

  const encodedUser = encodeURIComponent(user);
  const encodedPassword = passwordWithDatabaseFallback ? `:${encodeURIComponent(passwordWithDatabaseFallback)}` : '';
  return `postgresql://${encodedUser}${encodedPassword}@${host}:${port}/${database}`;
}

const connectionString =
  buildConnectionStringFromParts() ||
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DATABASE_URL ||
  process.env.POSTGRES_POOLER_URL ||
  process.env.POSTGRES_POOLER_UR ||
  process.env.POSTGRES_URL ||
  '';
if (!connectionString) {
  throw new Error('DATABASE_URL est requis pour utiliser PostgreSQL/Supabase');
}

const useSsl = String(process.env.DATABASE_SSL || process.env.SUPABASE_SSL || '').toLowerCase() === 'true'
  || /supabase\.co/i.test(connectionString)
  || String(process.env.NODE_ENV || '').toLowerCase() === 'production';

const pool = new Pool({
  connectionString,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
});

const { ensurePostgresSchema } = require('./postgresSchema');
async function rawQuery(sql, params = []) {
  return pool.query(sql, params);
}

const ready = ensurePostgresSchema({ query: rawQuery });

function replaceQuestionMarks(sql, paramsLength) {
  let index = 0;
  let inSingleQuote = false;
  let result = '';

  for (let position = 0; position < sql.length; position += 1) {
    const char = sql[position];
    if (char === "'") {
      result += char;
      if (sql[position + 1] === "'") {
        result += sql[position + 1];
        position += 1;
      } else {
        inSingleQuote = !inSingleQuote;
      }
      continue;
    }

    if (!inSingleQuote && char === '?') {
      index += 1;
      result += `$${index}`;
      continue;
    }

    result += char;
  }

  if (paramsLength && index !== paramsLength) {
    // Best-effort guard, but keep going so the database can raise a useful error if needed.
  }

  return result;
}

function normalizeSql(sql = '') {
  let normalized = String(sql || '').trim();
  const isIgnoreInsert = /\bINSERT\s+OR\s+IGNORE\s+INTO\b/i.test(normalized);

  normalized = normalized.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, 'INSERT INTO');
  normalized = normalized.replace(/DATE\('now'\)/gi, 'CURRENT_DATE');
  normalized = normalized.replace(/DATE\(ss\.expires_at\)/gi, '(ss.expires_at)::date');
  normalized = normalized.replace(/strftime\('%Y-%m',\s*COALESCE\(date_payement,\s*created_at\)\)/gi, "to_char(COALESCE(date_payement, created_at)::date, 'YYYY-MM')");
  normalized = normalized.replace(/strftime\('%Y-%m',\s*COALESCE\(date_depenses,\s*created_at\)\)/gi, "to_char(COALESCE(date_depenses, created_at)::date, 'YYYY-MM')");
  normalized = normalized.replace(/strftime\('%Y-%m',\s*COALESCE\(date_retrait,\s*created_at\)\)/gi, "to_char(COALESCE(date_retrait, created_at)::date, 'YYYY-MM')");
  normalized = normalized.replace(/\bINTEGER\s+PRIMARY\s+KEY\b/gi, 'BIGSERIAL PRIMARY KEY');
  normalized = normalized.replace(/\bDATETIME\b/gi, 'TIMESTAMP');

  if (isIgnoreInsert) {
    normalized = `${normalized} ON CONFLICT DO NOTHING`;
  }

  if (/^\s*INSERT\s+INTO\b/i.test(normalized) && !/\bRETURNING\b/i.test(normalized) && !/INSERT\s+INTO\s+sync_state\b/i.test(normalized)) {
    normalized = `${normalized} RETURNING id`;
  }

  return normalized;
}

async function execute(sql, params = []) {
  await ready;
  const normalizedSql = replaceQuestionMarks(normalizeSql(sql), params.length);
  console.log('🔍 SQL EXECUTED:', normalizedSql);
  console.log('📦 PARAMS:', params);
  const result = await rawQuery(normalizedSql, params);
  return result;
}

async function queryOne(sql, params = []) {
  const result = await execute(sql, params);
  return result.rows[0] || null;
}

function run(sql, params = [], callback) {
  let actualParams = params;
  let actualCallback = callback;

  if (typeof params === 'function') {
    actualCallback = params;
    actualParams = [];
  }

  const promise = execute(sql, actualParams)
    .then((result) => ({
      id: result.rows?.[0]?.id ?? null,
      lastID: result.rows?.[0]?.id ?? null,
      changes: result.rowCount || 0,
    }));

  if (typeof actualCallback === 'function') {
    promise
      .then((result) => {
        actualCallback.call(result, null);
      })
      .catch((error) => {
        actualCallback.call({ id: null, lastID: null, changes: 0 }, error);
      });
    return undefined;
  }

  return promise;
}

function get(sql, params = [], callback) {
  let actualParams = params;
  let actualCallback = callback;

  if (typeof params === 'function') {
    actualCallback = params;
    actualParams = [];
  }

  const promise = queryOne(sql, actualParams);

  if (typeof actualCallback === 'function') {
    promise
      .then((row) => actualCallback(null, row))
      .catch((error) => actualCallback(error));
    return undefined;
  }

  return promise;
}

function all(sql, params = [], callback) {
  let actualParams = params;
  let actualCallback = callback;

  if (typeof params === 'function') {
    actualCallback = params;
    actualParams = [];
  }

  const promise = execute(sql, actualParams).then((result) => result.rows);

  if (typeof actualCallback === 'function') {
    promise
      .then((rows) => actualCallback(null, rows))
      .catch((error) => actualCallback(error));
    return undefined;
  }

  return promise;
}

function close(callback) {
  if (typeof callback === 'function') {
    ready.then(() => pool.end())
      .then(() => callback())
      .catch((error) => callback(error));
    return undefined;
  }

  return ready.then(() => pool.end());
}

function serialize(callback) {
  if (typeof callback === 'function') {
    return callback();
  }
  return undefined;
}
pool.on('error', (err) => console.error('Erreur pool PG:', err));
pool.on('connect', () => console.log('Nouvelle connexion PG'));
module.exports = {
  run,
  get,
  all,
  close,
  serialize,
  query: execute,
  ready,
};
