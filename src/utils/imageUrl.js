const dns = require('dns').promises;
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

/** Returns a Buffer or null (never throws). Used by the card renderer. */
async function fetchImageBuffer(url) {
    if (!url) return null;
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

module.exports = { validateImageUrl, fetchImageBuffer, checkUrlSyntax, isPrivateIp };
