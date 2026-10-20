const { AttachmentBuilder } = require('discord.js');
const { pool } = require('../db/pool');

const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = v instanceof Date ? v.toISOString() : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows, cols) => '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n') + '\r\n';

async function buildBackupFiles(guildId) {
    const q = async (sql) => (await pool.query(sql, [guildId])).rows;
    const players = await q(
        `SELECT u.discord_id AS player, c.division,
                COUNT(DISTINCT mp.match_id) FILTER (WHERE m.result_type='decisive' AND mp.is_winner)::int AS wins,
                COUNT(DISTINCT mp.match_id) FILTER (WHERE m.result_type='decisive' AND NOT mp.is_winner)::int AS losses,
                COUNT(DISTINCT mp.match_id) FILTER (WHERE m.result_type='draw')::int AS draws
         FROM match_participants mp JOIN matches m ON m.id = mp.match_id JOIN users u ON u.id = mp.owner_id JOIN characters c ON c.id = mp.character_id
         WHERE m.guild_id = $1 GROUP BY u.discord_id, c.division ORDER BY u.discord_id, c.division`);
    const characters = await q(
        `SELECT c.id, c.name, c.division, c.status, u.discord_id AS owner, c.alignment, c.finisher, c.entrance_theme, c.bio, c.created_at
         FROM characters c JOIN users u ON u.id = c.owner_id WHERE c.guild_id = $1 ORDER BY c.id`);
    const matches = await q(
        `SELECT m.id, m.created_at, m.match_type, m.result_type, t.name AS title, m.stars, m.notes,
                (SELECT string_agg(c.name || ' (' || COALESCE(u.discord_id,'?') || ')' || CASE WHEN mp.is_winner THEN ' [W]' ELSE '' END, ' | ' ORDER BY mp.id)
                   FROM match_participants mp JOIN characters c ON c.id = mp.character_id LEFT JOIN users u ON u.id = mp.owner_id WHERE mp.match_id = m.id) AS participants
         FROM matches m LEFT JOIN titles t ON t.id = m.title_id WHERE m.guild_id = $1 ORDER BY m.id`);
    const reigns = await q(
        `SELECT tr.id, t.name AS title, COALESCE(tm.name, c.name, tr.reign_char_name) AS holder, tr.won_date, tr.lost_date, tr.defenses, tr.is_backfilled
         FROM title_reigns tr JOIN titles t ON t.id = tr.title_id LEFT JOIN characters c ON c.id = tr.character_id LEFT JOIN teams tm ON tm.id = tr.team_id
         WHERE tr.guild_id = $1 ORDER BY t.name, tr.won_date`);
    const teams = await q(
        `SELECT t.name, t.division, t.status, string_agg(c.name, ' & ' ORDER BY c.name) AS members FROM teams t
         LEFT JOIN team_members tm ON tm.team_id = t.id AND tm.left_at IS NULL LEFT JOIN characters c ON c.id = tm.character_id WHERE t.guild_id = $1 GROUP BY t.id ORDER BY t.name`);
    const factions = await q(
        `SELECT f.name, f.division, f.status, string_agg(c.name, ' & ' ORDER BY c.name) AS members FROM factions f
         LEFT JOIN faction_members fm ON fm.faction_id = f.id AND fm.left_at IS NULL LEFT JOIN characters c ON c.id = fm.character_id WHERE f.guild_id = $1 GROUP BY f.id ORDER BY f.name`);
    const hof = await q(
        `SELECT c.name, h.inducted_at, h.blurb FROM hall_of_fame h JOIN characters c ON c.id = h.character_id WHERE h.guild_id = $1 ORDER BY h.inducted_at`);
    const mk = (name, rows, cols) => new AttachmentBuilder(Buffer.from(toCsv(rows, cols), 'utf8'), { name });
    return [
        mk('player-records.csv', players, ['player', 'division', 'wins', 'losses', 'draws']),
        mk('characters.csv', characters, ['id', 'name', 'division', 'status', 'owner', 'alignment', 'finisher', 'entrance_theme', 'bio', 'created_at']),
        mk('matches.csv', matches, ['id', 'created_at', 'match_type', 'result_type', 'title', 'stars', 'participants', 'notes']),
        mk('title-reigns.csv', reigns, ['id', 'title', 'holder', 'won_date', 'lost_date', 'defenses', 'is_backfilled']),
        mk('teams.csv', teams, ['name', 'division', 'status', 'members']),
        mk('factions.csv', factions, ['name', 'division', 'status', 'members']),
        mk('hall-of-fame.csv', hof, ['name', 'inducted_at', 'blurb'])
    ];
}

/** DMs the backup to the user. Returns true on success, false if their DMs are closed. */
async function sendBackup(client, guildId, userId) {
    const files = await buildBackupFiles(guildId);
    const guild = client.guilds.cache.get(guildId);
    try {
        const user = await client.users.fetch(userId);
        await user.send({ content: `📦 Your wrestling bot backup${guild ? ` for **${guild.name}**` : ''}. These are spreadsheets (open them in Excel, Numbers or Google Sheets). Keep them somewhere safe.`, files });
        await pool.query(`UPDATE guilds SET backup_last = now() WHERE guild_id = $1`, [guildId]);
        return true;
    } catch (err) {
        console.error('Backup DM failed:', err.message);
        return false;
    }
}

module.exports = { buildBackupFiles, sendBackup, toCsv };
