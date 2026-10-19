const { createCanvas } = require('@napi-rs/canvas');
const {
    font, C, themeOf, rr, fitText, drawCover, loadArt, placeholderArt, baseBackground, chip,
    statBox, streakText, recordText, formRow
} = require('./common');

/** data: { team:{name,division,status}, members:[{name,division,imageUrl,owner}], summary, titlesHeld:[string], reigns, defenses } */
async function renderTeamCard(data) {
    const W = 1000, H = 560;
    const { team, members, summary: s } = data;
    const th = themeOf(team.division);
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    baseBackground(ctx, W, H, th.accent);

    ctx.fillStyle = data.titlesHeld.length ? C.gold : th.accent;
    ctx.fillRect(0, 0, W, 6);
    ctx.textAlign = 'left';
    ctx.fillStyle = C.text;
    fitText(ctx, team.name, 40, 72, W - 80, 46, 'bold', 24);
    ctx.fillStyle = C.sub;
    ctx.font = font(17, 'medium');
    ctx.fillText(`${th.label.toUpperCase()} TAG TEAM${team.status === 'disbanded' ? '  •  DISBANDED' : ''}`, 40, 102);

    // member tiles
    const n = Math.max(members.length, 1);
    const gap = 16;
    const tw = Math.min(210, (W - 80 - gap * (n - 1)) / n);
    const th2 = 190;
    const totalW = n * tw + (n - 1) * gap;
    const startX = 40;
    const arts = await Promise.all(members.map((m) => loadArt(m.imageUrl)));
    members.forEach((m, i) => {
        const x = startX + i * (tw + gap), y = 128;
        ctx.save();
        rr(ctx, x, y, tw, th2, 16); ctx.clip();
        if (arts[i]) drawCover(ctx, arts[i], x, y, tw, th2); else placeholderArt(ctx, x, y, tw, th2, m.name, m.division);
        const g = ctx.createLinearGradient(0, y + th2 * 0.5, 0, y + th2);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.9)');
        ctx.fillStyle = g; ctx.fillRect(x, y, tw, th2);
        ctx.restore();
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
        fitText(ctx, m.name, x + tw / 2, y + th2 - 28, tw - 20, 20, 'bold', 12);
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        fitText(ctx, `@${m.owner}`, x + tw / 2, y + th2 - 9, tw - 20, 12, 'medium', 9);
        ctx.textAlign = 'left';
    });

    // stats to the right of the members (or below if many)
    const sx = Math.max(startX + totalW + 30, 40);
    const wide = sx > 640;
    const bx = wide ? 40 : sx;
    const by = wide ? 340 : 128;
    const st = streakText(s.streaks);
    const bw = wide ? 150 : 138;
    const boxes = [
        ['Record', recordText(s), C.text],
        ['Win %', s.wins + s.losses ? `${s.winPct.toFixed(0)}%` : '—', C.text],
        ['Streak', st.text, st.color],
        ['Best run', s.streaks.longestWin ? `W${s.streaks.longestWin}` : '—', C.green]
    ];
    if (wide) {
        boxes.forEach(([l, v, col], i) => statBox(ctx, bx + i * (bw + 12), by, bw, 84, l, v, col));
        formRow(ctx, 40 + 4 * (bw + 12) + 10, by + 28, s.form);
    } else {
        boxes.slice(0, 2).forEach(([l, v, col], i) => statBox(ctx, bx + i * (bw + 12), by, bw, 84, l, v, col));
        boxes.slice(2).forEach(([l, v, col], i) => statBox(ctx, bx + i * (bw + 12), by + 96, bw, 84, l, v, col));
        formRow(ctx, bx, by + 196, s.form);
    }

    ctx.fillStyle = C.gold; ctx.font = font(13, 'bold');
    ctx.fillText('CHAMPIONSHIPS', 40, 446);
    if (!data.titlesHeld.length) {
        ctx.fillStyle = C.grey; ctx.font = font(15, 'medium');
        ctx.fillText(data.reigns ? `Former champions  •  ${data.reigns} past reign${data.reigns > 1 ? 's' : ''}` : 'No title reigns yet', 40, 478);
    } else {
        let tx = 40;
        for (const name of data.titlesHeld.slice(0, 3)) {
            tx += chip(ctx, name.slice(0, 44), tx, 458, { bg: C.goldDark, fg: '#fff3cf', size: 14, h: 30 }) + 8;
        }
        ctx.fillStyle = C.sub; ctx.font = font(13, 'medium');
        ctx.fillText(`${data.reigns} total reign${data.reigns === 1 ? '' : 's'}  •  ${data.defenses} defense${data.defenses === 1 ? '' : 's'}`, 40, 512);
    }
    return canvas.toBuffer('image/png');
}

module.exports = { renderTeamCard };
