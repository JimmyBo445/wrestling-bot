const { createCanvas } = require('@napi-rs/canvas');
const {
    font, C, themeOf, rr, fitText, wrapLines, drawCover, loadArt, placeholderArt, baseBackground, chip,
    statBox, streakText, recordText, formRow, serverTag
} = require('./common');
const { MATCH_CONFIG } = require('../utils/constants');

const ALIGN = { face: { text: 'FACE', bg: '#2e9e5b' }, heel: { text: 'HEEL', bg: '#c0392b' }, neutral: { text: 'NEUTRAL', bg: '#5b5b6b' } };

/**
 * data: { character:{name,division,imageUrl,alignment,bio,status}, ownerName, summary, titlesHeld:[string],
 *         reigns:int, defenses:int, teamName|null }
 */
async function renderProfileCard(data) {
    const { character: c, summary: s } = data;
    const hasSig = Boolean(c.finisher || c.entranceTheme);
    const dy = hasSig ? 62 : 0; // room for the finisher / entrance theme row
    const W = 1000, H = 560 + dy;
    const th = themeOf(c.division);
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    baseBackground(ctx, W, H, th.accent);

    // ---- art panel ----
    const ax = 30, ay = 30, aw = 320, ah = H - 60;
    const art = await loadArt(c.imageUrl);
    ctx.save();
    rr(ctx, ax, ay, aw, ah, 22); ctx.clip();
    if (art) drawCover(ctx, art, ax, ay, aw, ah); else placeholderArt(ctx, ax, ay, aw, ah, c.name, c.division);
    const g = ctx.createLinearGradient(0, ay + ah * 0.55, 0, ay + ah);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.9)');
    ctx.fillStyle = g; ctx.fillRect(ax, ay, aw, ah);
    ctx.restore();
    ctx.strokeStyle = data.titlesHeld.length ? C.gold : th.accent;
    ctx.lineWidth = 4;
    rr(ctx, ax + 2, ay + 2, aw - 4, ah - 4, 20); ctx.stroke();

    if (data.titlesHeld.length) {
        ctx.fillStyle = C.gold;
        rr(ctx, ax + 14, ay + ah - 78, aw - 28, 54, 12); ctx.fill();
        ctx.fillStyle = '#17120a';
        ctx.textAlign = 'center';
        ctx.font = font(12, 'bold');
        ctx.fillText(data.titlesHeld.length > 1 ? 'MULTI-TIME CHAMPION' : 'CHAMPION', ax + aw / 2, ay + ah - 58);
        fitText(ctx, data.titlesHeld[0].toUpperCase(), ax + aw / 2, ay + ah - 36, aw - 56, 16, 'bold', 10);
        ctx.textAlign = 'left';
    }

    // ---- right panel ----
    const px = 385;
    serverTag(ctx, data.serverName, W - 30, 28);
    ctx.fillStyle = C.text;
    ctx.textAlign = 'left';
    fitText(ctx, c.name, px, 82, W - px - 30, 46, 'bold', 24);
    ctx.fillStyle = C.sub;
    ctx.font = font(17, 'medium');
    ctx.fillText(`${th.label.toUpperCase()} DIVISION  •  @${data.ownerName}`, px, 114);

    let cx = px;
    const al = ALIGN[c.alignment];
    if (al) cx += chip(ctx, al.text, cx, 132, { bg: al.bg, size: 13, h: 26 }) + 8;
    if (data.teamName) cx += chip(ctx, `TEAM ${data.teamName.toUpperCase()}`.slice(0, 34), cx, 132, { bg: th.accent2, size: 13, h: 26 }) + 8;
    if (c.status === 'retired') chip(ctx, 'RETIRED', cx, 132, { bg: '#555', size: 13, h: 26 });

    // finisher + entrance theme
    if (hasSig) {
        const items = [['FINISHER', c.finisher], ['ENTRANCE THEME', c.entranceTheme]].filter((x) => x[1]);
        const colW = (W - px - 30 - (items.length - 1) * 14) / items.length;
        items.forEach(([label, value], i) => {
            const x = px + i * (colW + 14);
            ctx.fillStyle = C.panel;
            rr(ctx, x, 172, colW, 54, 12); ctx.fill();
            ctx.strokeStyle = th.accent2; ctx.lineWidth = 1.5;
            rr(ctx, x + 0.75, 172.75, colW - 1.5, 52.5, 11); ctx.stroke();
            ctx.textAlign = 'left';
            ctx.fillStyle = th.accent; ctx.font = font(11, 'bold');
            ctx.fillText(label, x + 14, 190);
            ctx.fillStyle = C.text;
            fitText(ctx, value, x + 14, 214, colW - 28, 18, 'bold', 11);
        });
    }

    // stat boxes
    const st = streakText(s.streaks);
    const bw = 138, gap = 12, by = 180 + dy;
    const pct = s.wins + s.losses ? `${s.winPct.toFixed(0)}%` : '—';
    statBox(ctx, px, by, bw, 92, 'Record', recordText(s));
    statBox(ctx, px + (bw + gap), by, bw, 92, 'Win %', pct);
    statBox(ctx, px + 2 * (bw + gap), by, bw, 92, 'Streak', st.text, st.color);
    statBox(ctx, px + 3 * (bw + gap), by, bw - 8, 92, 'Best run', s.streaks.longestWin ? `W${s.streaks.longestWin}` : '—', C.green);

    formRow(ctx, px, 296 + dy, s.form);
    if (data.allTime) {
        ctx.textAlign = 'right'; ctx.fillStyle = C.sub; ctx.font = font(13, 'medium');
        const a = data.allTime;
        ctx.fillText(`ALL OWNERS: ${a.wins}-${a.losses}${a.draws ? `-${a.draws}` : ''}`, W - 30, 316 + dy);
        ctx.textAlign = 'left';
    }

    // by match type
    const typeBits = Object.entries(s.byType)
        .map(([k, v]) => `${MATCH_CONFIG[k]?.label || k} ${v.w}-${v.l}`);
    ctx.fillStyle = C.sub;
    ctx.font = font(14, 'medium');
    const typeLines = wrapLines(ctx, typeBits.length ? typeBits.join('   •   ') : 'No matches logged yet.', W - px - 30, 2);
    typeLines.forEach((l, i) => ctx.fillText(l, px, 352 + dy + i * 22));

    // titles
    ctx.fillStyle = C.gold;
    ctx.font = font(13, 'bold');
    ctx.fillText('CHAMPIONSHIPS', px, 418 + dy);
    let tx = px, ty = 430 + dy;
    if (!data.titlesHeld.length) {
        ctx.fillStyle = C.grey; ctx.font = font(15, 'medium');
        ctx.fillText(data.reigns ? `Former champion  •  ${data.reigns} past reign${data.reigns > 1 ? 's' : ''}` : 'No title reigns yet', px, ty + 20);
    } else {
        for (const name of data.titlesHeld.slice(0, 4)) {
            ctx.font = font(14, 'bold');
            const w = Math.min(ctx.measureText(name).width + 28, W - px - 30);
            if (tx + w > W - 30) { tx = px; ty += 36; }
            chip(ctx, name.slice(0, 40), tx, ty, { bg: C.goldDark, fg: '#fff3cf', size: 14, h: 30 });
            tx += w + 8;
        }
        ctx.fillStyle = C.sub; ctx.font = font(13, 'medium');
        ctx.fillText(`${data.reigns} total reign${data.reigns === 1 ? '' : 's'}  •  ${data.defenses} title defense${data.defenses === 1 ? '' : 's'}`, px, ty + 54);
    }

    if (c.bio) {
        ctx.fillStyle = C.sub;
        ctx.font = font(14, 'medium');
        const bl = wrapLines(ctx, `“${c.bio}”`, W - px - 30, 1);
        ctx.fillText(bl[0], px, H - 28);
    }
    return canvas.toBuffer('image/png');
}

module.exports = { renderProfileCard };
