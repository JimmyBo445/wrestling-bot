const { createCanvas } = require('@napi-rs/canvas');
const {
    font, C, themeOf, rr, fitText, wrapLines, drawCover, loadArt, placeholderArt, baseBackground, chip,
    statBox, streakText, recordText, formRow, serverTag
} = require('./common');
const { MATCH_CONFIG } = require('../utils/constants');

const ALIGN = { face: { text: 'FACE', bg: '#2e9e5b' }, heel: { text: 'HEEL', bg: '#c0392b' }, neutral: { text: 'NEUTRAL', bg: '#5b5b6b' } };

/**
 * data: { character:{name,division,imageUrl,alignment,bio,status}, ownerName, summary, titlesHeld:[string],
 *         titleList:[{name,count,current,nth}], reigns:int, defenses:int, teamName|null, badges }
 */
async function renderProfileCard(data) {
    const { character: c, summary: s } = data;
    const hasSig = Boolean(c.finisher || c.entranceTheme || c.signatures);
    const dy = hasSig ? 62 : 0; // room for the finisher / signatures / entrance theme row
    const badges = (data.badges || []).slice(0, 6);
    const bd = badges.length ? 40 : 0; // room for the badge row
    const cp = c.catchphrase ? 26 : 0; // room for the catchphrase line
    // championships: one line per belt (up to 4), then a summary line
    const titleList = data.titleList || data.titlesHeld.map((name) => ({ name, count: 1, current: true, nth: 1 }));
    const tLines = titleList.slice(0, 4);
    const tx = tLines.length ? Math.max(0, 26 * (tLines.length + 1) + 4 - 66) : 0;
    const W = 1000, H = 560 + dy + bd + cp + tx;
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
        ctx.fillText(['CHAMPION', 'CHAMPION', 'DOUBLE CHAMPION', 'TRIPLE CHAMPION'][data.titlesHeld.length] || `${data.titlesHeld.length}-BELT CHAMPION`, ax + aw / 2, ay + ah - 58);
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
    if (c.status === 'retired') cx += chip(ctx, 'RETIRED', cx, 132, { bg: '#555', size: 13, h: 26 }) + 8;
    if (data.injuredUntil) chip(ctx, `INJURED UNTIL ${data.injuredUntil.slice(5).replace('-', '/')}`, cx, 132, { bg: '#b3261e', size: 13, h: 26 });

    // finisher + entrance theme
    if (hasSig) {
        const items = [['FINISHER', c.finisher], ['SIGNATURES', c.signatures], ['ENTRANCE THEME', c.entranceTheme]].filter((x) => x[1]);
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

    // achievement badges
    if (badges.length) {
        const tones = { gold: [C.goldDark, '#fff3cf'], orange: ['#a85a10', '#ffe9cf'], green: ['#1f7a45', '#dcfbe8'], grey: ['#3a3a46', '#d4d4de'] };
        let bx = px;
        for (const b of badges) {
            const [bg, fg] = tones[b.tone] || tones.grey;
            ctx.font = font(12, 'bold');
            const w = ctx.measureText(b.label).width + 24;
            if (bx + w > W - 30) break;
            chip(ctx, b.label, bx, 396 + dy, { bg, fg, size: 12, h: 26, padX: 12 });
            bx += w + 8;
        }
    }

    // titles: one line per belt
    ctx.fillStyle = C.gold;
    ctx.font = font(13, 'bold');
    ctx.fillText('CHAMPIONSHIPS', px, 418 + dy + bd);
    const champName = (n) => String(n).replace(/\s+Championships?$/i, ' Champion');
    const ord = (n) => { const v = n % 100; return n + (['th', 'st', 'nd', 'rd'][(v - 20) % 10] || ['th', 'st', 'nd', 'rd'][v] || 'th'); };
    let ty = 446 + dy + bd;
    if (!tLines.length) {
        ctx.fillStyle = C.grey; ctx.font = font(15, 'medium');
        ctx.fillText('No title reigns yet', px, ty);
    } else {
        const maxX = W - 30;
        for (const t of tLines) {
            const parts = t.current
                ? [[champName(t.name), C.gold, 'bold'], [`  ·  ${ord(t.nth)} reign`, C.sub, 'medium']]
                : [['Former ', C.sub, 'medium'], [champName(t.name), C.text, 'bold'], [`  (${t.count}x)`, C.sub, 'medium']];
            let x = px;
            if (t.current) { ctx.fillStyle = C.gold; rr(ctx, x, ty - 13, 5, 16, 2); ctx.fill(); x += 13; }
            for (const [txt, col, wt] of parts) {
                ctx.font = font(16, wt); ctx.fillStyle = col;
                const w = ctx.measureText(txt).width;
                if (x + w > maxX) { fitText(ctx, txt, x, ty, maxX - x, 16, wt, 10); x = maxX; break; }
                ctx.fillText(txt, x, ty);
                x += w;
            }
            ty += 26;
        }
        const more = titleList.length - tLines.length;
        ctx.fillStyle = C.sub; ctx.font = font(13, 'medium');
        ctx.fillText(`${more > 0 ? `+${more} more belt${more === 1 ? '' : 's'}  •  ` : ''}${data.reigns} total reign${data.reigns === 1 ? '' : 's'}  •  ${data.defenses} title defense${data.defenses === 1 ? '' : 's'}`, px, ty + 4);
    }

    if (c.catchphrase) {
        ctx.fillStyle = C.gold;
        fitText(ctx, `“${c.catchphrase}”`, px, H - 28 - (c.bio ? 26 : 0), W - px - 30, 17, 'bold', 11);
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
