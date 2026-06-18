// check-triggers.js
const { Pool } = require('pg');
require('dotenv').config(); // si vous utilisez dotenv

// Configuration de la connexion PostgreSQL (adaptez selon vos variables)
const pool = new Pool({
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  host: process.env.DATABASE_HOST,
  port: process.env.DATABASE_PORT,
  database: process.env.DATABASE_NAME,
});
console.log('user:', process.env.DATABASE_USER);
console.log('password:', process.env.DATABASE_PASSWORD);
console.log('host:', process.env.DATABASE_HOST);
console.log('port:', process.env.DATABASE_PORT);
console.log('database:', process.env.DATABASE_NAME);
console.log(pool.options); // Affiche les options de connexion pour vérifier
async function checkTriggers() {
  const query = `
    SELECT conname, conrelid::regclass, contype, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'notifications_school_unique_key';
  `;

  try {
    const res = await pool.query(query);
    console.log('Triggers trouvés :');
    console.table(res.rows);
  } catch (err) {
    console.error('Erreur lors de la vérification des triggers:', err.message);
  } finally {
    await pool.end();
  }
}

checkTriggers();