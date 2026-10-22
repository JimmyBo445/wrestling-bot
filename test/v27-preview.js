const fs = require('fs');
const f = require('./fixtures');
const { run, hasFile } = require('./mock');
(async () => {
    const out = process.argv[2];
    await f.resetDb(); await f.ensureGuild('g1');
    const ADM = { admin: true, user: 'admin1' };
    const id = {};
    const names = ['Titan', 'Fox', 'Bull', 'Wolf', 'Hawk', 'Raven', 'Jackal', 'Viper'];
    for (const [i, n] of names.entries()) id[n] = await f.makeChar('g1', `u${i}`, n, 'mens');
    const US = await f.titleId('g1', 'United States Championship');
    const WH = await f.titleId('g1', 'World Heavyweight Championship');
    const save = (i, name) => { const r = i.responses.find((x) => x.p?.files?.length); if (r) fs.writeFileSync(`${out}/${name}.png`, r.p.files[0].attachment); else console.log('no file for', name, JSON.stringify(i.responses.map((x) => x.p?.content))); };
    await run('character', 'story', { character: id.Titan, signatures: 'Powerbomb, Spear, Chokeslam', catchphrase: 'You cannot stop the Titan!', finisher: 'Titan Drop', story: 'Raised in the steel mills.' }, { admin: true, user: 'u0' });
    await run('character', 'edit', { character: id.Titan, bio: 'Unstoppable force from the steel city', alignment: 'heel', entrance_theme: 'Thunder' }, { admin: true, user: 'u0' });
    for (let k = 0; k < 11; k++) await run('match', 'log-singles', { participant1: id.Titan, participant2: id[names[1 + (k % 7)]], winner: 1, override_cooldown: true }, ADM);
    await run('championship', 'backfill-reign', { title: US, won_date: '2026-03-01', lost_date: '2026-05-01', character: id.Titan }, ADM);
    await run('championship', 'backfill-reign', { title: WH, won_date: '2026-06-01', character: id.Titan, defenses: 6 }, ADM);
    const m = await run('match', 'log-singles', { participant1: id.Titan, participant2: id.Fox, winner: 1, override_cooldown: true, stipulation: 'Hell in a Cell', finish: 'knockout', score: '1-0', notes: 'Carried out on a stretcher.' }, ADM);
    save(m, 'match_stip');
    const mid = (await f.pool.query(`select max(id) as id from matches`)).rows[0].id;
    await run('match', 'rate', { match_id: mid, stars: 5 }, ADM);
    const tm = await run('championship', 'log-singles-title-match', { title: WH, champion_or_p1: id.Titan, challenger_or_p2: id.Bull, winner: 1, stipulation: 'Ladder Match', finish: 'escape' }, ADM);
    save(tm, 'match_title_ladder');
    await run('championship', 'log-singles-title-match', { title: WH, champion_or_p1: id.Titan, challenger_or_p2: id.Wolf, winner: 2 }, ADM);
    await run('championship', 'log-singles-title-match', { title: WH, champion_or_p1: id.Wolf, challenger_or_p2: id.Titan, winner: 2, stipulation: 'Iron Man', score: '3-2' }, ADM);
    save(await run('character', 'profile', { character: id.Titan }), 'profile_badges');
    save(await run('stats', 'timeline', { character: id.Titan }), 'timeline');
    await run('tournament', 'create', { name: 'King of the Ring', division: 'mens', title: US }, ADM);
    const tid = (await f.pool.query(`select id from tournaments`)).rows[0].id;
    await run('tournament', 'add', { tournament: tid, wrestler1: id.Titan, wrestler2: id.Fox, wrestler3: id.Bull, wrestler4: id.Wolf, wrestler5: id.Hawk, wrestler6: id.Raven }, ADM);
    save(await run('tournament', 'start', { tournament: tid }, ADM), 'bracket_start');
    for (let g = 0; g < 4; g++) {
        const open = (await f.pool.query(`select * from tournament_matches where tournament_id=$1 and winner_id is null and a_id is not null and b_id is not null order by round, slot limit 1`, [tid])).rows[0];
        if (!open) break;
        await run('match', 'log-singles', { participant1: String(open.a_id), participant2: String(open.b_id), winner: 1, override_cooldown: true }, ADM);
    }
    save(await run('tournament', 'bracket', { tournament: tid }), 'bracket_mid');
    for (let g = 0; g < 6; g++) {
        const open = (await f.pool.query(`select * from tournament_matches where tournament_id=$1 and winner_id is null and a_id is not null and b_id is not null order by round, slot limit 1`, [tid])).rows[0];
        if (!open) break;
        await run('match', 'log-singles', { participant1: String(open.a_id), participant2: String(open.b_id), winner: 1, override_cooldown: true }, ADM);
    }
    save(await run('tournament', 'bracket', { tournament: tid }), 'bracket_done');
    await f.pool.end();
})();
