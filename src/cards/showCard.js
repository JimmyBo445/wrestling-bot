const { createCanvas } = require('@napi-rs/canvas');
const { font, C, themeOf, rr, fitText, drawCover, loadArt, placeholderArt } = require('./common');
const { CARD_BRANDS } = require('../utils/constants');

/**
 * data: {
 *   brand: 'raw' | 'smackdown',
 *   division, name|null,
 *   matches: [{
 *     number, label, stipulation|null, title: string|null,
 *     mode: 'sides' | 'ffa',
 *     sides:    [{ teamName|null, members:[{ name, imageUrl, division }] }]   (mode sides)
 *     entrants: [{ name, imageUrl, division }]                               (mode ffa)
 *   }]
 * }
 */
const W = 1100;
const ROW_H = 144;
const ROW_GAP = 14;
const MARGIN = 30;
const HEADER_H = 200;
const FOOTER_H = 70;

/** Loads many images at once, but only a few at a time so a 10-match card doesn't open 80 connections. */
async function loadArts(urls, concurrency = 6) {
    const unique = [...new Set(urls.filter(Boolean))];
    const out = new Map();
    let next = 0;
    async function worker() {
        while (next < unique.length) {
            const url = unique[next++];
            out.set(url, await loadArt(url));
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, worker));
    return out;
}

function background(ctx, H, brand) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, brand.bgTop);
    g.addColorStop(1, brand.bgBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // diagonal light bars
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.045)';
    for (let i = -2; i < 9; i++) {
        const x = i * 180;
        ctx.beginPath();
        ctx.moveTo(x + 60, 0); ctx.lineTo(x + 110, 0); ctx.lineTo(x + 110 - 260, H); ctx.lineTo(x + 60 - 260, H);
        ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    const glow = ctx.createRadialGradient(W / 2, 0, 20, W / 2, 0, W * 0.75);
    glow.addColorStop(0, brand.glow + '55');
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    const vig = ctx.createLinearGradient(0, H - 260, 0, H);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, H - 260, W, 260);
}

function portrait(ctx, art, member, x, y, size, brand, divisionFallback) {
    ctx.save();
    rr(ctx, x, y, size, size, 14); ctx.clip();
    if (art) drawCover(ctx, art, x, y, size, size, 0.2);
    else placeholderArt(ctx, x, y, size, size, member.name, member.division || divisionFallback);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2.5;
    rr(ctx, x + 1, y + 1, size - 2, size - 2, 13); ctx.stroke();
    void brand;
}

function nameUnder(ctx, text, cx, y, maxW) {
    ctx.fillStyle = C.text;
    ctx.textAlign = 'center';
    fitText(ctx, text, cx, y, maxW, 15, 'bold', 10);
    ctx.textAlign = 'left';
}

function drawRow(ctx, m, y, brand, divisionFallback, arts) {
    const x = MARGIN, w = W - MARGIN * 2;
    const isTitle = Boolean(m.title);

    // panel
    ctx.fillStyle = 'rgba(8,8,12,0.58)';
    rr(ctx, x, y, w, ROW_H, 18); ctx.fill();
    ctx.strokeStyle = isTitle ? C.gold : 'rgba(255,255,255,0.14)';
    ctx.lineWidth = isTitle ? 3 : 1.5;
    rr(ctx, x + 1, y + 1, w - 2, ROW_H - 2, 17); ctx.stroke();

    // number badge
    const bx = x + 38, by = y + ROW_H / 2;
    ctx.fillStyle = isTitle ? C.gold : brand.accent;
    ctx.beginPath(); ctx.arc(bx, by, 22, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = isTitle ? '#1a1304' : '#fff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = font(22, 'bold');
    ctx.fillText(String(m.number), bx, by + 1);
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';

    const labelLine = `${m.label.toUpperCase()}${m.stipulation ? `  •  ${m.stipulation.toUpperCase()}` : ''}`;
    const areaL = x + 82, areaR = x + w - 24;

    if (m.mode === 'ffa') {
        // label block on the left, wrestlers in a row on the right
        const labelW = 250;
        ctx.textAlign = 'left';
        ctx.fillStyle = C.sub; ctx.font = font(13, 'medium');
        ctx.fillStyle = '#d6d6e0';
        fitText(ctx, labelLine, areaL, y + ROW_H / 2 - 4, labelW, 17, 'bold', 11);
        if (isTitle) {
            ctx.fillStyle = C.gold;
            fitText(ctx, m.title.toUpperCase(), areaL, y + ROW_H / 2 + 24, labelW, 15, 'bold', 10);
            ctx.fillStyle = '#ffe9a8'; ctx.font = font(11, 'bold');
            ctx.fillText('CHAMPIONSHIP MATCH', areaL, y + ROW_H / 2 - 28);
        }
        const n = m.entrants.length;
        const size = 84;
        const regionX = areaL + labelW + 20, regionW = areaR - regionX;
        const slotW = Math.min(150, regionW / n);
        const startX = regionX + (regionW - slotW * n) / 2;
        const top = y + (ROW_H - size - 22) / 2;
        m.entrants.forEach((e, i) => {
            const cx = startX + slotW * i + slotW / 2;
            portrait(ctx, arts.get(e.imageUrl) || null, e, cx - size / 2, top, size, brand, divisionFallback);
            nameUnder(ctx, e.name, cx, top + size + 19, slotW - 10);
        });
        return;
    }

    // sides: [left wrestlers] | centre | [right wrestlers]
    const centreW = 250;
    const midX = (areaL + areaR) / 2;
    const leftEnd = midX - centreW / 2 - 6;
    const rightStart = midX + centreW / 2 + 6;

    ctx.textAlign = 'center';
    ctx.fillStyle = '#d6d6e0';
    if (isTitle) {
        ctx.fillStyle = '#ffe9a8'; ctx.font = font(11, 'bold');
        ctx.fillText('CHAMPIONSHIP MATCH', midX, y + 24);
    }
    ctx.fillStyle = '#d6d6e0';
    fitText(ctx, labelLine, midX, y + (isTitle ? 46 : 38), centreW, 14, 'bold', 10);
    ctx.fillStyle = isTitle ? C.gold : '#fff';
    ctx.font = font(44, 'bold');
    ctx.fillText('VS', midX, y + ROW_H / 2 + 22);
    if (isTitle) {
        ctx.fillStyle = C.gold;
        fitText(ctx, m.title.toUpperCase(), midX, y + ROW_H - 18, centreW, 15, 'bold', 10);
    }
    ctx.textAlign = 'left';

    const anyTeam = m.sides.some((sd) => sd.teamName);
    const draw = (side, edge, alignRight) => {
        const n = side.members.length;
        const size = n === 1 ? 92 : n === 2 ? 84 : n === 3 ? 78 : 70;
        const slotW = size + 12;
        const total = slotW * n;
        const startX = alignRight ? edge - total : edge;
        const top = y + (anyTeam ? 30 : (ROW_H - size - 22) / 2);
        if (side.teamName) {
            ctx.textAlign = alignRight ? 'right' : 'left';
            ctx.fillStyle = brand.accent;
            fitText(ctx, side.teamName.toUpperCase(), edge, y + 22, 300, 13, 'bold', 9);
            ctx.textAlign = 'left';
        }
        side.members.forEach((mem, i) => {
            const cx = startX + slotW * i + slotW / 2;
            portrait(ctx, arts.get(mem.imageUrl) || null, mem, cx - size / 2, top, size, brand, divisionFallback);
            nameUnder(ctx, mem.name, cx, top + size + 19, slotW - 4);
        });
    };
    draw(m.sides[0], leftEnd, true);
    draw(m.sides[1], rightStart, false);
}

async function renderShowCard(data) {
    const brand = CARD_BRANDS[data.brand] || CARD_BRANDS.raw;
    const th = themeOf(data.division);
    const rows = data.matches.length;
    const bodyH = rows ? rows * ROW_H + (rows - 1) * ROW_GAP : 150;
    const H = HEADER_H + bodyH + FOOTER_H;

    const urls = [];
    for (const m of data.matches) {
        if (m.mode === 'ffa') m.entrants.forEach((e) => urls.push(e.imageUrl));
        else m.sides.forEach((s) => s.members.forEach((mem) => urls.push(mem.imageUrl)));
    }
    const arts = await loadArts(urls);

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    background(ctx, H, brand);

    // ---- header ----
    ctx.fillStyle = brand.accent;
    ctx.fillRect(0, 0, W, 8);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = font(88, 'bold');
    ctx.fillText(brand.label, MARGIN + 6, 106);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = font(22, 'medium');
    ctx.fillText(data.name ? data.name.toUpperCase() : 'MATCH CARD', MARGIN + 10, 148);

    // division tag on the right
    const tag = `${th.label.toUpperCase()} DIVISION`;
    ctx.font = font(22, 'bold');
    const tw = ctx.measureText(tag).width + 44;
    const tx = W - MARGIN - tw;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    rr(ctx, tx, 62, tw, 48, 24); ctx.fill();
    ctx.strokeStyle = th.accent; ctx.lineWidth = 3;
    rr(ctx, tx + 1.5, 63.5, tw - 3, 45, 22); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(tag, tx + tw / 2, 87);
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';

    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(MARGIN, 170, W - MARGIN * 2, 2);

    // ---- body ----
    if (!rows) {
        ctx.fillStyle = 'rgba(8,8,12,0.58)';
        rr(ctx, MARGIN, HEADER_H, W - MARGIN * 2, 150, 18); ctx.fill();
        ctx.fillStyle = '#d6d6e0';
        ctx.textAlign = 'center';
        ctx.font = font(24, 'medium');
        ctx.fillText('No matches booked yet', W / 2, HEADER_H + 82);
        ctx.textAlign = 'left';
    }
    data.matches.forEach((m, i) => drawRow(ctx, m, HEADER_H + i * (ROW_H + ROW_GAP), brand, data.division, arts));

    // ---- footer ----
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = font(16, 'medium');
    ctx.fillText(`${rows} MATCH${rows === 1 ? '' : 'ES'}  •  ${brand.label}  •  ${th.label.toUpperCase()}`, W / 2, H - 26);
    ctx.textAlign = 'left';

    return canvas.toBuffer('image/png');
}

module.exports = { renderShowCard };
