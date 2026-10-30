const { createCanvas } = require('@napi-rs/canvas');
const { font, C, themeOf, rr, fitText, drawCover, loadArt, placeholderArt, baseBackground, chip, statBox, streakText, recordText, formRow, serverTag } = require('./common');

const DIVS = [['mens', "MEN'S"], ['womens', "WOMEN'S"], ['custom', 'CUSTOM'], ['custom_womens', "CUSTOM WOMEN'S"]];

/** data: { name, avatarUrl, serverName, summary, byDivision:{div:summary}, wrestlers:[{name,division,status,current,wins,losses,draws}], reigns } */
async function renderPlayerCard(data) {
    const W = 1000;
    const s = data.summary;
    const wr = data.wrestlers.slice(0, 8);
    const H = 490 + Math.max(0, Math.ceil(wr.length / 2)) * 34 + 30;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    baseBackground(ctx, W, H, C.gold);
    ctx.fillStyle = C.gold; ctx.fillRect(0, 0, W, 6);
    serverTag(ctx, data.serverName, W - 40, 34);

    // avatar
    const av = await loadArt(data.avatarUrl);
    ctx.save(); ctx.beginPath(); ctx.arc(100, 100, 56, 0, Math.PI * 2); ctx.clip();
    if (av) drawCover(ctx, av, 44, 44, 112, 112, 0.5); else placeholderArt(ctx, 44, 44, 112, 112, data.name, 'mens');
    ctx.restore();
    ctx.strokeStyle = C.gold; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(100, 100, 58, 0, Math.PI * 2); ctx.stroke();
    ctx.textAlign = 'left'; ctx.fillStyle = C.text;
    fitText(ctx, data.name, 184, 98, W - 184 - 40, 46, 'bold', 24);
    ctx.fillStyle = C.sub; ctx.font = font(17, 'medium');
    ctx.fillText(`PLAYER RECORD  •  ${s.total} MATCH${s.total === 1 ? '' : 'ES'}`, 184, 130);

    const tt = data.titles;
    if (tt && tt.reigns) {
        ctx.fillStyle = C.gold; ctx.font = font(16, 'bold');
        const cur = tt.current.length ? `  •  CHAMPION: ${tt.current.map((c) => c.title).join(', ')}` : '';
        fitText(ctx, `${tt.reigns} TITLE REIGN${tt.reigns === 1 ? '' : 'S'}  •  ${tt.days} DAYS AS CHAMPION${cur}`, 184, 156, W - 184 - 40, 16, 'bold', 11);
    }

    // overall boxes
    const st = streakText(s.streaks);
    const bw = 220, gap = 14, by = 190;
    [['Overall', recordText(s), C.text], ['Win %', s.wins + s.losses ? `${s.winPct.toFixed(0)}%` : '—', C.text],
        ['Streak', st.text, st.color], ['Best run', s.streaks.longestWin ? `W${s.streaks.longestWin}` : '—', C.green]]
        .forEach(([l, v, col], i) => statBox(ctx, 40 + i * (bw + gap), by, bw, 92, l, v, col));
    formRow(ctx, 40, by + 112, s.form);

    // per-division
    ctx.fillStyle = C.gold; ctx.font = font(13, 'bold'); ctx.fillText('BY DIVISION', 40, 366);
    const dw = (W - 80 - 3 * gap) / 4;
    DIVS.forEach(([key, label], i) => {
        const d = data.byDivision[key];
        const x = 40 + i * (dw + gap), y = 378;
        const th = themeOf(key);
        ctx.fillStyle = C.panel; rr(ctx, x, y, dw, 78, 12); ctx.fill();
        ctx.fillStyle = th.accent; ctx.fillRect(x + 12, y, dw - 24, 3);
        ctx.textAlign = 'center';
        ctx.fillStyle = C.sub; ctx.font = font(11, 'bold'); ctx.fillText(label, x + dw / 2, y + 24);
        ctx.fillStyle = d ? C.text : C.grey;
        fitText(ctx, d ? `${d.wins}-${d.losses}${d.draws ? `-${d.draws}` : ''}` : '—', x + dw / 2, y + 58, dw - 20, 28, 'bold', 14);
    });
    ctx.textAlign = 'left';

    // wrestlers
    ctx.fillStyle = C.gold; ctx.font = font(13, 'bold'); ctx.fillText('WRESTLERS', 40, 490);
    wr.forEach((w, i) => {
        const x = 40 + (i % 2) * ((W - 80) / 2), y = 500 + Math.floor(i / 2) * 34;
        const tag = w.status === 'retired' ? ' (retired)' : w.current ? '' : ' (former)';
        ctx.fillStyle = w.current && w.status !== 'retired' ? C.text : C.sub;
        fitText(ctx, `${w.name}${tag}`, x, y + 20, (W - 80) / 2 - 130, 17, 'bold', 11);
        ctx.textAlign = 'right'; ctx.fillStyle = C.sub; ctx.font = font(16, 'medium');
        ctx.fillText(`${w.wins}-${w.losses}${w.draws ? `-${w.draws}` : ''}`, x + (W - 80) / 2 - 30, y + 20);
        ctx.textAlign = 'left';
    });
    return canvas.toBuffer('image/png');
}

module.exports = { renderPlayerCard };
