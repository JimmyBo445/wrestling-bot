const { createCanvas } = require('@napi-rs/canvas');
const { font, C, themeOf, rr, fitText, wrapLines, drawCover, loadArt, placeholderArt, baseBackground, chip, serverTag } = require('./common');

/** data: { name, division, imageUrl, owner, year, blurb, record:{wins,losses,draws}, reigns, defenses, bestStreak, titles:[string], serverName } */
async function renderHofCard(data) {
    const W = 1000, H = 600;
    const th = themeOf(data.division);
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    baseBackground(ctx, W, H, C.gold);

    // gold frame
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, C.goldDark); g.addColorStop(0.5, C.gold); g.addColorStop(1, C.goldDark);
    ctx.strokeStyle = g; ctx.lineWidth = 8;
    rr(ctx, 10, 10, W - 20, H - 20, 24); ctx.stroke();

    serverTag(ctx, data.serverName, W - 40, 44);
    ctx.textAlign = 'left';
    ctx.fillStyle = C.gold;
    ctx.font = font(15, 'bold');
    ctx.fillText(`HALL OF FAME  •  CLASS OF ${data.year}`, 400, 80);
    ctx.fillStyle = C.text;
    fitText(ctx, data.name, 400, 138, W - 440, 54, 'bold', 26);
    ctx.fillStyle = C.sub;
    ctx.font = font(17, 'medium');
    ctx.fillText(`${th.label.toUpperCase()} DIVISION  •  @${data.owner}`, 400, 170);

    const ax = 40, ay = 50, aw = 320, ah = H - 100;
    const art = await loadArt(data.imageUrl);
    ctx.save();
    rr(ctx, ax, ay, aw, ah, 20); ctx.clip();
    if (art) drawCover(ctx, art, ax, ay, aw, ah); else placeholderArt(ctx, ax, ay, aw, ah, data.name, data.division);
    const gg = ctx.createLinearGradient(0, ay + ah * 0.6, 0, ay + ah);
    gg.addColorStop(0, 'rgba(0,0,0,0)'); gg.addColorStop(1, 'rgba(0,0,0,0.85)');
    ctx.fillStyle = gg; ctx.fillRect(ax, ay, aw, ah);
    ctx.restore();
    ctx.strokeStyle = C.gold; ctx.lineWidth = 4;
    rr(ctx, ax + 2, ay + 2, aw - 4, ah - 4, 18); ctx.stroke();
    ctx.textAlign = 'center'; ctx.fillStyle = C.gold; ctx.font = font(20, 'bold');
    ctx.fillText('LEGEND', ax + aw / 2, ay + ah - 22);
    ctx.textAlign = 'left';

    // stats
    const r = data.record;
    const items = [
        ['CAREER RECORD', `${r.wins}-${r.losses}${r.draws ? `-${r.draws}` : ''}`],
        ['TITLE REIGNS', String(data.reigns)],
        ['TITLE DEFENSES', String(data.defenses)],
        ['BEST WIN STREAK', data.bestStreak ? `W${data.bestStreak}` : '—']
    ];
    const bw = 130, gap = 12;
    items.forEach(([label, value], i) => {
        const x = 400 + i * (bw + gap), y = 205;
        ctx.fillStyle = C.panel; rr(ctx, x, y, bw, 92, 14); ctx.fill();
        ctx.strokeStyle = C.goldDark; ctx.lineWidth = 1.5; rr(ctx, x + 0.75, y + 0.75, bw - 1.5, 90.5, 13); ctx.stroke();
        ctx.textAlign = 'center';
        ctx.fillStyle = C.sub; ctx.font = font(11, 'bold'); ctx.fillText(label, x + bw / 2, y + 28);
        ctx.fillStyle = C.gold; fitText(ctx, value, x + bw / 2, y + 70, bw - 16, 32, 'bold', 16);
    });
    ctx.textAlign = 'left';

    ctx.fillStyle = C.gold; ctx.font = font(13, 'bold');
    ctx.fillText('CHAMPIONSHIPS WON', 400, 335);
    let tx = 400, ty = 348;
    if (!data.titles.length) { ctx.fillStyle = C.grey; ctx.font = font(15, 'medium'); ctx.fillText('A legend without a belt', 400, 372); }
    else for (const name of data.titles.slice(0, 6)) {
        ctx.font = font(14, 'bold');
        const w = Math.min(ctx.measureText(name).width + 28, W - 440);
        if (tx + w > W - 40) { tx = 400; ty += 38; }
        chip(ctx, name.slice(0, 40), tx, ty, { bg: C.goldDark, fg: '#fff3cf', size: 14, h: 30 });
        tx += w + 8;
    }
    if (data.blurb) {
        ctx.fillStyle = C.text; ctx.font = font(17, 'medium');
        const lines = wrapLines(ctx, `“${data.blurb}”`, W - 440, 3);
        lines.forEach((l, i) => ctx.fillText(l, 400, 492 + i * 26));
    }
    return canvas.toBuffer('image/png');
}

module.exports = { renderHofCard };
