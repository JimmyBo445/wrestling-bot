const { createCanvas } = require('@napi-rs/canvas');
const { font, C, themeOf, rr, fitText, baseBackground, chip, serverTag } = require('./common');

/** data from buildSeasonData */
async function renderSeasonCard(data) {
    const W = 1000;
    const champs = data.champions.slice(0, 12);
    const rowsLeft = Math.max(data.wrestlers.slice(0, 5).length, data.players.slice(0, 5).length, 1);
    const H = 282 + 14 + rowsLeft * 44 + 24 + 14 + Math.ceil(Math.max(champs.length, 1) / 2) * 40 + 14 + (data.best ? 70 : 0) + 24;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    baseBackground(ctx, W, H, C.gold);
    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, C.goldDark); g.addColorStop(0.5, C.gold); g.addColorStop(1, C.goldDark);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, 8);
    serverTag(ctx, data.serverName, W - 40, 34);

    ctx.textAlign = 'left'; ctx.fillStyle = C.gold; ctx.font = font(18, 'bold');
    ctx.fillText('SEASON RECAP', 40, 52);
    ctx.fillStyle = C.text; ctx.font = font(78, 'bold');
    ctx.fillText(String(data.year), 40, 132);

    const stats = [['MATCHES', data.matches], ['TITLE MATCHES', data.titleMatches], ['TITLE CHANGES', data.titleChanges]];
    stats.forEach(([l, v], i) => {
        const x = 40 + i * 200, y = 160;
        ctx.fillStyle = C.panel; rr(ctx, x, y, 186, 84, 14); ctx.fill();
        ctx.textAlign = 'center'; ctx.fillStyle = C.sub; ctx.font = font(12, 'bold'); ctx.fillText(l, x + 93, y + 26);
        ctx.fillStyle = C.gold; ctx.font = font(36, 'bold'); ctx.fillText(String(v), x + 93, y + 68);
    });
    ctx.textAlign = 'left';

    // wrestler of the year callout
    const top = data.wrestlers[0];
    ctx.fillStyle = '#2a2412'; rr(ctx, 650, 160, 310, 84, 14); ctx.fill();
    ctx.strokeStyle = C.gold; ctx.lineWidth = 2; rr(ctx, 651, 161, 308, 82, 13); ctx.stroke();
    ctx.fillStyle = C.gold; ctx.font = font(12, 'bold'); ctx.fillText('WRESTLER OF THE YEAR', 668, 186);
    ctx.fillStyle = C.text;
    if (top) { fitText(ctx, top.name, 668, 218, 280, 26, 'bold', 14); ctx.fillStyle = C.sub; ctx.font = font(14, 'medium'); ctx.fillText(`${top.w}-${top.l} this year`, 668, 236); }
    else { ctx.fillStyle = C.grey; ctx.font = font(20, 'medium'); ctx.fillText('Not decided', 668, 222); }

    // two columns: top wrestlers / top players
    const colY = 282;
    const col = (title, items, x, fmt) => {
        ctx.fillStyle = C.gold; ctx.font = font(14, 'bold'); ctx.fillText(title, x, colY);
        items.slice(0, 5).forEach((it, i) => {
            const y = colY + 14 + i * 44;
            ctx.fillStyle = C.panel; rr(ctx, x, y, 440, 38, 10); ctx.fill();
            ctx.fillStyle = i === 0 ? C.gold : C.sub; ctx.font = font(16, 'bold'); ctx.fillText(String(i + 1), x + 14, y + 25);
            ctx.fillStyle = C.text; fitText(ctx, it.name, x + 44, y + 25, 270, 17, 'bold', 11);
            ctx.textAlign = 'right'; ctx.fillStyle = C.sub; ctx.font = font(15, 'bold'); ctx.fillText(fmt(it), x + 426, y + 25); ctx.textAlign = 'left';
        });
        if (!items.length) { ctx.fillStyle = C.grey; ctx.font = font(15, 'medium'); ctx.fillText('No data', x, colY + 40); }
    };
    col('TOP WRESTLERS', data.wrestlers, 40, (w) => `${w.w}-${w.l}`);
    col('TOP PLAYERS', data.players, 520, (p) => `${p.w}-${p.l}`);

    let y = colY + 14 + rowsLeft * 44 + 24;
    ctx.fillStyle = C.gold; ctx.font = font(14, 'bold'); ctx.fillText(`CHAMPIONS AT THE END OF ${data.year}`, 40, y);
    y += 14;
    if (!champs.length) { ctx.fillStyle = C.grey; ctx.font = font(15, 'medium'); ctx.fillText('No champions on record', 40, y + 24); y += 40; }
    champs.forEach((c, i) => {
        const x = 40 + (i % 2) * 460, yy = y + Math.floor(i / 2) * 40;
        ctx.fillStyle = C.panel; rr(ctx, x, yy, 440, 34, 9); ctx.fill();
        ctx.fillStyle = C.sub; fitText(ctx, c.title, x + 12, yy + 22, 200, 13, 'medium', 9);
        ctx.fillStyle = C.gold; ctx.textAlign = 'right';
        ctx.font = font(15, 'bold'); ctx.fillText(c.holder.slice(0, 24), x + 428, yy + 22); ctx.textAlign = 'left';
    });
    y += Math.ceil(Math.max(champs.length, 1) / 2) * 40 + 14;
    if (data.best) {
        ctx.fillStyle = C.gold; ctx.font = font(14, 'bold'); ctx.fillText(`MATCH OF THE YEAR${data.best.rated ? `  ${'★'.repeat(data.best.stars)}` : ''}`, 40, y + 14);
        ctx.fillStyle = C.text; fitText(ctx, `${data.best.text}${data.best.title ? `  •  ${data.best.title}` : ''}`, 40, y + 44, W - 80, 20, 'bold', 12);
    }
    return canvas.toBuffer('image/png');
}

module.exports = { renderSeasonCard };
