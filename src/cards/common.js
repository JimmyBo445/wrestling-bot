const path = require('path');
const fs = require('fs');
const { GlobalFonts, loadImage } = require('@napi-rs/canvas');
const { fetchImageBuffer } = require('../utils/imageUrl');
const { DIVISION_THEME } = require('../utils/constants');

// Bundled fonts so text renders on servers that have no system fonts (Railway).
const FONT_DIR = path.join(__dirname, '..', '..', 'assets', 'fonts');
let fontsReady = false;
function ensureFonts() {
    if (fontsReady) return;
    for (const f of ['Poppins-Regular.ttf', 'Poppins-Medium.ttf', 'Poppins-Bold.ttf']) {
        const p = path.join(FONT_DIR, f);
        if (fs.existsSync(p)) GlobalFonts.registerFromPath(p, 'Poppins');
    }
    fontsReady = true;
}
ensureFonts();
const FONT = 'Poppins, "DejaVu Sans", "Liberation Sans", Arial, sans-serif';
const font = (size, weight = '') => `${weight ? weight + ' ' : ''}${size}px ${FONT}`;

const C = {
    bg: '#0d0d11', panel: '#17171d', panel2: '#1f1f27', line: '#2b2b36',
    text: '#f4f4f6', sub: '#9a9aa8', gold: '#e8bf4a', goldDark: '#9a7516',
    green: '#35c46a', red: '#e5484d', orange: '#f08c32', grey: '#6b6b78'
};

function themeOf(division) {
    return DIVISION_THEME[division] || DIVISION_THEME.mens;
}

function rr(ctx, x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
}

/** Draws text shrunk (down to minSize) until it fits maxWidth, then ellipsised. */
function fitText(ctx, text, x, y, maxWidth, size, weight = 'bold', minSize = 12) {
    let s = size;
    ctx.font = font(s, weight);
    while (ctx.measureText(text).width > maxWidth && s > minSize) { s -= 1; ctx.font = font(s, weight); }
    let out = text;
    if (ctx.measureText(out).width > maxWidth) {
        while (out.length > 1 && ctx.measureText(out + '…').width > maxWidth) out = out.slice(0, -1);
        out += '…';
    }
    ctx.fillText(out, x, y);
    return s;
}

function wrapLines(ctx, text, maxWidth, maxLines) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = '';
    for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; } else line = test;
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) {
        lines.length = maxLines;
        lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…';
    }
    return lines;
}

/** Draws an image so it fills (x,y,w,h) completely, cropping the overflow ("cover"). */
function drawCover(ctx, img, x, y, w, h, focusY = 0.25) {
    const scale = Math.max(w / img.width, h / img.height);
    const iw = img.width * scale, ih = img.height * scale;
    ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) * focusY, iw, ih);
}

async function loadArt(url) {
    const buf = await fetchImageBuffer(url);
    if (!buf) return null;
    try { return await loadImage(buf); } catch (_) { return null; }
}

function initials(name) {
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    const s = parts.length > 1 ? parts[0][0] + parts[1][0] : String(name).slice(0, 2);
    return s.toUpperCase();
}

function placeholderArt(ctx, x, y, w, h, name, division) {
    const th = themeOf(division);
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, th.accent2);
    g.addColorStop(1, '#101014');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font(Math.min(w, h) * 0.42, 'bold');
    ctx.fillText(initials(name), x + w / 2, y + h / 2);
    ctx.textBaseline = 'alphabetic';
}

function chip(ctx, text, x, y, { bg, fg = '#fff', size = 15, padX = 12, h = 28, weight = 'bold' }) {
    ctx.font = font(size, weight);
    const w = ctx.measureText(text).width + padX * 2;
    ctx.fillStyle = bg;
    rr(ctx, x, y, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + padX, y + h / 2 + 1);
    ctx.textBaseline = 'alphabetic';
    return w;
}

function formColor(r) {
    return r === 'W' ? C.green : r === 'L' ? C.red : C.grey;
}

function baseBackground(ctx, w, h, accent) {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#1b1b23');
    g.addColorStop(1, C.bg);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // soft glow in the division color
    const rg = ctx.createRadialGradient(w * 0.5, 0, 10, w * 0.5, 0, w * 0.8);
    rg.addColorStop(0, accent + '40');
    rg.addColorStop(1, 'transparent');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, w, h);
}

module.exports = {
    ensureFonts, font, FONT, C, themeOf, rr, fitText, wrapLines, drawCover, loadArt,
    initials, placeholderArt, chip, formColor, baseBackground
};

/** A labelled number box used on profile/team/belt cards. */
function statBox(ctx, x, y, w, h, label, value, valueColor = C.text) {
    ctx.fillStyle = C.panel;
    rr(ctx, x, y, w, h, 14); ctx.fill();
    ctx.strokeStyle = C.line; ctx.lineWidth = 1.5;
    rr(ctx, x + 0.75, y + 0.75, w - 1.5, h - 1.5, 13); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = C.sub;
    ctx.font = font(13, 'medium');
    ctx.fillText(label.toUpperCase(), x + w / 2, y + 26);
    ctx.fillStyle = valueColor;
    fitText(ctx, String(value), x + w / 2, y + h - 22, w - 20, 32, 'bold', 16);
    ctx.textAlign = 'left';
}

function streakText(streaks) {
    if (!streaks || !streaks.current) return { text: '—', color: C.text };
    return streaks.direction === 'win'
        ? { text: `W${streaks.current}`, color: C.green }
        : { text: `L${streaks.current}`, color: C.red };
}

function recordText(s) {
    return `${s.wins}-${s.losses}${s.draws ? `-${s.draws}` : ''}`;
}

function formRow(ctx, x, y, form) {
    ctx.textAlign = 'left';
    ctx.fillStyle = C.sub;
    ctx.font = font(13, 'medium');
    ctx.fillText('LAST 5', x, y + 18);
    let cx = x + 66;
    if (!form.length) {
        ctx.fillStyle = C.grey; ctx.font = font(14, 'medium'); ctx.fillText('no matches yet', cx, y + 18);
        return;
    }
    for (const r of form) {
        ctx.fillStyle = formColor(r);
        rr(ctx, cx, y, 34, 26, 8); ctx.fill();
        ctx.fillStyle = '#0b0b0e';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = font(14, 'bold');
        ctx.fillText(r === 'NC' ? 'NC' : r, cx + 17, y + 14);
        ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
        cx += 42;
    }
}

module.exports.statBox = statBox;
module.exports.streakText = streakText;
module.exports.recordText = recordText;
module.exports.formRow = formRow;
