const { createCanvas } = require('@napi-rs/canvas');
const { font, C, themeOf, rr, fitText, baseBackground, serverTag } = require('./common');

/**
 * data: { serverName, title:{name,division,is_tag_title}, totalReigns, hiddenEarlier,
 *         reigns:[{ n, name, won:'YYYY-MM-DD', lost:'YYYY-MM-DD'|null, days, defenses, backfilled }]   (oldest first) }
 */
const W = 1000;
const ROW = 56;

async function renderLineageCard(data) {
    const th = themeOf(data.title.division);
    const rows = data.reigns;
    const headerH = 230;
    const H = headerH + Math.max(rows.length, 1) * ROW + (data.hiddenEarlier ? 30 : 0) + 56;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    baseBackground(ctx, W, H, C.gold);

    const fg = ctx.createLinearGradient(0, 0, W, H);
    fg.addColorStop(0, C.gold); fg.addColorStop(0.5, C.goldDark); fg.addColorStop(1, C.gold);
    ctx.strokeStyle = fg; ctx.lineWidth = 6;
    rr(ctx, 8, 8, W - 16, H - 16, 22); ctx.stroke();

    serverTag(ctx, data.serverName, W / 2, 34, { align: 'center', size: 12 });
    ctx.textAlign = 'center';
    ctx.fillStyle = C.gold;
    fitText(ctx, data.title.name.toUpperCase(), W / 2, 76, W - 100, 38, 'bold', 20);
    ctx.fillStyle = C.sub; ctx.font = font(15, 'medium');
    ctx.fillText(`CHAMPIONSHIP LINEAGE  •  ${th.label.toUpperCase()} DIVISION${data.title.is_tag_title ? '  •  TAG' : ''}`, W / 2, 104);

    // highlight strip
    const longest = rows.reduce((b, r) => (!b || r.days > b.days ? r : b), null);
    const mostDef = rows.reduce((b, r) => (!b || r.defenses > b.defenses ? r : b), null);
    const current = rows.find((r) => !r.lost) || null;
    const boxes = [
        ['REIGNS', String(data.totalReigns), null],
        ['LONGEST REIGN', longest ? `${longest.days}d` : '—', longest?.name],
        ['MOST DEFENSES', mostDef && mostDef.defenses ? String(mostDef.defenses) : '—', mostDef && mostDef.defenses ? mostDef.name : null],
        ['CHAMPION NOW', current ? `${current.days}d` : 'VACANT', current?.name]
    ];
    const bw = (W - 80 - 3 * 14) / 4;
    boxes.forEach(([label, value, sub], i) => {
        const x = 40 + i * (bw + 14), y = 128;
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        rr(ctx, x, y, bw, 82, 14); ctx.fill();
        ctx.strokeStyle = 'rgba(232,191,74,0.35)'; ctx.lineWidth = 1.5;
        rr(ctx, x + 0.75, y + 0.75, bw - 1.5, 80.5, 13); ctx.stroke();
        ctx.textAlign = 'center';
        ctx.fillStyle = C.sub; ctx.font = font(11, 'bold');
        ctx.fillText(label, x + bw / 2, y + 20);
        ctx.fillStyle = C.gold;
        fitText(ctx, value, x + bw / 2, y + 52, bw - 20, 28, 'bold', 14);
        if (sub) { ctx.fillStyle = C.text; fitText(ctx, sub, x + bw / 2, y + 71, bw - 20, 12, 'medium', 9); }
    });

    ctx.textAlign = 'left';
    if (!rows.length) {
        ctx.textAlign = 'center'; ctx.fillStyle = C.grey; ctx.font = font(22, 'medium');
        ctx.fillText('No champions have been crowned yet', W / 2, headerH + 40);
        return canvas.toBuffer('image/png');
    }

    // timeline rows
    const maxDays = Math.max(...rows.map((r) => r.days), 1);
    let y = headerH;
    if (data.hiddenEarlier) {
        ctx.fillStyle = C.sub; ctx.font = font(13, 'medium'); ctx.textAlign = 'center';
        ctx.fillText(`+ ${data.hiddenEarlier} earlier reign${data.hiddenEarlier > 1 ? 's' : ''}`, W / 2, y + 18);
        ctx.textAlign = 'left';
        y += 30;
    }
    // vertical spine
    ctx.strokeStyle = 'rgba(232,191,74,0.35)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(62, y + ROW / 2); ctx.lineTo(62, y + (rows.length - 1) * ROW + ROW / 2); ctx.stroke();

    rows.forEach((r, i) => {
        const ry = y + i * ROW;
        const isNow = !r.lost;
        if (isNow) {
            ctx.fillStyle = 'rgba(232,191,74,0.10)';
            rr(ctx, 28, ry + 2, W - 56, ROW - 4, 12); ctx.fill();
            ctx.strokeStyle = C.gold; ctx.lineWidth = 2;
            rr(ctx, 29, ry + 3, W - 58, ROW - 6, 11); ctx.stroke();
        }
        // number dot
        ctx.fillStyle = isNow ? C.gold : C.goldDark;
        ctx.beginPath(); ctx.arc(62, ry + ROW / 2, 15, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = isNow ? '#17120a' : '#fff3cf';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = font(13, 'bold');
        ctx.fillText(String(r.n), 62, ry + ROW / 2 + 1);
        ctx.textBaseline = 'alphabetic';
        // name + dates
        ctx.textAlign = 'left';
        ctx.fillStyle = C.text;
        fitText(ctx, `${r.name}${r.backfilled ? '  (historical)' : ''}`, 94, ry + 25, 350, 18, 'bold', 11);
        ctx.fillStyle = C.sub; ctx.font = font(12, 'medium');
        ctx.fillText(`${r.won}  →  ${r.lost || 'present'}`, 94, ry + 43);
        // bar
        const bx = 470, maxW = 330;
        const w = Math.max(6, (r.days / maxDays) * maxW);
        const g = ctx.createLinearGradient(bx, 0, bx + w, 0);
        g.addColorStop(0, isNow ? C.gold : C.goldDark); g.addColorStop(1, isNow ? '#fff1b8' : C.gold);
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        rr(ctx, bx, ry + 19, maxW, 18, 9); ctx.fill();
        ctx.fillStyle = g;
        rr(ctx, bx, ry + 19, w, 18, 9); ctx.fill();
        ctx.fillStyle = C.text; ctx.font = font(14, 'bold');
        ctx.fillText(`${r.days}d`, bx + maxW + 14, ry + 34);
        // defenses
        ctx.textAlign = 'right';
        ctx.fillStyle = r.defenses ? C.gold : C.grey; ctx.font = font(13, 'bold');
        ctx.fillText(`${r.defenses} DEF`, W - 44, ry + 34);
        ctx.textAlign = 'left';
    });

    ctx.textAlign = 'center';
    ctx.fillStyle = C.sub; ctx.font = font(12, 'medium');
    ctx.fillText('Bar length = days as champion  •  DEF = successful title defenses', W / 2, H - 28);
    ctx.textAlign = 'left';
    return canvas.toBuffer('image/png');
}

module.exports = { renderLineageCard };
