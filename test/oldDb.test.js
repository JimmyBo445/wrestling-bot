// Smoke test: the real upgrade path. wrestle_old was built with the ORIGINAL schema and old-style data.
process.env.DATABASE_URL = 'postgres://postgres:pw@localhost:54329/wrestle_old';
const assert = require('assert');
const { runMigrations } = require('../src/db/migrator');
const { run, text, hasFile } = require('./mock');
const { pool } = require('../src/db/pool');
(async () => {
    await runMigrations(() => {});
    // The old data used guild 'g1' with titles inserted by hand (only 1). ensureGuild tops up the rest.
    const c = await run('championship', 'list', {});
    console.log(text(c).slice(0, 300));
    assert.ok(!/⚠️/.test(text(c)), text(c));
    const { rows } = await pool.query(`select id from characters order by id limit 1`);
    const p = await run('character', 'profile', { character: rows[0].id });
    assert.ok(hasFile(p), text(p));
    const lb = await run('leaderboard', null, {});
    assert.match(text(lb), /Leaderboard/);
    const { rows: t } = await pool.query(`select count(*)::int n from titles where guild_id='g1'`);
    console.log('titles after upgrade:', t[0].n);
    await pool.end();
    console.log('old-db upgrade smoke test ok');
})().catch((e) => { console.error(e); process.exit(1); });
