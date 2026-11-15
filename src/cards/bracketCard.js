const { createCanvas } = require('@napi-rs/canvas');
const { font, C, themeOf, rr, fitText, drawCover, loadArt, placeholderArt, baseBackground, chip, serverTag } = require('./common');

/**
 * data: { name, division, status, rounds, titleName|null, champion:{name,imageUrl}|null, serverName,
 *         matches:[{round,slot,roundName,bye,a,b,winnerId}] }  (a/b = {id,name,imageUrl}|null)
 */
async function renderBracketCard(data) {
    const th = themeOf(data.division);
    const rounds = data.rounds || 1;
    const firstRound = data.matches.filter((m) => m.round === 1);
    const BOX_W = 220, ROW_H = 34, BLOCK_H = ROW_H * 2 + 4, GAP_Y = 18, COL_GAP = 56;
    const BLOCK1 = data.triple ? ROW_H * 3 + 8 : BLOCK_H; // 3.18: three names per first-round match
    const HEAD = 166, FOOT = 50;
    const bodyH = firstRound.length * BLOCK1 + (firstRound.length - 1) * GAP_Y;
    const champW = 230;
    const W = 40 + rounds * (BOX_W + COL_GAP) + champW + 10;
    const H = HEAD + bodyH + FOOT;
    const canvas = createCanvas(Math.max(W, 900), H);
    const ctx = canvas.getContext('2d');
    baseBackground(ctx, canvas.width, H, th.accent);
    ctx.fillStyle = th.accent; ctx.fillRect(0, 0, canvas.width, 6);
    serverTag(ctx, data.serverName, canvas.width - 40, 34);

    ctx.textAlign = 'left'; ctx.fillStyle = C.text;
    fitText(ctx, data.name.toUpperCase(), 40, 72, canvas.width - 300, 40, 'bold', 20);
    ctx.fillStyle = C.sub; ctx.font = font(16, 'medium');
    ctx.fillText(`${th.label.toUpperCase()} TOURNAMENT  •  ${data.status === 'finished' ? 'FINISHED' : data.status === 'active' ? 'IN PROGRESS' : data.status.toUpperCase()}`, 40, 100);
    if (data.titleName) chip(ctx, `WINNER GETS THE ${data.titleName.toUpperCase()}`.slice(0, 48), 40, 114, { bg: C.goldDark, fg: '#fff3cf', size: 12, h: 24 });

    // geometry: centre y of each match block
    const centre = new Map();
    for (let r = 1; r <= rounds; r++) {
        const ms = data.matches.filter((m) => m.round === r);
        for (const m of ms) {
            if (r === 1) centre.set(`${r}:${m.slot}`, HEAD + (m.slot - 1) * (BLOCK1 + GAP_Y) + BLOCK1 / 2);
            else centre.set(`${r}:${m.slot}`, (centre.get(`${r - 1}:${m.slot * 2 - 1}`) + centre.get(`${r - 1}:${m.slot * 2}`)) / 2);
        }
    }
    const xOf = (r) => 40 + (r - 1) * (BOX_W + COL_GAP);

    // round titles
    ctx.textAlign = 'center'; ctx.fillStyle = th.accent; ctx.font = font(13, 'bold');
    for (let r = 1; r <= rounds; r++) {
        const name = data.matches.find((m) => m.round === r)?.roundName || '';
        ctx.fillText(name.toUpperCase(), xOf(r) + BOX_W / 2, HEAD - 12);
    }

    // connectors first (under the boxes)
    ctx.strokeStyle = C.line; ctx.lineWidth = 2;
    for (let r = 1; r < rounds; r++) {
        for (const m of data.matches.filter((x) => x.round === r && !x.empty)) {
            const cy = centre.get(`${r}:${m.slot}`);
            const ny = centre.get(`${r + 1}:${Math.ceil(m.slot / 2)}`);
            const x1 = xOf(r) + BOX_W, x2 = xOf(r + 1), mid = x1 + COL_GAP / 2;
            ctx.beginPath(); ctx.moveTo(x1, cy); ctx.lineTo(mid, cy); ctx.lineTo(mid, ny); ctx.lineTo(x2, ny); ctx.stroke();
        }
    }
    const finalM = data.matches.find((m) => m.round === rounds);
    if (finalM) {
        const fy = centre.get(`${rounds}:1`);
        ctx.beginPath(); ctx.moveTo(xOf(rounds) + BOX_W, fy); ctx.lineTo(xOf(rounds) + BOX_W + COL_GAP, fy); ctx.stroke();
    }

    const arts = new Map();
    const ids = new Set();
    for (const m of data.matches) for (const s of [m.a, m.b, m.c]) if (s && !ids.has(s.id)) { ids.add(s.id); arts.set(s.id, loadArt(s.imageUrl)); }
    for (const [k, v] of arts) arts.set(k, await v);

    const drawRow = (slot, x, y, won, lost, bye) => {
        ctx.fillStyle = won ? '#2a2412' : C.panel;
        rr(ctx, x, y, BOX_W, ROW_H, 8); ctx.fill();
        if (won) { ctx.strokeStyle = C.gold; ctx.lineWidth = 2; rr(ctx, x + 1, y + 1, BOX_W - 2, ROW_H - 2, 7); ctx.stroke(); }
        ctx.textAlign = 'left';
        if (!slot) {
            ctx.fillStyle = C.grey; ctx.font = font(14, 'medium');
            ctx.fillText(bye ? 'BYE' : 'TBD', x + 12, y + ROW_H / 2 + 5);
            return;
        }
        const s = ROW_H - 8;
        ctx.save(); rr(ctx, x + 4, y + 4, s, s, 6); ctx.clip();
        const art = arts.get(slot.id);
        if (art) drawCover(ctx, art, x + 4, y + 4, s, s); else placeholderArt(ctx, x + 4, y + 4, s, s, slot.name, data.division);
        ctx.restore();
        ctx.fillStyle = lost ? C.grey : won ? C.gold : C.text;
        fitText(ctx, slot.name, x + s + 12, y + ROW_H / 2 + 6, BOX_W - s - 20, 16, 'bold', 10);
    };

    const won = (m, s) => Boolean(m.winnerId && s && m.winnerId === s.id);
    const lost = (m, s) => Boolean(m.winnerId && s && m.winnerId !== s.id);
    for (const m of data.matches) {
        if (m.empty) continue; // an unused first-round slot
        const cy = centre.get(`${m.round}:${m.slot}`);
        const x = xOf(m.round);
        if (m.round === 1 && data.triple) {
            const rows = m.c ? [m.a, m.b, m.c] : [m.a, m.b];        // 3 = triple threat, 2 = singles, 1 = bye
            const h = rows.length * ROW_H + (rows.length - 1) * 4;
            rows.forEach((s, i) => drawRow(s, x, cy - h / 2 + i * (ROW_H + 4), won(m, s), lost(m, s), m.bye));
            continue;
        }
        const y = cy - BLOCK_H / 2;
        drawRow(m.a, x, y, won(m, m.a), lost(m, m.a), m.aBye);
        drawRow(m.b, x, y + ROW_H + 4, won(m, m.b), lost(m, m.b), m.bye || m.bBye);
    }

    // champion
    const cx = xOf(rounds) + BOX_W + COL_GAP;
    const cy = centre.get(`${rounds}:1`) || HEAD + bodyH / 2;
    ctx.textAlign = 'left';
    ctx.fillStyle = th.accent; ctx.font = font(13, 'bold'); ctx.fillText('CHAMPION', cx, cy - 56);
    ctx.fillStyle = C.panel; rr(ctx, cx, cy - 44, champW - 20, 88, 14); ctx.fill();
    ctx.strokeStyle = data.champion ? C.gold : C.line; ctx.lineWidth = 3; rr(ctx, cx + 1.5, cy - 42.5, champW - 23, 85, 13); ctx.stroke();
    if (data.champion) {
        const art = await loadArt(data.champion.imageUrl);
        ctx.save(); rr(ctx, cx + 8, cy - 36, 72, 72, 10); ctx.clip();
        if (art) drawCover(ctx, art, cx + 8, cy - 36, 72, 72); else placeholderArt(ctx, cx + 8, cy - 36, 72, 72, data.champion.name, data.division);
        ctx.restore();
        ctx.fillStyle = C.gold; fitText(ctx, data.champion.name, cx + 90, cy + 6, champW - 120, 22, 'bold', 12);
    } else {
        ctx.fillStyle = C.grey; ctx.font = font(20, 'bold'); ctx.textAlign = 'center';
        ctx.fillText('TBD', cx + (champW - 20) / 2, cy + 8);
    }
    ctx.textAlign = 'center'; ctx.fillStyle = C.sub; ctx.font = font(13, 'medium');
    ctx.fillText('Log the matches with /match and the bracket updates itself', canvas.width / 2, H - 18);
    return canvas.toBuffer('image/png');
}

module.exports = { renderBracketCard };
