const { createCanvas } = require('@napi-rs/canvas');
const { font, C, themeOf, rr, fitText, drawCover, loadArt, placeholderArt, baseBackground, chip, serverTag } = require('./common');

const MEDAL = ['#e8bf4a', '#c9ced6', '#cd8a4b'];

/** data: { division, label, windowDays, serverName, rows:[{name,owner,imageUrl,pts,w,l,d,champ,contender}] } */
async function renderRankingsCard(data) {
    const W = 1000, ROW = 74, GAP = 8, HEAD = 128, FOOT = 56;
    const rows = data.rows;
    const H = HEAD + rows.length * (ROW + GAP) + FOOT;
    const th = themeOf(data.division);
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    baseBackground(ctx, W, H, th.accent);
    ctx.fillStyle = th.accent; ctx.fillRect(0, 0, W, 6);
    serverTag(ctx, data.serverName, W - 40, 34);
    ctx.textAlign = 'left';
    ctx.fillStyle = C.text;
    ctx.font = font(40, 'bold');
    ctx.fillText(`${data.label.toUpperCase()} RANKINGS`, 40, 76);
    ctx.fillStyle = C.sub; ctx.font = font(16, 'medium');
    ctx.fillText(`TOP ${rows.length}  •  LAST ${data.windowDays} DAYS  •  3 PTS PER WIN, 1 PER DRAW`, 40, 104);

    const arts = await Promise.all(rows.map((r) => loadArt(r.imageUrl)));
    rows.forEach((r, i) => {
        const y = HEAD + i * (ROW + GAP);
        const top = i === 0;
        ctx.fillStyle = top ? '#2a2412' : C.panel;
        rr(ctx, 40, y, W - 80, ROW, 14); ctx.fill();
        if (top) { ctx.strokeStyle = C.gold; ctx.lineWidth = 2; rr(ctx, 41, y + 1, W - 82, ROW - 2, 13); ctx.stroke(); }
        // rank badge
        const col = MEDAL[i] || '#3a3d47';
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(80, y + ROW / 2, 22, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = i < 3 ? '#17120a' : C.text; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = font(22, 'bold'); ctx.fillText(String(i + 1), 80, y + ROW / 2 + 1); ctx.textBaseline = 'alphabetic';
        // portrait
        const s = ROW - 14;
        ctx.save(); rr(ctx, 118, y + 7, s, s, 10); ctx.clip();
        if (arts[i]) drawCover(ctx, arts[i], 118, y + 7, s, s); else placeholderArt(ctx, 118, y + 7, s, s, r.name, data.division);
        ctx.restore();
        // name + owner
        ctx.textAlign = 'left'; ctx.fillStyle = C.text;
        const nameMax = 330;
        fitText(ctx, r.name, 118 + s + 16, y + 34, nameMax, 26, 'bold', 14);
        ctx.fillStyle = C.sub;
        fitText(ctx, `@${r.owner}`, 118 + s + 16, y + 58, nameMax, 15, 'medium', 10);
        // flags
        let fx = 118 + s + 16 + nameMax + 12;
        if (r.champ) fx += chip(ctx, 'CHAMPION', fx, y + 22, { bg: C.goldDark, fg: '#fff3cf', size: 12, h: 26 }) + 6;
        if (r.contender) chip(ctx, '#1 CONTENDER', fx, y + 22, { bg: '#a85a10', size: 12, h: 26 });
        // points + record
        ctx.textAlign = 'right';
        ctx.fillStyle = top ? C.gold : C.text;
        ctx.font = font(30, 'bold'); ctx.fillText(`${r.pts}`, W - 130, y + 40);
        ctx.fillStyle = C.sub; ctx.font = font(12, 'bold'); ctx.fillText('PTS', W - 130, y + 58);
        ctx.fillStyle = C.text; ctx.font = font(18, 'bold');
        ctx.fillText(`${r.w}-${r.l}${r.d ? `-${r.d}` : ''}`, W - 60, y + 46);
        ctx.textAlign = 'left';
    });
    ctx.textAlign = 'center'; ctx.fillStyle = C.sub; ctx.font = font(13, 'medium');
    ctx.fillText('Records are wins-losses (draws) in the ranking window', W / 2, H - 22);
    return canvas.toBuffer('image/png');
}

module.exports = { renderRankingsCard };
