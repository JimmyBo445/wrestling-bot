# Wrestling Bot

A Discord bot for booking and tracking a fantasy wrestling promotion: characters,
matches, #1 contender status, and 9 championship titles across Men's, Women's,
and Customs divisions. Multi-server, fully persistent Postgres storage.

## ⚠️ Two assumptions I made — please confirm

1. **6-Man and 8-Man matches are team-based (3v3 / 4v4 tag), not free-for-all
   battle royals.** This matches standard wrestling terminology. If you meant
   these as free-for-all with a single winner instead, tell me and I'll flip
   `winnerMode` from `'team'` to `'single'` for those two entries in
   `src/commands/match.js` — it's a one-line-per-type change.
2. **Win-streak #1 contender status is a nudge, not an auto-assignment.**
   When a character hits a 3-win streak, the bot posts a notice suggesting
   `/contender award` — it does NOT automatically pick a title, since men's
   and women's divisions each have multiple non-tag titles and the bot can't
   know which one you want to put on the line. Change the threshold in
   `src/utils/contenderLogic.js` (`WIN_STREAK_THRESHOLD`).

## Setup

### 1. Discord Application
1. Go to https://discord.com/developers/applications → New Application
2. Bot tab → Reset Token → copy it → this is `DISCORD_TOKEN`
3. Under **Bot**, enable the **Server Members Intent** (needed for autocomplete
   to show usernames)
4. General Information tab → copy the **Application ID** → this is `CLIENT_ID`
5. OAuth2 → URL Generator → scopes: `bot`, `applications.commands` →
   bot permissions: Send Messages, Embed Links, Attach Files, Use External
   Emojis, Manage Messages (for editing pending cards) → open the generated
   URL to invite the bot to your server(s)

### 2. Local setup (optional, for testing before deploying)
```bash
npm install
cp .env.example .env
# fill in DISCORD_TOKEN, CLIENT_ID, and a local DATABASE_URL
npm run migrate       # creates all tables
npm run deploy        # registers slash commands (set GUILD_ID in .env for instant testing)
npm start
```

### 3. Deploy to Railway
1. Push this project to a GitHub repo
2. Railway → New Project → Deploy from GitHub repo
3. Add a **PostgreSQL** plugin to the project (Railway auto-sets `DATABASE_URL`
   on your bot service — you don't need to copy/paste it)
4. In your bot service's Variables tab, add `DISCORD_TOKEN` and `CLIENT_ID`
   (and `GUILD_ID` only if you want single-server instant command deploys)
5. Railway will run `npm start` automatically per `railway.json`
6. Run the migration once, either by temporarily setting the service's start
   command to `npm run migrate` and redeploying, or by running it locally
   against the Railway Postgres connection string (Railway dashboard →
   Postgres plugin → Connect → copy the external connection URL into your
   local `.env` temporarily and run `npm run migrate`)
7. Run `npm run deploy` once (locally, pointed at the same `CLIENT_ID`/token)
   to register the slash commands — you only need to re-run this when you
   add/change commands, not on every deploy

### Fonts (important — see `assets/fonts/README.md`)
Railway's base image often has no system fonts, which can make the generated
match/profile card images render with blank text. Drop a `.ttf` into
`assets/fonts/Inter-Bold.ttf` before deploying — see that folder's README.

### First-run per server
The bot auto-creates a `guilds` row and seeds all 9 titles the moment it joins
a server (or the moment any command runs there if it was already a member).
Nothing to do manually except optionally:
```
/admin set-pending-channel #wherever-you-want-approvals-posted
```
If you skip this, submissions/challenges still queue up — admins just review
them via `/admin pending` instead of getting a live-posted card.

## Command Reference

### Characters
- `/character submit name division [image_url]` — user submits, needs approval
- `/character assign user name division [image_url]` — admin, auto-approved
- `/character list [user]`
- `/character profile character` — renders a visual stat card
- `/character retire character` — admin

### Matches (all admin/mod-only — this is the "admin approves matches" requirement)
- `/match log-singles p1 p2 winner [result_type] [notes]`
- `/match log-tag2v2` / `log-tag3v3` — 2v2 / 3v3 tag, pick winning team
- `/match log-triple-threat` / `log-fatal4way` / `log-fiveway` — FFA, pick winner
- `/match log-sixman` / `log-eightman` — 3v3 / 4v4 tag by default (see assumption #1)
- Regular singles matches have a 24h cooldown against an immediate rematch
  between the same two characters. Title matches, contender matches, and tag
  matches are exempt. Change `SINGLES_COOLDOWN_HOURS` in `constants.js`.

### #1 Contenders
- `/contender challenge character title` — user requests, queues for approval
- `/contender award character title` — admin, instant
- `/contender list [title]`
- One active contender per title max; a new award/approval auto-revokes the
  previous one for that title.

### Championships
- `/championship list` — all 9 titles by division with current holder
- `/championship log-singles-title-match` — champion vs challenger, auto
  updates reign (increments defenses on a successful defense, starts a new
  reign on a title change)
- `/championship log-tag-title-match` — 2v2 tag title defense/change
- `/championship vacate title`
- `/championship history title` — last 20 reigns
- `/championship backfill-reign title champion_name won_date [lost_date] [defenses]`
  — add pre-bot history; use free-text names if the champion predates any
  character records

### Stats & Leaderboard
- `/stats character character` — record, streaks, by-match-type breakdown
- `/stats user [user]` — aggregate across all their characters
- `/leaderboard` — one command, dropdown to switch between Win %, Total Wins,
  Current Streaks, Longest Streak Ever, Most Title Reigns, Most Active

### Matchmaking
- `/matchmaking suggest character [count]` — ranks other characters by fewest
  prior matches against this one, so you can keep pairings fresh

### Admin
- `/admin pending` — review queued character submissions & title challenges
  with Approve/Deny buttons, even without a configured channel
- `/admin set-pending-channel #channel` — auto-post new requests live

## Project Structure
```
src/
  commands/        one file per slash command
  db/              schema.sql, connection pool, migration runner
  handlers/         button/select-menu interaction routing, pending queue
  utils/            shared helpers: character lookups, streaks, card
                    rendering, leaderboard queries, constants
  index.js         bot entrypoint
  deploy-commands.js  registers slash commands with Discord
```

## Notes on data model choices
- **Per-character-per-user stats**: since two users could each have a
  character with the same name, all stats key off the internal `characters.id`,
  never the name string.
- **Multi-guild**: every table is scoped by `guild_id`, including titles —
  so each server gets its own independent set of 9 championships and its own
  roster, even though they share one bot process and one database.
- **No RNG**: match outcomes are 100% admin-logged; the bot never decides winners.
