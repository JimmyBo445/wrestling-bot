const { createCanvas, loadImage } = require('@napi-rs/canvas');
const {
    font, C, themeOf, rr, fitText, drawCover, loadArt, placeholderArt, baseBackground, chip, serverTag
} = require('./common');

/**
 * data: { title:{name,division,is_tag_title}, champion: null | { name, members:[{name,division,imageUrl,owner}],
 *         reignNumber, days, defenses, since, isBackfilled }, contender: string|null, previous: {name,days}|null, totalReigns }
 */
async function renderBeltCard(data) {
    if (data.beltArt) {
        try { return await renderBeltCardWithArt(data); } catch (err) { console.error('Belt art failed, drawing the plain belt:', err.message); }
    }
    return renderPlainBeltCard(data);
}

/** The belt picture is the star; the champion's picture and name sit on it, with stats, contender and rematch underneath. */
async function renderBeltCardWithArt(data) {
    const art = await loadImage(data.beltArt);
    const W = 1000, ARTH = 330;
    const prev = data.previous || [];
    const champ = data.champion;
    const hasChips = Boolean(data.contender || data.rematch);
    const chipY = 108 + ARTH + 34 + (champ ? 170 : 40);
    const H = chipY + (hasChips ? 44 : 6) + (prev.length ? 92 : 0) + 14;
    const th = themeOf(data.title.division);
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    baseBackground(ctx, W, H, C.gold);
    const fg = ctx.createLinearGradient(0, 0, W, H);
    fg.addColorStop(0, C.gold); fg.addColorStop(0.5, C.goldDark); fg.addColorStop(1, C.gold);
    ctx.strokeStyle = fg; ctx.lineWidth = 6;
    rr(ctx, 8, 8, W - 16, H - 16, 22); ctx.stroke();
    serverTag(ctx, data.serverName, W / 2, 30, { align: 'center', size: 12 });
    ctx.textAlign = 'center';
    ctx.fillStyle = C.gold;
    fitText(ctx, data.title.name.toUpperCase(), W / 2, 66, W - 100, 36, 'bold', 20);
    ctx.fillStyle = C.sub; ctx.font = font(14, 'medium');
    ctx.fillText(`${th.label.toUpperCase()} DIVISION${data.title.is_tag_title ? '  •  TAG TEAM TITLE' : ''}`, W / 2, 90);

    // belt art, fitted (never stretched) in the middle
    const bx = 40, by = 108, bw = W - 80;
    const s = Math.min(bw / art.width, ARTH / art.height);
    const aw = art.width * s, ah = art.height * s;
    ctx.drawImage(art, bx + (bw - aw) / 2, by + (ARTH - ah) / 2, aw, ah);

    // champion's picture(s) sit on the belt's centre plate; the name and stats go underneath
    const py = by + ARTH / 2;
    const ty = by + ARTH + 34;
    if (champ) {
        const members = champ.members.slice(0, 4);
        const arts = await Promise.all(members.map((m) => loadArt(m.imageUrl)));
        const r = members.length === 1 ? 92 : members.length === 2 ? 74 : 56;
        const gap = 14;
        const total = members.length * r * 2 + (members.length - 1) * gap;
        let x = W / 2 - total / 2 + r;
        members.forEach((m, i) => {
            ctx.save(); ctx.beginPath(); ctx.arc(x, py, r, 0, Math.PI * 2); ctx.clip();
            if (arts[i]) drawCover(ctx, arts[i], x - r, py - r, r * 2, r * 2, 0.2); else placeholderArt(ctx, x - r, py - r, r * 2, r * 2, m.name, m.division);
            ctx.restore();
            ctx.strokeStyle = C.gold; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(x, py, r, 0, Math.PI * 2); ctx.stroke();
            ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, py, r + 4, 0, Math.PI * 2); ctx.stroke();
            x += r * 2 + gap;
        });
        ctx.textAlign = 'center';
        ctx.fillStyle = C.sub; ctx.font = font(13, 'bold');
        ctx.fillText(data.title.is_tag_title ? 'CURRENT CHAMPIONS' : 'CURRENT CHAMPION', W / 2, ty);
        ctx.fillStyle = C.text;
        fitText(ctx, champ.name, W / 2, ty + 40, W - 120, 38, 'bold', 20);
        if (champ.owner) { ctx.fillStyle = C.sub; ctx.font = font(15, 'medium'); ctx.fillText(`@${champ.owner}`, W / 2, ty + 64); }
        const stats = [['Reign', `#${champ.reignNumber}`], ['Days', String(champ.days)], ['Defenses', String(champ.defenses)]];
        const sw = 150, sx = W / 2 - (3 * sw + 2 * 12) / 2, sy = ty + 80;
        stats.forEach(([l, v], i) => {
            const x0 = sx + i * (sw + 12);
            ctx.fillStyle = C.panel; rr(ctx, x0, sy, sw, 70, 12); ctx.fill();
            ctx.fillStyle = C.sub; ctx.font = font(11, 'medium'); ctx.fillText(l.toUpperCase(), x0 + sw / 2, sy + 21);
            ctx.fillStyle = C.gold; ctx.font = font(28, 'bold'); ctx.fillText(v, x0 + sw / 2, sy + 56);
        });
    } else {
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(bx, py - 34, bw, 68);
        ctx.fillStyle = '#fff'; ctx.font = font(52, 'bold'); ctx.fillText('VACANT', W / 2, py + 18);
        ctx.fillStyle = C.sub; ctx.font = font(16, 'medium');
        ctx.fillText(data.totalReigns ? `${data.totalReigns} past reign${data.totalReigns > 1 ? 's' : ''} on record` : 'No champion has been crowned yet', W / 2, ty + 20);
    }
    // contender and rematch chips along the bottom
    const chips = [];
    if (data.contender) chips.push([`#1 CONTENDER: ${data.contender}`.slice(0, 40), '#a85a10']);
    if (data.rematch) chips.push([`REMATCH OWED: ${data.rematch.name} (until ${data.rematch.until})`.slice(0, 52), '#2563a8']);
    let cx0 = 44;
    ctx.textAlign = 'left';
    for (const [t, bg] of chips) { const w = chip(ctx, t, cx0, chipY, { bg, size: 14, h: 28 }); cx0 += (typeof w === 'number' ? w : 360) + 12; }
    if (prev.length) drawPrevious(ctx, prev, 44, chipY + (hasChips ? 44 : 6) + 10, W);
    return canvas.toBuffer('image/png');
}

function drawPrevious(ctx, prev, x0, y0, W) {
    ctx.fillStyle = C.sub; ctx.font = font(13, 'bold');
    ctx.fillText('PREVIOUS CHAMPIONS', x0, y0 + 2);
    const pw = (W - 88 - 2 * 14) / 3;
    prev.forEach((p, i) => {
        const x = x0 + i * (pw + 14), y = y0 + 14;
        ctx.fillStyle = C.panel; rr(ctx, x, y, pw, 54, 12); ctx.fill();
        ctx.fillStyle = C.text; fitText(ctx, p.name, x + 14, y + 24, pw - 28, 18, 'bold', 11);
        ctx.fillStyle = C.sub; ctx.font = font(13, 'medium');
        ctx.fillText(`${p.days} day${p.days === 1 ? '' : 's'}`, x + 14, y + 44);
    });
}

async function renderPlainBeltCard(data) {
    const W = 1000;
    const prev = data.previous || [];
    const H = 440 + (data.rematch && data.contender ? 30 : 0) + (prev.length ? 92 : 0);
    const th = themeOf(data.title.division);
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    baseBackground(ctx, W, H, C.gold);

    // gold frame
    const fg = ctx.createLinearGradient(0, 0, W, H);
    fg.addColorStop(0, C.gold); fg.addColorStop(0.5, C.goldDark); fg.addColorStop(1, C.gold);
    ctx.strokeStyle = fg; ctx.lineWidth = 6;
    rr(ctx, 8, 8, W - 16, H - 16, 22); ctx.stroke();

    serverTag(ctx, data.serverName, W / 2, 30, { align: 'center', size: 12 });
    ctx.textAlign = 'center';
    ctx.fillStyle = C.gold;
    fitText(ctx, data.title.name.toUpperCase(), W / 2, 66, W - 100, 38, 'bold', 20);
    ctx.fillStyle = C.sub; ctx.font = font(15, 'medium');
    ctx.fillText(`${th.label.toUpperCase()} DIVISION${data.title.is_tag_title ? '  •  TAG TEAM TITLE' : ''}`, W / 2, 94);
    ctx.textAlign = 'left';

    const champ = data.champion;
    if (!champ) {
        ctx.textAlign = 'center';
        ctx.fillStyle = C.grey;
        ctx.font = font(64, 'bold');
        ctx.fillText('VACANT', W / 2, 235);
        ctx.fillStyle = C.sub; ctx.font = font(17, 'medium');
        ctx.fillText(data.totalReigns ? `${data.totalReigns} past reign${data.totalReigns > 1 ? 's' : ''} on record` : 'No champion has been crowned yet', W / 2, 275);
        ctx.textAlign = 'left';
    } else {
        const members = champ.members.slice(0, 4);
        const n = members.length || 1;
        const tw = n === 1 ? 250 : Math.min(150, 330 / n);
        const arts = await Promise.all(members.map((m) => loadArt(m.imageUrl)));
        members.forEach((m, i) => {
            const x = 44 + i * (tw + 12), y = 124;
            const h = 270;
            ctx.save(); rr(ctx, x, y, tw, h, 16); ctx.clip();
            if (arts[i]) drawCover(ctx, arts[i], x, y, tw, h); else placeholderArt(ctx, x, y, tw, h, m.name, m.division);
            const g = ctx.createLinearGradient(0, y + h * 0.6, 0, y + h);
            g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.85)');
            ctx.fillStyle = g; ctx.fillRect(x, y, tw, h);
            ctx.restore();
            ctx.strokeStyle = C.gold; ctx.lineWidth = 3;
            rr(ctx, x + 1.5, y + 1.5, tw - 3, h - 3, 15); ctx.stroke();
            if (n > 1) {
                ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
                fitText(ctx, m.name, x + tw / 2, y + h - 12, tw - 12, 14, 'bold', 9);
                ctx.textAlign = 'left';
            }
        });

        const tx = 44 + n * (tw + 12) + 24;
        ctx.fillStyle = C.sub; ctx.font = font(14, 'bold');
        ctx.fillText(data.title.is_tag_title ? 'CURRENT CHAMPIONS' : 'CURRENT CHAMPION', tx, 150);
        ctx.fillStyle = C.text;
        fitText(ctx, champ.name, tx, 200, W - tx - 40, 44, 'bold', 22);
        ctx.fillStyle = C.sub; ctx.font = font(16, 'medium');
        if (champ.owner) fitText(ctx, `@${champ.owner}`, tx, 228, W - tx - 40, 16, 'medium', 11);

        const stats = [
            ['Reign', `#${champ.reignNumber}`],
            ['Days', String(champ.days)],
            ['Defenses', String(champ.defenses)]
        ];
        const bw = Math.min(150, (W - tx - 40 - 24) / 3);
        stats.forEach(([l, v], i) => {
            const x = tx + i * (bw + 12), y = 252;
            ctx.fillStyle = C.panel; rr(ctx, x, y, bw, 78, 12); ctx.fill();
            ctx.textAlign = 'center';
            ctx.fillStyle = C.sub; ctx.font = font(12, 'medium'); ctx.fillText(l.toUpperCase(), x + bw / 2, y + 24);
            ctx.fillStyle = C.gold; ctx.font = font(30, 'bold'); ctx.fillText(v, x + bw / 2, y + 62);
            ctx.textAlign = 'left';
        });
        ctx.fillStyle = C.sub; ctx.font = font(14, 'medium');
        ctx.fillText(`Champion since ${champ.since}${champ.isBackfilled ? '  (historical)' : ''}`, tx, 358);
        if (data.contender) {
            chip(ctx, `#1 CONTENDER: ${data.contender}`.slice(0, 46), tx, 372, { bg: '#a85a10', size: 14, h: 28 });
        }
        if (data.rematch) {
            chip(ctx, `REMATCH OWED: ${data.rematch.name}`.slice(0, 40), tx, data.contender ? 406 : 372, { bg: '#2563a8', size: 14, h: 28 });
        }
    }
    if (!champ && data.contender) {
        ctx.textAlign = 'center';
        chip(ctx, `#1 CONTENDER: ${data.contender}`.slice(0, 46), W / 2 - 170, 330, { bg: '#a85a10', size: 15, h: 30 });
        ctx.textAlign = 'left';
    }
    if (prev.length) {
        ctx.fillStyle = C.sub; ctx.font = font(13, 'bold');
        ctx.fillText('PREVIOUS CHAMPIONS', 44, 436);
        const pw = (W - 88 - 2 * 14) / 3;
        prev.forEach((p, i) => {
            const x = 44 + i * (pw + 14), y = 448;
            ctx.fillStyle = C.panel; rr(ctx, x, y, pw, 54, 12); ctx.fill();
            ctx.fillStyle = C.text; fitText(ctx, p.name, x + 14, y + 24, pw - 28, 18, 'bold', 11);
            ctx.fillStyle = C.sub; ctx.font = font(13, 'medium');
            ctx.fillText(`${p.days} day${p.days === 1 ? '' : 's'}`, x + 14, y + 44);
        });
    }
    return canvas.toBuffer('image/png');
}

module.exports = { renderBeltCard };
