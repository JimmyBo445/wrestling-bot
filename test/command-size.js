// Discord limit: for each command, the combined length of every name, description and
// choice name/value (including all subcommands and options) must be <= 8000 characters.
const fs = require('fs'); const path = require('path');
function count(node) {
    let n = 0;
    if (!node || typeof node !== 'object') return 0;
    if (typeof node.name === 'string') n += node.name.length;
    if (typeof node.description === 'string') n += node.description.length;
    if (typeof node.value === 'string') n += node.value.length;
    for (const key of ['options', 'choices']) if (Array.isArray(node[key])) for (const c of node[key]) n += count(c);
    return n;
}
let bad = 0;
const dir = path.join(__dirname, '..', 'src', 'commands');
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const cmd = require(path.join(dir, f));
    if (!cmd.data) continue;
    const json = cmd.data.toJSON();
    const size = count(json);
    const subs = (json.options || []).filter((o) => o.type === 1).length;
    const maxOpts = Math.max(0, ...(json.options || []).map((o) => (o.options || []).length));
    console.log(`${json.name.padEnd(14)} chars=${String(size).padStart(5)}/8000  subcommands=${subs}/25  maxOptions=${maxOpts}/25`);
    if (size > 8000 || subs > 25 || maxOpts > 25) bad++;
}
if (bad) { console.log(`\n${bad} command(s) over a limit`); process.exit(1); }

// Discord rejects a command if a required option comes after an optional one, or names/descriptions are malformed.
let structural = 0;
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const cmd = require(path.join(dir, f));
    if (!cmd.data) continue;
    const json = cmd.data.toJSON();
    const walk = (node, where) => {
        const opts = node.options || [];
        let seenOptional = false;
        for (const o of opts) {
            if (!/^[\w-]{1,32}$/.test(o.name) || o.name !== o.name.toLowerCase()) { console.log(`BAD NAME ${where}/${o.name}`); structural++; }
            if (!o.description || o.description.length > 100) { console.log(`BAD DESCRIPTION ${where}/${o.name} (${o.description?.length})`); structural++; }
            if (o.type > 2) { // a normal option
                if (o.required && seenOptional) { console.log(`REQUIRED AFTER OPTIONAL ${where}/${o.name}`); structural++; }
                if (!o.required) seenOptional = true;
                for (const ch of o.choices || []) if (String(ch.name).length > 100) { console.log(`BAD CHOICE ${where}/${o.name}`); structural++; }
            } else walk(o, `${where}/${o.name}`);
        }
    };
    walk(json, json.name);
}
if (structural) { console.log(`${structural} structural problem(s)`); process.exit(1); }
console.log('structure ok (option order, names, descriptions)');
