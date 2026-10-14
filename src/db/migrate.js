const fs = require('fs');
const path = require('path');
const { pool } = require('./pool');

async function migrate() {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    console.log('Applying schema...');
    await pool.query(schema);
    console.log('Schema applied successfully.');
    await pool.end();
}

if (require.main === module) {
    migrate().catch((err) => {
        console.error('Migration failed:', err);
        process.exit(1);
    });
}

module.exports = { migrate };
