const { createCanvas } = require('@napi-rs/canvas');
const { font, C, themeOf, rr, fitText, drawCover, loadArt, placeholderArt, baseBackground, serverTag, statBox, recordText } = require('./common');

const TONE = { gold: C.gold, green: C.green, red: C.red, orange: C.orange, grey: C.grey, blue: '#4fa3ff' };

/**
 * data: { serverName, character:{name,division,imageUrl}, ownerName, summary, events:[{date,title,sub,tone}] (oldest first), hidden:int }
 */
async function renderCareerCard(data) {
    const W = 1000, ROW = 62, HEAD = 250;
    const th = themeOf(data.character.division);
    const n = Math.max(data.events.length, 1);
    const H = HEAD + n * ROW + (data.hidden ? 30 : 0) + 50;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    baseBackground(ctx, W, H, th.accent);
    ctx.fillStyle = th.accent; ctx.fillRect(0, 0, W, 6);
    serverTag(ctx, data.serverName, W - 40, 34);

    const art = await loadArt(data.character.imageUrl);
    ctx.save(); rr(ctx, 40, 40, 150, 150, 18); ctx.clip();
    if (art) drawCover(ctx, art, 40, 40, 150, 150); else placeholderArt(ctx, 40, 40, 150, 150, data.character.name, data.character.division);
    ctx.restore();
    ctx.strokeStyle = th.accent; ctx.lineWidth = 3; rr(ctx, 41.5, 41.5, 147, 147, 17); ctx.stroke();

    ctx.textAlign = 'left'; ctx.fillStyle = C.text;
    fitText(ctx, data.character.name, 214, 88, W - 254, 44, 'bold', 22);
    ctx.fillStyle = C.sub; ctx.font = font(16, 'medium');
    ctx.fillText(`CAREER TIMELINE  •  ${th.label.toUpperCase()} DIVISION  •  @${data.ownerName}`, 214, 116);
    const s = data.summary;
    statBox(ctx, 214, 128, 130, 88, 'Record', recordText(s));
    statBox(ctx, 214 + 142, 128, 130, 88, 'Matches', String(s.total));
    statBox(ctx, 214 + 284, 128, 130, 88, 'Win %', s.wins + s.losses ? `${s.winPct.toFixed(0)}%` : '—');
    statBox(ctx, 214 + 426, 128, 130, 88, 'Best run', s.streaks.longestWin ? `W${s.streaks.longestWin}` : '—', C.green);

    // spine
    const sx = 130;
    const y0 = HEAD;
    ctx.strokeStyle = C.line; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(sx, y0 - 10); ctx.lineTo(sx, y0 + n * ROW - 10); ctx.stroke();

    if (data.hidden) {
        ctx.textAlign = 'left'; ctx.fillStyle = C.grey; ctx.font = font(13, 'medium');
        ctx.fillText(`+ ${data.hidden} earlier moments not shown`, 160, y0 + n * ROW + 14);
    }
    if (!data.events.length) {
        ctx.textAlign = 'center'; ctx.fillStyle = C.grey; ctx.font = font(22, 'medium');
        ctx.fillText('No career moments yet. Log some matches!', W / 2, y0 + 30);
    }
    data.events.forEach((e, i) => {
        const y = y0 + i * ROW;
        const col = TONE[e.tone] || C.grey;
        ctx.textAlign = 'right'; ctx.fillStyle = C.sub; ctx.font = font(13, 'bold');
        ctx.fillText(e.date, sx - 22, y + 24);
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(sx, y + 20, 10, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#0d0d11'; ctx.lineWidth = 3; ctx.stroke();
        ctx.fillStyle = C.panel; rr(ctx, 160, y, W - 200, ROW - 10, 12); ctx.fill();
        ctx.fillStyle = col; ctx.fillRect(160, y + 8, 4, ROW - 26);
        ctx.textAlign = 'left'; ctx.fillStyle = C.text;
        fitText(ctx, e.title, 180, y + 24, W - 240, 19, 'bold', 12);
        if (e.sub) { ctx.fillStyle = C.sub; fitText(ctx, e.sub, 180, y + 44, W - 240, 14, 'medium', 10); }
    });
    return canvas.toBuffer('image/png');
}

module.exports = { renderCareerCard };
