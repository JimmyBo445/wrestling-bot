const path = require('path');
const fs = require('fs');
const { createCanvas, GlobalFonts, loadImage } = require('@napi-rs/canvas');
const { pool } = require('../db/pool');
const { getStreaks } = require('./contenderLogic');

// Railway's container images often ship without system fonts, which makes
// @napi-rs/canvas render blank text. Register a bundled font if present so
// cards work out of the box; see assets/fonts/README.md for setup.
const bundledFontPath = path.join(__dirname, '..', '..', 'assets', 'fonts', 'Inter-Bold.ttf');
if (fs.existsSync(bundledFontPath)) {
    GlobalFonts.registerFromPath(bundledFontPath, 'sans-serif');
}

const BG = '#111014';
const GOLD = '#D4AF37';
const RED = '#B4182F';
const WHITE = '#F5F5F5';
const GREY = '#8A8A8F';

function roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

async function safeLoadImage(url) {
    if (!url) return null;
    try {
        return await loadImage(url);
    } catch (_) {
        return null;
    }
}

/**
 * Renders a "VS" style match result card. winners/losers are arrays of
 * character rows (from getCharacterById).
 */
async function renderMatchCard({ matchType, resultType, winners, losers, notes }) {
    const width = 1000;
    const height = 480;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Background
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, '#1a1a1f');
    grad.addColorStop(1, '#0b0b0d');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Top bar: match type label
    ctx.fillStyle = RED;
    ctx.fillRect(0, 0, width, 8);

    ctx.fillStyle = GOLD;
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(matchType.toUpperCase(), width / 2, 55);

    ctx.fillStyle = GREY;
    ctx.font = '18px sans-serif';
    const resultLabel = resultType === 'decisive' ? 'FINAL' : resultType === 'draw' ? 'DRAW' : 'NO CONTEST';
    ctx.fillText(resultLabel, width / 2, 85);

    const allNames = [...winners.map((w) => w.name), 'VS', ...losers.map((l) => l.name)];

    // Draw two columns: winners (left, gold) vs losers (right, grey)
    const colWidth = width / 2;

    ctx.textAlign = 'center';
    ctx.font = 'bold 36px sans-serif';
    ctx.fillStyle = resultType === 'decisive' ? GOLD : WHITE;
    winners.forEach((w, i) => {
        ctx.fillText(w.name, colWidth / 2 + 20, 200 + i * 50);
    });

    ctx.fillStyle = GREY;
    losers.forEach((l, i) => {
        ctx.fillText(l.name, colWidth + colWidth / 2 - 20, 200 + i * 50);
    });

    // VS divider
    ctx.font = 'bold 48px sans-serif';
    ctx.fillStyle = RED;
    ctx.fillText('VS', width / 2, 220);

    if (resultType === 'decisive' && winners.length) {
        ctx.font = 'bold 22px sans-serif';
        ctx.fillStyle = GOLD;
        ctx.fillText(`WINNER${winners.length > 1 ? 'S' : ''}: ${winners.map((w) => w.name).join(' & ')}`, width / 2, height - 60);
    }

    if (notes) {
        ctx.font = 'italic 16px sans-serif';
        ctx.fillStyle = GREY;
        ctx.fillText(notes.slice(0, 90), width / 2, height - 25);
    }

    return canvas.toBuffer('image/png');
}

/**
 * Renders a wrestler profile card with wins/losses/streaks and current titles held.
 */
async function renderProfileCard(character) {
    const width = 900;
    const height = 500;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, width, height);

    // Left panel: character art or placeholder
    const artW = 320;
    ctx.fillStyle = '#1c1c22';
    ctx.fillRect(0, 0, artW, height);

    const img = await safeLoadImage(character.image_url);
    if (img) {
        // cover-fit the image into the left panel
        const scale = Math.max(artW / img.width, height / img.height);
        const iw = img.width * scale, ih = img.height * scale;
        ctx.drawImage(img, (artW - iw) / 2, (height - ih) / 2, iw, ih);
    } else {
        ctx.fillStyle = GREY;
        ctx.font = 'bold 60px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(character.name.slice(0, 2).toUpperCase(), artW / 2, height / 2);
    }

    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(artW, 0);
    ctx.lineTo(artW, height);
    ctx.stroke();

    // Right panel: stats
    const px = artW + 40;
    ctx.textAlign = 'left';
    ctx.fillStyle = GOLD;
    ctx.font = 'bold 40px sans-serif';
    ctx.fillText(character.name, px, 70);

    ctx.fillStyle = GREY;
    ctx.font = '20px sans-serif';
    ctx.fillText(`${character.division.toUpperCase()} DIVISION  ·  Owner: @${character.owner_discord_id}`, px, 100);

    const { rows: statRows } = await pool.query(
        `SELECT
            COUNT(*) FILTER (WHERE mp.is_winner AND m.result_type = 'decisive') AS wins,
            COUNT(*) FILTER (WHERE NOT mp.is_winner AND m.result_type = 'decisive') AS losses
         FROM match_participants mp JOIN matches m ON m.id = mp.match_id
         WHERE mp.character_id = $1`,
        [character.id]
    );
    const wins = parseInt(statRows[0]?.wins || 0, 10);
    const losses = parseInt(statRows[0]?.losses || 0, 10);
    const winPct = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : '0.0';

    const streaks = await getStreaks(character.id);

    const { rows: titleRows } = await pool.query(
        `SELECT t.name FROM title_reigns tr JOIN titles t ON t.id = tr.title_id
         WHERE tr.character_id = $1 AND tr.lost_date IS NULL`,
        [character.id]
    );

    let y = 160;
    const line = (label, value, color = WHITE) => {
        ctx.fillStyle = GREY;
        ctx.font = '20px sans-serif';
        ctx.fillText(label, px, y);
        ctx.fillStyle = color;
        ctx.font = 'bold 24px sans-serif';
        ctx.fillText(String(value), px + 220, y);
        y += 42;
    };

    line('Record', `${wins}-${losses} (${winPct}%)`);
    line('Current Streak', streaks.current > 0 ? `${streaks.current} ${streaks.direction}${streaks.current > 1 ? 's' : ''}` : '—', streaks.direction === 'win' ? '#2ECC71' : streaks.direction === 'loss' ? '#E74C3C' : WHITE);
    line('Longest Win Streak', streaks.longestWin);
    line('Longest Loss Streak', streaks.longestLoss);
    line('Titles Held', titleRows.length ? titleRows.map((t) => t.name).join(', ').slice(0, 40) : 'None', GOLD);

    return canvas.toBuffer('image/png');
}

module.exports = { renderMatchCard, renderProfileCard };
