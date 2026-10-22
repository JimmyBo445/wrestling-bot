const dns = require('dns').promises;
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { pool } = require('../db/pool');
const net = require('net');

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;

function isPrivateIp(ip) {
    if (net.isIPv4(ip)) {
        const [a, b] = ip.split('.').map(Number);
        return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224 ||
            (a === 100 && b >= 64 && b <= 127);
    }
    if (net.isIPv6(ip)) {
        const l = ip.toLowerCase();
        return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80') ||
            l.startsWith('::ffff:');
    }
    return true;
}

/** Cheap syntax check (no network). Returns an error string or null. */
function checkUrlSyntax(raw) {
    let url;
    try { url = new URL(raw); } catch (_) { return 'That is not a valid link.'; }
    if (raw.length > 500) return 'That link is too long (500 characters max).';
    if (url.protocol !== 'https:') return 'Image links must start with https://';
    if (url.username || url.password) return 'Image links cannot contain a username or password.';
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || net.isIP(host.replace(/^\[|\]$/g, ''))) {
        return 'Image links must use a normal website address.';
    }
    return null;
}

async function assertPublicHost(hostname) {
    const addrs = await dns.lookup(hostname, { all: true });
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
        throw new Error('Link points to a private address.');
    }
}

/** Downloads an image safely (https only, no private hosts, size + time limits). */
async function downloadImage(rawUrl) {
    let current = rawUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const err = checkUrlSyntax(current);
        if (err) throw new Error(err);
        await assertPublicHost(new URL(current).hostname);

        const res = await fetch(current, {
            redirect: 'manual',
            signal: AbortSignal.timeout(TIMEOUT_MS),
            headers: { 'User-Agent': 'WrestlingBot/2.0', Accept: 'image/*' }
        });
        if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
            current = new URL(res.headers.get('location'), current).toString();
            continue;
        }
        if (!res.ok) throw new Error(`The image host answered with error ${res.status}.`);
        const type = (res.headers.get('content-type') || '').toLowerCase();
        if (!type.startsWith('image/')) throw new Error('That link is not a picture (wrong content type).');
        if (type.includes('svg')) throw new Error('SVG images are not supported. Use PNG or JPG.');
        const len = Number(res.headers.get('content-length') || 0);
        if (len > MAX_BYTES) throw new Error('That image is too big (8 MB max).');
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > MAX_BYTES) throw new Error('That image is too big (8 MB max).');
        return buf;
    }
    throw new Error('Too many redirects.');
}

/** For submit/assign/edit: returns { ok: true } or { ok: false, error }. */
async function validateImageUrl(raw) {
    const syntax = checkUrlSyntax(raw);
    if (syntax) return { ok: false, error: syntax };
    try {
        await downloadImage(raw);
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err.message || 'Could not load that image.' };
    }
}

// Small in-memory cache so cards don't re-download art every time
const cache = new Map(); // url -> { buf, at }
const CACHE_TTL = 30 * 60 * 1000;
const CACHE_MAX = 60;

const MAX_SIDE = 900;
const UPLOAD_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/**
 * Takes a Discord attachment, checks it, downloads it right away (Discord links expire)
 * and shrinks it to a card-friendly JPEG. Returns a Buffer. Throws Error with a friendly message.
 */
async function processUpload(attachment) {
    const type = String(attachment.contentType || '').split(';')[0].toLowerCase();
    if (!UPLOAD_TYPES.has(type)) throw new Error('That file is not a PNG, JPG, WEBP or GIF picture.');
    if (attachment.size > MAX_BYTES) throw new Error('That picture is too big (8 MB max).');
    const raw = await module.exports.downloadImage(attachment.url);
    let img;
    try { img = await loadImage(raw); } catch (_) { throw new Error('I could not read that picture. Try a PNG or JPG.'); }
    const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0d0d11';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toBuffer('image/jpeg', 88);
}

/** Stores an uploaded picture for a character and returns the marker saved in characters.image_url. */
async function saveCharacterImage(characterId, buffer, client = pool) {
    await client.query(
        `INSERT INTO character_images (character_id, data, content_type) VALUES ($1, $2, 'image/jpeg')
         ON CONFLICT (character_id) DO UPDATE SET data = EXCLUDED.data, content_type = 'image/jpeg', updated_at = now()`,
        [characterId, buffer]);
    cache.delete(`db:${characterId}`);
    return `db:${characterId}`;
}

async function deleteCharacterImage(characterId, client = pool) {
    await client.query(`DELETE FROM character_images WHERE character_id = $1`, [characterId]);
    cache.delete(`db:${characterId}`);
}

/** Returns a Buffer or null (never throws). Used by the card renderer. */
async function fetchImageBuffer(url) {
    if (!url) return null;
    if (url.startsWith('db:')) {
        const hit = cache.get(url);
        if (hit && Date.now() - hit.at < CACHE_TTL) return hit.buf;
        try {
            const { rows } = await pool.query(`SELECT data FROM character_images WHERE character_id = $1`, [url.slice(3)]);
            if (!rows[0]) return null;
            if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
            cache.set(url, { buf: rows[0].data, at: Date.now() });
            return rows[0].data;
        } catch (_) { return null; }
    }
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < CACHE_TTL) return hit.buf;
    try {
        const buf = await downloadImage(url);
        if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
        cache.set(url, { buf, at: Date.now() });
        return buf;
    } catch (_) {
        return null;
    }
}

module.exports = { validateImageUrl, fetchImageBuffer, checkUrlSyntax, isPrivateIp, downloadImage, processUpload, saveCharacterImage, deleteCharacterImage };
