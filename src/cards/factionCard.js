const { createCanvas } = require('@napi-rs/canvas');
const {
    font, C, themeOf, rr, fitText, drawCover, loadArt, placeholderArt, baseBackground, chip,
    statBox, streakText, recordText, formRow, serverTag
} = require('./common');

/** data: { faction:{name,division,status}, members:[{name,division,imageUrl,owner}], summary, titlesHeld:[string], serverName } */
async function renderFactionCard(data) {
    const { faction, members, summary: s } = data;
    const th = themeOf(faction.division);
    const W = 1000;
    const perRow = members.length <= 4 ? Math.max(members.length, 1) : 4;
    const rows = Math.ceil(Math.max(members.length, 1) / perRow);
    const gap = 14, tw = (W - 80 - gap * (perRow - 1)) / perRow, tileH = perRow <= 4 && rows === 1 ? 210 : 160;
    const H = 130 + rows * (tileH + gap) + 230;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    baseBackground(ctx, W, H, th.accent);

    ctx.fillStyle = data.titlesHeld.length ? C.gold : th.accent;
    ctx.fillRect(0, 0, W, 6);
    serverTag(ctx, data.serverName, W - 40, 30);
    ctx.textAlign = 'left';
    ctx.fillStyle = C.text;
    fitText(ctx, faction.name, 40, 72, W - 80, 46, 'bold', 24);
    ctx.fillStyle = C.sub;
    ctx.font = font(17, 'medium');
    ctx.fillText(`${th.label.toUpperCase()} FACTION  •  ${members.length} MEMBER${members.length === 1 ? '' : 'S'}${faction.status === 'disbanded' ? '  •  DISBANDED' : ''}`, 40, 102);

    const arts = await Promise.all(members.map((m) => loadArt(m.imageUrl)));
    members.forEach((m, i) => {
        const r = Math.floor(i / perRow), c = i % perRow;
        const inRow = r === rows - 1 ? members.length - r * perRow : perRow;
        const off = ((perRow - inRow) * (tw + gap)) / 2;
        const x = 40 + off + c * (tw + gap), y = 124 + r * (tileH + gap);
        ctx.save();
        rr(ctx, x, y, tw, tileH, 16); ctx.clip();
        if (arts[i]) drawCover(ctx, arts[i], x, y, tw, tileH); else placeholderArt(ctx, x, y, tw, tileH, m.name, m.division);
        const g = ctx.createLinearGradient(0, y + tileH * 0.5, 0, y + tileH);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.9)');
        ctx.fillStyle = g; ctx.fillRect(x, y, tw, tileH);
        ctx.restore();
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
        fitText(ctx, m.name, x + tw / 2, y + tileH - 26, tw - 20, 19, 'bold', 11);
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        fitText(ctx, `@${m.owner}`, x + tw / 2, y + tileH - 9, tw - 20, 12, 'medium', 9);
        ctx.textAlign = 'left';
    });

    const by = 124 + rows * (tileH + gap) + 6;
    const st = streakText(s.streaks);
    const bw = 150;
    [['Record', recordText(s), C.text], ['Win %', s.wins + s.losses ? `${s.winPct.toFixed(0)}%` : '—', C.text],
        ['Streak', st.text, st.color], ['Best run', s.streaks.longestWin ? `W${s.streaks.longestWin}` : '—', C.green]]
        .forEach(([l, v, col], i) => statBox(ctx, 40 + i * (bw + 12), by, bw, 84, l, v, col));
    formRow(ctx, 40 + 4 * (bw + 12) + 10, by + 28, s.form);

    ctx.fillStyle = C.gold; ctx.font = font(13, 'bold');
    ctx.fillText('CHAMPIONS IN THE FACTION', 40, by + 124);
    if (!data.titlesHeld.length) {
        ctx.fillStyle = C.grey; ctx.font = font(15, 'medium');
        ctx.fillText('No titles held right now', 40, by + 156);
    } else {
        let tx = 40;
        for (const name of data.titlesHeld.slice(0, 3)) tx += chip(ctx, name.slice(0, 40), tx, by + 138, { bg: C.goldDark, fg: '#fff3cf', size: 14, h: 30 }) + 8;
    }
    return canvas.toBuffer('image/png');
}

module.exports = { renderFactionCard };
