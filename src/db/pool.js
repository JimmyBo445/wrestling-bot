require('dotenv').config();
const { Pool } = require('pg');

// Railway injects DATABASE_URL when you link the Postgres service to the bot.
// Railway's database wants SSL; set DATABASE_SSL=false if yours does not.
const url = process.env.DATABASE_URL || '';
const useSsl = process.env.DATABASE_SSL
    ? process.env.DATABASE_SSL !== 'false'
    : url.includes('railway') || url.includes('rlwy.net');

const pool = new Pool({
    connectionString: url,
    ssl: useSsl ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
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
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

module.exports = { pool, query, withTransaction };
