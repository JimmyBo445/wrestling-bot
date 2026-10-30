// Marks umbrella parts as admin-only (checked on every run) and optionally renames them.
const clip = (s) => (s.length > 100 ? `${s.slice(0, 99)}…` : s);

function adminParts(parts, rename = {}) {
    return parts.map((p) => ({
        json: { ...p.json, name: rename[p.json.name] || p.json.name, description: clip(/^\[Admin\]/i.test(p.json.description) ? p.json.description : `[Admin] ${p.json.description}`) },
        route: { ...p.route, admin: true }
    }));
}

module.exports = { adminParts };
