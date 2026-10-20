# Changelog

## 2.4.0 — Results, tapes and title history
- **Results follow the card.** When you log a match with `/match` that was booked on a RAW/SmackDown card, the slot is ticked off (✅) automatically and the result graphic gets the brand colour, show name and match number. Undoing the match un-ticks the slot. Nothing to do differently, just use `/match` as usual.
- **`/card recap`**: after the show, one graphic with every result. Winners are ringed in gold, unlogged matches show PENDING. Can post to another channel.
- **Tale of the tape**: `/stats tape` for any two wrestlers, `/card tape number:` for a slot, and `/card post` now attaches a tape to each title match automatically (turn off with `tapes:false`).
- **`/championship lineage`**: a timeline graphic of every champion of a title with reign lengths and defenses.
- **`/championship defenses`**: a champion's defense log (who they beat and when). Result graphics now say "(3rd defense)".
- Database: migration 005 (adds a link from card slots to logged matches). Runs by itself.

## 2.3.1
- Show cards (`/card view`, `/card post`) now list each wrestler's player (`@name`) under the wrestler's name, like the match and profile cards already did. Rows are a little taller to fit it.

## 2.3.0
- **`/help`**: lists every command with what it does. `/help command:match` shows all the subcommands of one command. Players only see what they can use; admins see everything (🔒 marks admin-only). It builds its list from the real commands, so it never goes out of date.
- **Server name on the cards**: your Discord server's name now appears small on the match, profile, team, belt and show cards ("<server> presents" on RAW / SmackDown cards). Nothing else about the cards changed.

## 2.2.0 — Match cards
- **`/card`: match card maker** (admins). Build a RAW (red) or SmackDown (blue) card for any division with up to **10 matches** and pick exactly who is in each one.
  Commands: `/card new` `add` `remove` `move` `view` `post` `clear`. Every match type works (singles, tag, triple threat, fatal 4-way, 5-way, 6-man, 8-man),
  with an optional title (championship matches get a gold frame) and a stipulation like "No DQ". A registered team's name shows above its members. Post it here or in another channel as one picture.
- **`/card auto`: card generator**. Books a card from recent matches: champion vs #1 contender (or a good recent winner) for title matches, rematches of recent results
  (tagged "Rematch", or "Rivalry" if they've met 2+ times lately), and fresh matchups for everyone else, favouring people who've faced each other least and players who haven't just fought.
  Title matches close the show. The result is a normal draft, so you can tweak it with `/card add`, `remove` and `move` before posting.
- **Finisher and entrance theme** on characters: new options on `/character submit`, `assign` and `edit`, shown on the profile card.
- The card is only a plan: nothing is logged and no stats change until you log the match with `/match`.

## 2.1.0
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
