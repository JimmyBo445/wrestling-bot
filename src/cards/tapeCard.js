const { createCanvas } = require('@napi-rs/canvas');
const { font, C, themeOf, rr, fitText, drawCover, loadArt, placeholderArt, baseBackground, serverTag, formColor } = require('./common');

/**
 * Tale of the tape.
 * data: {
 *   serverName, division, label, title: string|null,
 *   left / right: { name, owner|null, members:[{name,imageUrl,division}], wins, losses, draws, winPct,
 *                   streak:{current,direction}, longestWin, titles:[string], reigns, form:['W'|'L'|'D'|'NC'] },
 *   h2h: { a, b, d, total, lastDate|null, note|null }
 * }
 */
const W = 1000;

function portraits(ctx, side, cx, top, arts, division) {
    const n = Math.min(side.members.length, 4);
    const size = n === 1 ? 210 : n === 2 ? 150 : n === 3 ? 120 : 100;
    const gap = 12;
    const total = n * size + (n - 1) * gap;
    let x = cx - total / 2;
    for (const m of side.members.slice(0, n)) {
        const art = arts.get(m.imageUrl) || null;
        ctx.save();
        rr(ctx, x, top + (210 - size) / 2, size, size, 20); ctx.clip();
        if (art) drawCover(ctx, art, x, top + (210 - size) / 2, size, size, 0.2);
        else placeholderArt(ctx, x, top + (210 - size) / 2, size, size, m.name, m.division || division);
        ctx.restore();
        ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 3;
        rr(ctx, x + 1.5, top + (210 - size) / 2 + 1.5, size - 3, size - 3, 19); ctx.stroke();
        x += size + gap;
    }
}

function statRow(ctx, y, label, lv, rv, { better = null, lc = null, rc = null } = {}) {
    // better: 'l' | 'r' | null
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    rr(ctx, 30, y, W - 60, 50, 12); ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = C.sub; ctx.font = font(14, 'bold');
    ctx.fillText(label, W / 2, y + 31);
    const draw = (txt, cx, win, col) => {
        ctx.fillStyle = col || (win ? C.gold : C.text);
        fitText(ctx, String(txt), cx, y + 34, 300, win ? 26 : 24, 'bold', 12);
    };
    draw(lv, 230, better === 'l', lc);
    draw(rv, W - 230, better === 'r', rc);
    ctx.textAlign = 'left';
}

const cmp = (a, b, higherBetter = true) => (a === b ? null : (a > b) === higherBetter ? 'l' : 'r');
const rec = (s) => `${s.wins}-${s.losses}${s.draws ? `-${s.draws}` : ''}`;
const streakVal = (s) => (s.streak.current ? `${s.streak.direction === 'win' ? 'W' : 'L'}${s.streak.current}` : '—');
const streakScore = (s) => (s.streak.direction === 'win' ? s.streak.current : -s.streak.current) || 0;

async function renderTapeCard(data) {
    const L = data.left, R = data.right;
    const th = themeOf(data.division);
    const hasTitles = L.titles.length || R.titles.length;
    const H = 960;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    baseBackground(ctx, W, H, data.title ? C.gold : th.accent);

    const urls = [...L.members, ...R.members].map((m) => m.imageUrl).filter(Boolean);
    const arts = new Map();
    await Promise.all([...new Set(urls)].map(async (u) => arts.set(u, await loadArt(u))));

    // header
    ctx.fillStyle = data.title ? C.gold : th.accent;
    ctx.fillRect(0, 0, W, 8);
    serverTag(ctx, data.serverName, W / 2, 34, { align: 'center', size: 13 });
    ctx.textAlign = 'center';
    ctx.fillStyle = C.text;
    ctx.font = font(40, 'bold');
    ctx.fillText('TALE OF THE TAPE', W / 2, 82);
    ctx.fillStyle = data.title ? C.gold : C.sub;
    fitText(ctx, data.title ? `CHAMPIONSHIP MATCH  •  ${data.title.toUpperCase()}` : `${data.label.toUpperCase()}  •  ${th.label.toUpperCase()} DIVISION`, W / 2, 112, W - 80, 17, 'bold', 11);
    ctx.textAlign = 'left';

    // portraits + names
    portraits(ctx, L, 230, 135, arts, data.division);
    portraits(ctx, R, W - 230, 135, arts, data.division);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.textAlign = 'center'; ctx.font = font(54, 'bold');
    ctx.fillText('VS', W / 2, 262);
    for (const [side, cx] of [[L, 230], [R, W - 230]]) {
        ctx.fillStyle = C.text;
        fitText(ctx, side.name, cx, 380, 400, 32, 'bold', 16);
        ctx.fillStyle = C.sub;
        fitText(ctx, side.owner || '', cx, 404, 400, 15, 'medium', 10);
    }
    ctx.textAlign = 'left';

    // stat rows
    let y = 430;
    const row = (label, lv, rv, opts) => { statRow(ctx, y, label, lv, rv, opts); y += 58; };
    row('RECORD', rec(L), rec(R), { better: cmp(L.wins - L.losses, R.wins - R.losses) });
    row('WIN %', L.wins + L.losses ? `${L.winPct.toFixed(0)}%` : '—', R.wins + R.losses ? `${R.winPct.toFixed(0)}%` : '—', { better: cmp(L.winPct, R.winPct) });
    row('CURRENT STREAK', streakVal(L), streakVal(R), {
        better: cmp(streakScore(L), streakScore(R)),
        lc: L.streak.current ? (L.streak.direction === 'win' ? C.green : C.red) : null,
        rc: R.streak.current ? (R.streak.direction === 'win' ? C.green : C.red) : null
    });
    row('BEST WIN STREAK', L.longestWin || '—', R.longestWin || '—', { better: cmp(L.longestWin, R.longestWin) });
    row('TITLE REIGNS', L.reigns || '—', R.reigns || '—', { better: cmp(L.reigns, R.reigns) });
    row('CHAMPION OF', L.titles.length ? L.titles.join(' • ') : '—', R.titles.length ? R.titles.join(' • ') : '—', {
        lc: L.titles.length ? C.gold : null, rc: R.titles.length ? C.gold : null });
    void hasTitles;

    // form
    ctx.fillStyle = C.sub; ctx.font = font(14, 'bold'); ctx.textAlign = 'center';
    ctx.fillText('LAST 5', W / 2, y + 24);
    for (const [side, cx] of [[L, 230], [R, W - 230]]) {
        const f = side.form;
        const start = cx - (f.length * 42 - 8) / 2;
        f.forEach((r, i) => {
            ctx.fillStyle = formColor(r);
            rr(ctx, start + i * 42, y + 6, 34, 26, 8); ctx.fill();
            ctx.fillStyle = '#0b0b0e'; ctx.textBaseline = 'middle'; ctx.font = font(14, 'bold');
            ctx.fillText(r, start + i * 42 + 17, y + 20);
            ctx.textBaseline = 'alphabetic';
        });
        if (!f.length) { ctx.fillStyle = C.grey; ctx.font = font(14, 'medium'); ctx.fillText('no matches yet', cx, y + 24); }
    }
    y += 52;

    // head to head
    const h = data.h2h;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    rr(ctx, 30, y, W - 60, 92, 16); ctx.fill();
    ctx.strokeStyle = data.title ? C.gold : th.accent; ctx.lineWidth = 2;
    rr(ctx, 31, y + 1, W - 62, 90, 15); ctx.stroke();
    ctx.fillStyle = C.sub; ctx.font = font(14, 'bold');
    ctx.fillText('HEAD TO HEAD', W / 2, y + 26);
    if (h.total) {
        ctx.fillStyle = C.text; ctx.font = font(34, 'bold');
        ctx.fillText(`${h.a}  –  ${h.b}`, W / 2, y + 62);
        ctx.fillStyle = C.sub; ctx.font = font(14, 'medium');
        const extra = [h.d ? `${h.d} draw${h.d > 1 ? 's' : ''}` : null, `${h.total} meeting${h.total > 1 ? 's' : ''}`, h.lastDate ? `last: ${h.lastDate}` : null].filter(Boolean).join('  •  ');
        ctx.fillText(extra, W / 2, y + 82);
    } else {
        ctx.fillStyle = C.text; ctx.font = font(26, 'bold');
        ctx.fillText('First time meeting', W / 2, y + 66);
    }
    ctx.textAlign = 'left';
    return canvas.toBuffer('image/png');
}

module.exports = { renderTapeCard };
