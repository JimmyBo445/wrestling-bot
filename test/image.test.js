const assert = require('assert');
const dns = require('dns').promises;
const { createCanvas } = require('@napi-rs/canvas');
const fs = require('fs');

// fake network: art.example.com -> public, evil.example.com -> 10.0.0.5
dns.lookup = async (host) => [{ address: host === 'evil.example.com' ? '10.0.0.5' : '93.184.216.34' }];
const art = (w, h, color) => { const c = createCanvas(w, h); const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, color); g.addColorStop(1, '#222'); x.fillStyle = g; x.fillRect(0, 0, w, h); x.fillStyle = '#fff'; x.beginPath(); x.arc(w / 2, h / 3, w / 5, 0, 7); x.fill(); x.fillRect(w / 4, h / 2, w / 2, h / 2); return c.toBuffer('image/png'); };
const png = art(600, 800, '#2a6fdb');
const calls = [];
global.fetch = async (url, opts) => {
    calls.push(url);
    const u = new URL(url);
    if (u.pathname === '/redirect') return { status: 302, ok: false, headers: new Map([['location', '/real.png']]) };
    if (u.pathname === '/real.png') return { status: 200, ok: true, headers: new Map([['content-type', 'image/png']]), arrayBuffer: async () => png };
    if (u.pathname === '/page.html') return { status: 200, ok: true, headers: new Map([['content-type', 'text/html']]), arrayBuffer: async () => Buffer.from('<html>') };
    if (u.pathname === '/big.png') return { status: 200, ok: true, headers: new Map([['content-type', 'image/png'], ['content-length', String(20 * 1024 * 1024)]]), arrayBuffer: async () => png };
    return { status: 404, ok: false, headers: new Map() };
};
const { validateImageUrl, fetchImageBuffer } = require('../src/utils/imageUrl');
(async () => {
    assert.deepStrictEqual(await validateImageUrl('https://art.example.com/real.png'), { ok: true });
    assert.deepStrictEqual(await validateImageUrl('https://art.example.com/redirect'), { ok: true });
    for (const [u, re] of [['http://art.example.com/real.png', /https/], ['https://evil.example.com/real.png', /private/], ['https://art.example.com/page.html', /not a picture/], ['https://art.example.com/big.png', /too big/], ['https://art.example.com/missing.png', /error 404/], ['https://127.0.0.1/x.png', /normal website/]]) {
        const v = await validateImageUrl(u);
        assert.ok(!v.ok && re.test(v.error), `${u} -> ${JSON.stringify(v)}`);
    }
    const before = calls.length;
    assert.ok(await fetchImageBuffer('https://art.example.com/real.png'));
    assert.ok(await fetchImageBuffer('https://art.example.com/real.png'));
    assert.strictEqual(calls.length - before, 1, 'second fetch served from cache');
    assert.strictEqual(await fetchImageBuffer('https://evil.example.com/real.png'), null);
    console.log('image validation ok');

    // render cards that use art
    const { renderMatchCard } = require('../src/cards/matchCard');
    const { renderProfileCard } = require('../src/cards/profileCard');
    const m = (name, winner = false, url = 'https://art.example.com/real.png') => ({ name, division: 'mens', imageUrl: url, owner: 'jimmy', winner });
    const out = process.argv[2];
    fs.writeFileSync(`${out}/art_match.png`, await renderMatchCard({ label: 'Singles', matchId: 7, resultType: 'decisive', mode: 'sides', banner: { kind: 'title', text: 'Championship Match • World Heavyweight Championship' }, outcome: 'And new champion: Titan', sides: [{ name: null, winner: true, members: [m('Titan', true)] }, { name: null, winner: false, members: [m('Broken Link', false, 'https://evil.example.com/x.png')] }] }));
    fs.writeFileSync(`${out}/art_tag.png`, await renderMatchCard({ label: 'Tag Team (2v2)', matchId: 8, resultType: 'decisive', mode: 'sides', sides: [{ name: 'Wolf Pack', winner: true, members: [m('Wolf', true), m('Hawk', true)] }, { name: 'Old Guard', winner: false, members: [m('Titan'), m('Fox')] }] }));
    fs.writeFileSync(`${out}/art_profile.png`, await renderProfileCard({ character: { name: 'Titan', division: 'mens', imageUrl: 'https://art.example.com/real.png', alignment: 'face', bio: 'x', status: 'approved' }, ownerName: 'jimmy', summary: { wins: 3, losses: 1, draws: 0, ncs: 0, total: 4, winPct: 75, streaks: { current: 2, direction: 'win', longestWin: 3, longestLoss: 1 }, form: ['W', 'W', 'L', 'W'], byType: { singles: { w: 3, l: 1, d: 0 } } }, titlesHeld: [], reigns: 1, defenses: 0, teamName: null }));
    console.log('art cards rendered');
})().catch((e) => { console.error(e); process.exit(1); });
