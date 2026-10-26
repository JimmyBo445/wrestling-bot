const { createCanvas } = require('@napi-rs/canvas');
const { font, C, themeOf, rr, fitText, wrapLines, drawCover, loadArt, placeholderArt, baseBackground, serverTag } = require('./common');

/**
 * data: { serverName, character:{name,division,imageUrl}, ownerName, months, salary (text), start, end, clauses, status, earnings (text|null) }
 * status: 'active' draws a SIGNED stamp; anything else draws the status as a stamp.
 */
async function renderContractCard(data) {
    const W = 1000, H = 440;
    const th = themeOf(data.character.division);
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    baseBackground(ctx, W, H, th.accent);
    ctx.fillStyle = th.accent; ctx.fillRect(0, 0, W, 6);
    serverTag(ctx, data.serverName, W - 40, 34);

    ctx.textAlign = 'left'; ctx.fillStyle = C.gold; ctx.font = font(15, 'bold');
    ctx.fillText('OFFICIAL CONTRACT', 40, 40);

    const art = await loadArt(data.character.imageUrl);
    ctx.save(); rr(ctx, 40, 62, 190, 190, 18); ctx.clip();
    if (art) drawCover(ctx, art, 40, 62, 190, 190); else placeholderArt(ctx, 40, 62, 190, 190, data.character.name, data.character.division);
    ctx.restore();
    ctx.strokeStyle = th.accent; ctx.lineWidth = 3; rr(ctx, 41.5, 63.5, 187, 187, 17); ctx.stroke();

    ctx.fillStyle = C.text;
    fitText(ctx, data.character.name, 260, 108, W - 300, 46, 'bold', 22);
    ctx.fillStyle = C.sub; ctx.font = font(16, 'medium');
    ctx.fillText(`${th.label.toUpperCase()} DIVISION  •  @${data.ownerName}`, 260, 136);

    const box = (x, y, w, label, value, color = C.text) => {
        ctx.fillStyle = C.panel; rr(ctx, x, y, w, 84, 14); ctx.fill();
        ctx.strokeStyle = C.line; ctx.lineWidth = 1.5; rr(ctx, x + 0.75, y + 0.75, w - 1.5, 82.5, 13); ctx.stroke();
        ctx.textAlign = 'left'; ctx.fillStyle = C.sub; ctx.font = font(12, 'medium'); ctx.fillText(label.toUpperCase(), x + 16, y + 26);
        ctx.fillStyle = color; fitText(ctx, value, x + 16, y + 64, w - 32, 28, 'bold', 14);
    };
    box(260, 156, 220, 'Salary', data.salary, C.green);
    box(494, 156, 150, 'Term', `${data.months} mo`);
    box(658, 156, 140, 'Starts', data.start || '—');
    box(812, 156, 148, 'Ends', data.end || '—');

    ctx.fillStyle = C.panel; rr(ctx, 260, 256, 700, 96, 14); ctx.fill();
    ctx.fillStyle = C.sub; ctx.font = font(12, 'medium'); ctx.textAlign = 'left';
    ctx.fillText('CLAUSES', 276, 280);
    ctx.fillStyle = data.clauses ? C.text : C.grey; ctx.font = font(16, 'medium');
    const lines = wrapLines(ctx, data.clauses || 'No special clauses.', 668, 2);
    lines.forEach((l, i) => ctx.fillText(l, 276, 306 + i * 24));

    if (data.earnings) {
        ctx.fillStyle = C.sub; ctx.font = font(13, 'medium'); ctx.fillText('CAREER EARNINGS', 40, 300);
        ctx.fillStyle = C.gold; fitText(ctx, data.earnings, 40, 332, 200, 28, 'bold', 14);
    }

    // signature line
    ctx.strokeStyle = C.line; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(40, 400); ctx.lineTo(420, 400); ctx.stroke();
    ctx.fillStyle = C.sub; ctx.font = font(12, 'medium'); ctx.fillText('SIGNED BY', 40, 420);
    if (data.status === 'active') {
        ctx.fillStyle = C.text; ctx.font = font(26, 'bold'); ctx.fillText(data.character.name, 44, 388);
    }

    // stamp
    const label = data.status === 'active' ? 'SIGNED' : String(data.status || '').toUpperCase();
    const color = data.status === 'active' ? C.green : data.status === 'expired' || data.status === 'released' ? C.red : C.orange;
    ctx.save();
    ctx.translate(790, 392); ctx.rotate(-0.12);
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 5;
    ctx.font = font(40, 'bold'); const tw = ctx.measureText(label).width;
    rr(ctx, -tw / 2 - 20, -42, tw + 40, 64, 10); ctx.stroke();
    ctx.textAlign = 'center'; ctx.fillText(label, 0, 6);
    ctx.restore();
    return canvas.toBuffer('image/png');
}

module.exports = { renderContractCard };
