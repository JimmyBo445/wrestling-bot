const fs = require('fs');
const path = require('path');
const { pool } = require('./pool');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const LOCK_KEY = 727001; // arbitrary constant: only one instance migrates at a time

/**
 * Applies any .sql file in src/db/migrations that has not been applied yet,
 * in filename order. Safe to call on every startup. Uses a Postgres advisory
 * lock so two bot instances starting together can't run migrations twice.
 */
async function runMigrations(log = console.log) {
    const client = await pool.connect();
    try {
        await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
        await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
            name TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);

        const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
        const { rows } = await client.query('SELECT name FROM schema_migrations');
        const done = new Set(rows.map((r) => r.name));

        let applied = 0;
        for (const file of files) {
            if (done.has(file)) continue;
            const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
            log(`Applying migration ${file}...`);
            try {
                await client.query('BEGIN');
                await client.query(sql);
                await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
                await client.query('COMMIT');
                applied += 1;
            } catch (err) {
                await client.query('ROLLBACK').catch(() => {});
                throw new Error(`Migration ${file} failed: ${err.message}`);
            }
        }
        log(applied ? `Applied ${applied} migration(s).` : 'Database is up to date.');
    } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
        client.release();
    }
}

module.exports = { runMigrations };
