# Wrestling Bot 2.0

A Discord bot for running a fantasy wrestling promotion: characters, matches, tag teams,
#1 contenders, 10 championship titles, stats, rankings and visual cards. Works in many
servers at once. Everything is saved permanently in Postgres.

## What it does

| Area | Commands |
|---|---|
| **Characters** | `/character submit` `assign` `list` `profile` `edit` `retire` `restore` `remove` `transfer` |
| **Tag teams** | `/team create` `list` `profile` `add-member` `remove-member` `rename` `disband` |
| **Matches** (admins) | `/match log-singles` `log-tag2v2` `log-tag3v3` `log-triple-threat` `log-fatal4way` `log-fiveway` `log-sixman` `log-eightman`, plus `undo` `edit` `recent` |
| **Championships** | `/championship list` `belt` `history` `log-singles-title-match` `log-tag-title-match` `vacate` `backfill-reign` `edit-reign` `remove-reign` |
| **#1 contenders** | `/contender challenge` `award` `revoke` `list` |
| **Stats** | `/stats character` `user` `head-to-head` `versus` `opponents` `history` |
| **Boards** | `/leaderboard` (category + time period dropdowns), `/rankings` |
| **Matchmaking** | `/matchmaking suggest` `request` |
| **Admin** | `/admin pending` `set-pending-channel` `set-matches-channel` `set-cooldown` `set-streak-threshold` `settings` `audit` |

### How the rules work
- **Characters**: max 3 per player (approved + pending). Players submit, admins approve (`/admin pending` or the buttons in the approval channel). Admins can assign directly.
- **Matches** are logged by admins (no randomness). Singles, tag 2v2/3v3, triple threat, fatal 4-way, 5-way, 6-man (3v3) and 8-man (4v4). Draws and no contests are allowed and don't break a streak.
- **Title match**: add the `title` option to any log command (or use the two `/championship log-...` commands). The bot checks the division, that the champion is in the match, and updates the reign (new champion, defense, or vacant title won). Draws/no contests leave the belt where it is.
- **#1 contender match**: add `contender_for`. The winner becomes #1 contender. A contender's shot is used up when they take part in a title match for that belt.
- **Registered teams**: tag titles belong to registered teams. When the exact wrestlers of a team are booked on one side of a tag match, the match counts for the team. Removing a member or disbanding a team that holds a belt vacates it.
- **Cooldown**: only regular singles matches (not title, contender or tag). Default 24 hours between the same two players; change with `/admin set-cooldown`, or override one booking with `override_cooldown: true`.
- **Win streaks**: at every multiple of the streak threshold (default 3), a prompt appears for admins to pick the title. Win streaks for registered teams use the tag titles.
- **Undo**: `/match undo` deletes a match and reverses what it did. For title matches only the newest title match for that belt can be undone.

## Setup (first time)

1. **Discord**: https://discord.com/developers/applications → New Application. Bot tab: copy the token (`DISCORD_TOKEN`) and turn on **Server Members Intent**. General Information: copy the Application ID (`CLIENT_ID`). OAuth2 → URL Generator: scopes `bot` + `applications.commands`; permissions Send Messages, Embed Links, Attach Files, Read Message History → open the link to add the bot to your server.
2. **GitHub**: put this folder in a GitHub repository. The included `.gitignore` keeps your secrets and `node_modules` out.
3. **Railway**: New Project → Deploy from GitHub repo. Add a **PostgreSQL** service. On the bot service, Variables: `DISCORD_TOKEN`, `CLIENT_ID`, and `DATABASE_URL` = a Reference to the Postgres service's `DATABASE_URL`.
4. That's it. On startup the bot creates/updates its own tables and registers its slash commands.
5. In Discord: `/admin set-pending-channel` (where approval requests and win-streak prompts appear) and optionally `/admin set-matches-channel`.

## Updating later
See `UPDATE-GUIDE.md`. In short: copy the new files over the old folder, then `git add .`, `git commit`, `git push`. Railway redeploys and the bot upgrades itself.

## Settings (environment variables)
| Variable | Needed | What |
|---|---|---|
| `DISCORD_TOKEN` | yes | Bot token |
| `CLIENT_ID` | recommended | Application ID (falls back to the bot's own ID) |
| `DATABASE_URL` | yes | Postgres address |
| `GUILD_ID` | no | Your server ID: slash-command changes appear instantly in that server |
| `AUTO_DEPLOY_COMMANDS` | no | `false` stops registering commands at startup |
| `DATABASE_SSL` | no | `false` if the database refuses SSL |

## Manual fallbacks
`npm run migrate` applies database upgrades by hand; `npm run deploy` registers slash commands by hand. Both need `DATABASE_URL`/`DISCORD_TOKEN` in a local `.env` (use the database's **public** address on your own computer). You normally never need them.

## Title catalogue
Men's: World Heavyweight, United States, Intercontinental, Men's Tag Team. Women's: Women's World, Women's Intercontinental, Women's Tag Team. Custom: Prime Time Universal, Showtime, Customs Tag Team.
