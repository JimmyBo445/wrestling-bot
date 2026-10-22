const { UserError } = require('./errors');

/** Strict YYYY-MM-DD check; returns the same string or throws a friendly error. */
function parseDate(str, label = 'Date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) throw new UserError(`${label} must look like 2026-11-21 (year-month-day).`);
    const d = new Date(`${str}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== str) throw new UserError(`${label} isn't a real date.`);
    return str;
}
const fmtYmd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

module.exports = { parseDate, fmtYmd };
