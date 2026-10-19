# Changelog

## 2.1.0
- New **Custom Women's** division with three titles: Golden Global Kingdom, Custom Women's Air Force, and Custom Women's Tag Team.
- Each player can now have **4** characters (approved + pending).

## 2.0.0 — The big revamp

**Updates are now easier.** The bot upgrades its own database and registers its own slash commands every time it starts.
You no longer run `npm run migrate` or `npm run deploy`. Copy the new files, `git push`, done.

### New
- **Registered tag teams** (`/team ...`): named teams with their own record, streaks, profile card and championship reigns. Book the exact same wrestlers on one side of a tag match and the bot credits the team automatically. A team that holds a tag title loses it when it splits or is disbanded.
- **Undo and edit** (`/match undo`, `/match edit`, `/match recent`): undoing a title match puts the belt back exactly as it was (and brings back the #1 contender it used up). Only the newest title match for a belt can be undone, so history can't get scrambled.
- **Title and #1 contender matches in all 8 log commands**: any match type (triple threat, fatal 4-way, tag...) now has optional `title` and `contender_for` fields.
- **Win-streak title shots**: every time a wrestler or team reaches a multiple of 3 wins in a row, the bot posts a prompt with a dropdown of eligible titles. An admin picks one (or dismisses it). Change the number with `/admin set-streak-threshold`.
- **Character tools**: `/character remove`, `transfer`, `retire` (now safe), `restore`, `edit`; alignment (face/heel) and a one-line bio.
- **New cards**: redesigned match, profile and team cards, plus a belt card (`/championship belt`). Fonts are bundled.
- **Stats**: `/stats head-to-head`, `versus` (player vs player), `opponents`, `history`, and a time-period filter.
- **Leaderboard**: 10 categories and a second dropdown for the time period. **`/rankings`**: division ladders (3 points per win, 1 per draw, last 90 days).
- **Matchmaking**: smarter `/matchmaking suggest` (looks at wrestler and player history, last meeting, champions, cooldowns) and `/matchmaking request` for players.
- **Admin settings**: `/admin set-cooldown` (hours and scope), `set-matches-channel`, `set-streak-threshold`, `settings`, `audit`.
- **Championship history tools**: backfill with a character, team or typed name; `edit-reign`, `remove-reign`; overlapping reigns are rejected.

### Fixed / safer
- The singles cooldown now only applies to regular singles matches (never title, #1 contender or tag matches) and can be overridden per match.
- Typing free text in a dropdown field gives a friendly message instead of a crash.
- Title matches check the division, tag-vs-singles rules, and that the champion is actually in the match.
- Tag title reigns belong to a team (one reign per team, not one per wrestler).
- Images are checked when added (https only, real picture, size limit, no private addresses) and cached.
- Autocomplete is much faster (usernames fetched in one batch and cached).
- Every admin action is written to an audit log.
