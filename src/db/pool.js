require('dotenv').config();
const { Pool } = require('pg');

// Railway injects DATABASE_URL automatically when you attach a Postgres plugin.
// SSL is required on Railway's managed Postgres.
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')
        ? { rejectUnauthorized: false }
        : false
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle Postgres client', err);
});

async function query(text, params) {
    return pool.query(text, params);
}

async function withTransaction(fn) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

module.exports = { pool, query, withTransaction };
