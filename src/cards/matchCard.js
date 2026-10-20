const { createCanvas } = require('@napi-rs/canvas');
const {
    font, C, themeOf, rr, fitText, wrapLines, drawCover, loadArt, placeholderArt, baseBackground, chip, serverTag
} = require('./common');

/**
 * data: {
 *   label, matchId, resultType ('decisive'|'draw'|'no_contest'), notes,
 *   mode: 'sides' | 'ffa',
 *   banner: { kind:'title'|'contender', text } | null,
 *   outcome: string|null   // e.g. "AND NEW CHAMPION!" / "RETAINS"
 *   sides: [{ name|null, winner:boolean, members:[{ name, division, imageUrl, owner, winner }] }]   (mode sides)
 *   entrants: [{ name, division, imageUrl, owner, winner }]                                     (mode ffa)
 * }
 */
async function renderMatchCard(data) {
    const W = 1000;
    const decisive = data.resultType === 'decisive';
    const all = data.mode === 'ffa' ? data.entrants : data.sides.flatMap((s) => s.members);
    const accent = themeOf(all[0]?.division).accent;

    // ---- layout ----
    const headerH = data.banner ? 150 : 110;
    let bodyH;
    let perSide = 1;
    let cols = 1;
    if (data.mode === 'sides') {
        perSide = Math.max(...data.sides.map((s) => s.members.length));
        bodyH = perSide === 1 ? 330 : 56 + perSide * 96 + 20;
    } else {
        const n = data.entrants.length;
        cols = n <= 3 ? n : n === 4 ? 4 : 3;
        const rows = Math.ceil(n / cols);
        bodyH = rows === 1 ? 330 : rows * 190 + (rows - 1) * 16;
    }
    const footerH = 112 + (data.notes ? 30 : 0);
    const H = headerH + bodyH + footerH;

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    baseBackground(ctx, W, H, accent);

    // preload art for everyone in parallel
    const arts = await Promise.all(all.map((m) => loadArt(m.imageUrl)));
    const artOf = new Map(all.map((m, i) => [m, arts[i]]));

    // ---- header ----
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, W, 6);
    ctx.textAlign = 'left';
    ctx.fillStyle = C.text;
    ctx.font = font(30, 'bold');
    ctx.fillText(data.label.toUpperCase(), 40, 56);
    ctx.fillStyle = C.sub;
    ctx.font = font(16, 'medium');
    const resultWord = decisive ? 'OFFICIAL RESULT' : data.resultType === 'draw' ? 'DRAW' : 'NO CONTEST';
    ctx.fillText(resultWord, 40, 84);
    ctx.textAlign = 'right';
    ctx.fillStyle = C.sub;
    ctx.fillText(`MATCH #${data.matchId}`, W - 40, 56);
    serverTag(ctx, data.serverName, W - 40, 84, { size: 14 });
    ctx.textAlign = 'left';

    if (data.banner) {
        const isTitle = data.banner.kind === 'title';
        const bx = 40, by = 100, bw = W - 80, bh = 38;
        const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
        g.addColorStop(0, isTitle ? C.goldDark : '#a85a10');
        g.addColorStop(0.5, isTitle ? C.gold : C.orange);
        g.addColorStop(1, isTitle ? C.goldDark : '#a85a10');
        ctx.fillStyle = g;
        rr(ctx, bx, by, bw, bh, 8);
        ctx.fill();
        ctx.fillStyle = '#17120a';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        fitText(ctx, data.banner.text.toUpperCase(), W / 2, by + bh / 2 + 1, bw - 40, 20, 'bold', 12);
        ctx.textBaseline = 'alphabetic';
        ctx.textAlign = 'left';
    }

    // ---- tiles ----
    const drawPortraitTile = (m, x, y, w, h) => {
        ctx.save();
        rr(ctx, x, y, w, h, 18);
        ctx.clip();
        const art = artOf.get(m);
        if (art) drawCover(ctx, art, x, y, w, h); else placeholderArt(ctx, x, y, w, h, m.name, m.division);
        const g = ctx.createLinearGradient(0, y + h * 0.5, 0, y + h);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, 'rgba(0,0,0,0.88)');
        ctx.fillStyle = g;
        ctx.fillRect(x, y, w, h);
        if (decisive && !m.winner) { ctx.fillStyle = 'rgba(8,8,10,0.5)'; ctx.fillRect(x, y, w, h); }
        ctx.restore();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        fitText(ctx, m.name, x + w / 2, y + h - 34, w - 24, h > 200 ? 30 : 22, 'bold', 14);
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        fitText(ctx, `@${m.owner}`, x + w / 2, y + h - 12, w - 24, 14, 'medium', 10);
        ctx.textAlign = 'left';
        if (decisive && m.winner) {
            ctx.strokeStyle = C.gold; ctx.lineWidth = 5;
            rr(ctx, x + 2.5, y + 2.5, w - 5, h - 5, 16); ctx.stroke();
            chip(ctx, '★ WINNER', x + 12, y + 12, { bg: C.gold, fg: '#17120a', size: 14, h: 26 });
        }
    };

    const drawRowTile = (m, x, y, w, h) => {
        ctx.fillStyle = C.panel2;
        rr(ctx, x, y, w, h, 14); ctx.fill();
        const s = h - 16;
        ctx.save();
        rr(ctx, x + 8, y + 8, s, s, 12); ctx.clip();
        const art = artOf.get(m);
        if (art) drawCover(ctx, art, x + 8, y + 8, s, s); else placeholderArt(ctx, x + 8, y + 8, s, s, m.name, m.division);
        ctx.restore();
        ctx.textAlign = 'left';
        ctx.fillStyle = decisive && !m.winner ? C.sub : C.text;
        fitText(ctx, m.name, x + s + 24, y + h / 2 - 2, w - s - 40, 24, 'bold', 14);
        ctx.fillStyle = C.sub;
        fitText(ctx, `@${m.owner}`, x + s + 24, y + h / 2 + 22, w - s - 40, 14, 'medium', 10);
        if (decisive && m.winner) {
            ctx.strokeStyle = C.gold; ctx.lineWidth = 3;
            rr(ctx, x + 1.5, y + 1.5, w - 3, h - 3, 13); ctx.stroke();
        }
    };

    const top = headerH;
    if (data.mode === 'ffa') {
        const n = data.entrants.length;
        const gap = 18;
        const tileW = (W - 80 - gap * (cols - 1)) / cols;
        const rows = Math.ceil(n / cols);
        const tileH = rows === 1 ? 330 : 190;
        data.entrants.forEach((m, i) => {
            const r = Math.floor(i / cols), c = i % cols;
            const inRow = r === rows - 1 ? n - r * cols : cols;
            const rowOffset = ((cols - inRow) * (tileW + gap)) / 2; // centre a short last row
            drawPortraitTile(m, 40 + rowOffset + c * (tileW + gap), top + r * (tileH + 16), tileW, tileH);
        });
    } else {
        const colW = 410;
        const xs = [40, W - 40 - colW];
        data.sides.forEach((side, si) => {
            const x = xs[si];
            if (perSide === 1) {
                drawPortraitTile(side.members[0], x, top, colW, 330);
            } else {
                // side header (team name)
                ctx.textAlign = 'left';
                ctx.fillStyle = decisive && side.winner ? C.gold : C.sub;
                ctx.font = font(18, 'bold');
                const title = side.name ? side.name.toUpperCase() : `TEAM ${si + 1}`;
                fitText(ctx, `${decisive && side.winner ? '★ ' : ''}${title}`, x, top + 30, colW, 18, 'bold', 12);
                side.members.forEach((m, mi) => drawRowTile(m, x, top + 48 + mi * 96, colW, 86));
            }
            if (perSide === 1 && side.name) {
                // single wrestlers don't carry a team label
            }
        });
        // VS badge
        const cx = W / 2, cy = top + (perSide === 1 ? 165 : 48 + (perSide * 96) / 2);
        ctx.fillStyle = '#0d0d11';
        ctx.beginPath(); ctx.arc(cx, cy, 36, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = accent; ctx.lineWidth = 3; ctx.stroke();
        ctx.fillStyle = C.text;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = font(28, 'bold');
        ctx.fillText('VS', cx, cy + 2);
        ctx.textBaseline = 'alphabetic';
    }

    // ---- footer ----
    const fy = headerH + bodyH + 18;
    ctx.fillStyle = C.line;
    ctx.fillRect(40, fy, W - 80, 2);
    ctx.textAlign = 'center';
    if (decisive) {
        const winners = data.mode === 'ffa'
            ? data.entrants.filter((m) => m.winner).map((m) => m.name)
            : data.sides.filter((s) => s.winner).map((s) => s.name || s.members.map((m) => m.name).join(' & '));
        ctx.fillStyle = C.gold;
        fitText(ctx, `WINNER${winners.length > 1 ? 'S' : ''}: ${winners.join(' & ')}`, W / 2, fy + 40, W - 120, 28, 'bold', 16);
        if (data.outcome) {
            ctx.fillStyle = C.text;
            fitText(ctx, data.outcome.toUpperCase(), W / 2, fy + 72, W - 120, 20, 'bold', 13);
        }
    } else {
        ctx.fillStyle = C.sub;
        fitText(ctx, data.resultType === 'draw' ? 'THE MATCH ENDED IN A DRAW' : 'THE MATCH ENDED IN A NO CONTEST', W / 2, fy + 44, W - 120, 24, 'bold', 14);
        if (data.outcome) {
            ctx.fillStyle = C.text;
            fitText(ctx, data.outcome.toUpperCase(), W / 2, fy + 72, W - 120, 18, 'bold', 12);
        }
    }
    if (data.notes) {
        ctx.fillStyle = C.sub;
        ctx.font = font(15, 'medium');
        const lines = wrapLines(ctx, `“${data.notes}”`, W - 140, 1);
        ctx.fillText(lines[0], W / 2, fy + 100);
    }
    ctx.textAlign = 'left';
    return canvas.toBuffer('image/png');
}

module.exports = { renderMatchCard };
