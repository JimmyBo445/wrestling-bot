const { runMigrations } = require('./migrator');
const { pool } = require('./pool');

// Manual fallback: `npm run migrate`. The bot also does this automatically on startup.
runMigrations()
    .then(() => pool.end())
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
