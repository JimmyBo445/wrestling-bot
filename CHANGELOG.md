# Changelog

## 2.19.0 — /whois and a text roster
- **`/whois character:`** (anyone can use it): who plays that wrestler, and a list of all that player's wrestlers with division, record (with this player), current belts 🏆 and team. Retired wrestlers are listed last. An unclaimed wrestler says nobody plays them right now.
- **`/whois player:@someone`**: the same list for a player.
- **`/directory list`**: the whole roster as text, no pictures. Each division A to Z with the player behind every wrestler, 🏆 for current champions and their team. Options: `division` (just one), `sort: Grouped by player` (one line per player with all their wrestlers) and `include_retired`. Big rosters are split over several messages. Nobody is pinged.
- `/directory roster` (the profile pictures) is unchanged.
- The bot now has 18 commands. No database change.

## 2.18.0 — Old reigns can be linked to the character who held the belt
- The title history file for **`/admin import what:Title history`** has a new optional **`character`** column: the wrestler who held the belt (for a tag title, the wrestlers joined with `&`, e.g. `Liv Morgan & Kai Storm`).
- A linked reign counts on that **character's** profile (title reigns, defenses, current belts), and the **player** in `members` keeps the credit, even if the character belongs to someone else now.
- **Fill characters in over time.** Import the same file again after typing in more characters: reigns already in the bot that have no character yet get it linked. Nothing else about them changes, and reigns that already have a character are left alone.
- A character the bot doesn't know (or a name two wrestlers share) is listed in the preview; that reign is still added, just without a character.
- The history channel still groups reigns by player and now names the character on each reign, e.g. `*1st Reign - 1 Defense* · Ace Blackout`. Tag reigns show the players and then the characters.
- `/reign edit character:` also links a character to one reign at a time.
- No database change.

## 2.17.0 — Championship history channel and title history import
- **`/admin history channel:#your-channel`** posts the full history of every title in that channel, in the same style as a hand-written history post: `3x @player`, `1st Reign - 2 Defenses`, `4/1/23-5/23/23`, with team names and their members for tag titles. Holders are grouped by player (or by team name), in order of their first reign.
- **It keeps itself up to date.** A few seconds after any title change (a title match, `/title vacate`, `/reign add/edit/remove`, a defense, an import), the bot edits its own messages. Several changes in a row become one update. Nobody is pinged.
- **`/admin history auto:off`** stops the automatic updates; then it only changes when you run **`/admin history`** (run it with nothing filled in to update right away). `auto:on` turns them back on. `/admin settings` shows the channel and the mode.
- **`/admin import what:Title history`** loads old reigns from a CSV: `title, holder, won, lost` plus optional `members` (the Discord IDs that get player credit), `defenses` and `notes`. Dates like `4/1/23` or `2023-04-01`; leave `lost` empty for the current champion. It shows a preview first and only saves with `apply:true`.
- The import never changes or removes anything already in the bot. A line that overlaps a reign already there is skipped and listed, and importing the same file twice adds nothing the second time.
- `/admin import-template` now also gives an example title history file.
- Database change: migration 017 (a history channel setting and a small table of the bot's history messages). Nothing existing changes.

## 2.16.0 — Players get credit for title reigns
- Every title reign now remembers the **player** who owned the wrestler at the time, not just the character. If the character is transferred later, the old owner keeps the credit and the new owner earns their own from then on. Tag reigns credit both players. Unclaimed wrestlers earn no player credit.
- **`/stats user`** (picture and text) shows the player's title reigns, days as champion, defenses and the belts they hold now.
- **`/stats champions`** (new): players ranked by title reigns.
- **`/championship history`** shows "played by @player" on each reign.
- Existing reigns are credited to whoever owns the wrestler today (the best the bot can know). Fix any with `/reign edit`. Database change: migration 016.

## 2.15.0 — Record results from the show card
- In `/card view`, pick a match and press **🎬 Record result**, then press the winner (one button per wrestler, or per team), **Draw** or **No contest**. The match is logged just like `/match log`: records, titles, streaks and the card slot are updated.
- The **result picture is posted in your match results channel** (or where you pressed the button if none is set). When it was the last match on the card, the usual wrap-up recap follows.
- Cooldowns are skipped for booked card matches. Add a finish, score or notes afterwards with `/match edit`. Undo with `/match undo`. Admins only. No database change.

## 2.14.0 — Championship revamp and belt pictures
- **Three commands instead of one big menu.** `/championship` is now just for looking (list, belt, panel, lineage, defenses, history, grand-slam, rematches, contender-list, contender-challenge). Admins run belts with **`/title`** and fix the record with **`/reign`**.
- **`/title match`**: pick the title, the challenger and who won. The bot fills in the current champion (for a vacant title, also fill in `opponent`). Works for singles and for 2v2 tag titles (pick a team). Stipulation, finish, score and notes are optional. The old two `log-...-title-match` commands are gone.
- **`/title`** also has `belt-image`, `vacate`, `interim`, `unify`, `watch`, `waive-rematch`, `contender-award` and `contender-revoke`.
- **`/title belt-image title picture`** uploads your own belt art for a title (`remove:true` goes back to the drawn belt). The champion's round picture(s) and name are placed on the belt, with owner and stats under it.
- **Contender and rematch** now show on the belt card (a #1 contender chip, and a rematch owed with its deadline).
- **`/championship panel`**: the belt card with buttons. Everyone gets History, Defenses and Lineage. Admins also get Log match (pick the challenger from a dropdown, paged past 25, then who won), Set contender, Clear contender and Vacate (asks to confirm).
- **`/reign`**: `add` (an old reign with dates, a defenses count and notes), `edit`, `remove`, `add-defense` and `remove-defense` (a defense you type in by hand, with opponent, optional date and notes). Hand-entered defenses show in `/championship defenses` and add to the count.
- Database change: migration 015 (`title_images`, `reign_defenses`). The bot now has 17 commands.

## 2.13.0 — One show card per brand
- **One card per brand.** RAW and SmackDown each have a single show card instead of one per division. You never choose a division when adding a match: it comes from the wrestlers (a match can't mix divisions). Numbering restarts in each division and a division holds up to 15 matches (60 per show).
- **`/card post`** posts the card as one message per division, in the order Men's, Women's, Custom, Custom Women's (divisions with no matches are skipped). Under each picture it lists who is in each match and **pings the owners**, e.g. `@Ann (Ace) vs @Bo (Bolt)`, 🏆 title matches marked. Optional `division` posts just one; tale of the tape pictures are now opt-in with `tapes:true`.
- **`/card view`** shows the whole card with buttons: **Preview** (the real pictures, only you see them, nobody is pinged), **Post here**, and a dropdown to pick a match, then **Up / Down / Edit / Remove**. Edit swaps a wrestler from a dropdown of free, healthy wrestlers in that division (with Previous/Next pages past 25) and sets the title and stipulation from dropdowns.
- **`/card edit`** (new): swap one wrestler (`swap_out` / `swap_in`) and change the title or stipulation without removing the match. `-` clears a title or stipulation.
- **`/card auto`** books every division at once (`matches` is per division, default 3). Divisions that can't be booked (for example too few signed up) are skipped and listed.
- `/card remove`, `move`, `tape` and the optional `division` of `clear`/`recap`/`post` take the division plus the number.
- The show name and date belong to the whole card. `/card schedule` takes just the brand; the staff reminder and the newsletter list one entry per show.
- The automatic recap waits until every match on the whole card is logged, then posts one results picture per division and one written recap. `/card vote` covers all divisions.
- Your existing per-division cards are kept and show up as one card per brand when you install. Database change: migration 014.

## 2.12.0 — /character unclaim
- **`/character unclaim`** (admin) takes a character off its player. The character stays in the roster with no owner (shown as "Unclaimed"), keeping its name, picture, story and history. Give it to someone later with `/character transfer`.
- The old owner **keeps their wins and losses**; the new owner starts at 0-0 with the character.
- If the wrestler is a champion, on a team, in a signup, under contract or in a tournament, the bot lists what will happen and asks you to confirm with a button. Teams, signups and contracts are cleared (a team that drops below 2 members is disbanded and its tag titles become vacant). Singles titles stay on the character.
- Unclaimed wrestlers can't be booked in matches, cards, signups or tournaments, and `/card auto` and `/booking suggest` skip them.
- **`/character swap-division`** (admin) moves a wrestler to another division with their record and history. If they hold a title, are on a team, in a signup, a tournament or are #1 contender, the bot lists what will be cleared and asks you to confirm with a button.
- **Duplicate names are blocked.** `/character submit`, `assign` and `edit` refuse a name that already exists in the server (ignoring capitals, spaces, punctuation, accents and a leading "The"), and tell you who owns the existing one. Retired characters count, so you are pointed to `/character restore`. Denied characters don't count.
- New database change: migration 013 (one small column). Nothing existing changes.

## 2.11.0 — Old command names removed, stricter signups
- **The old separate commands are gone** (their features all live in the combined commands from 2.10): `/leaderboard` `/rankings` `/season` → `/standings`; `/roster` `/halloffame` `/injury` → `/directory`; `/matchmaking` `/signup` → `/booking`; `/contender` → `/championship contender-…`; `/newsletter` `/report` → `/admin newsletter …` and `/admin report`. 15 commands are left. `/help command:injury` (etc.) tells you where each one went. No data changed.
- **Signups are strict.** The newest signup guides booking from the moment it opens until you run **`/booking signup-done`** (or open a new signup). There is no 7-day timer, and closing a signup does not end it.
  - `/card auto` books **only** signed-up, healthy wrestlers. It books fewer matches if it has to, tells you how many it could build, and refuses if fewer than 2 signed up in that division. It never quietly pulls in everyone.
  - `/booking suggest` only suggests signed-up wrestlers. `include_everyone:true` ignores the signup; `/card auto use_signup:false` does the same for a card.
  - Opening a new signup finishes the old one. A signup with nobody in it books nobody.
  - The weekly staff report reminds you when a closed signup is still guiding booking.

## 2.10.0 — Tidier commands
Some commands now live together. **Nothing was removed and no data changed**: every old command still works exactly as before, so you can switch over at your own pace.
- **`/standings`** = `leaderboard`, `rankings`, `season-standings`, `season-recap`.
- **`/directory`** = `roster`, `hof-induct` `hof-remove` `hof-list` `hof-view` (Hall of Fame), `injury-add` `injury-clear` `injury-list`.
- **`/booking`** = `suggest`, `request` (matchmaking) and `signup-open` `signup-list` `signup-close` `signup-add` `signup-remove` (admins).
- **`/championship contender-challenge` `contender-award` `contender-revoke` `contender-list`** replace `/contender`.
- **`/admin newsletter add|list|remove|preview|post`** and **`/admin report`** replace `/newsletter` and `/report`.
- Admin-only parts stay admin-only wherever you find them. `/help` shows the combined commands and explains where an old name moved (`/help command:injury`).
- When you're happy, ask me to remove the old names and the list drops from 26 commands to 15.

## 2.9.0 — Show recaps, staff reports and contracts
- **Show recaps.** When the last match of a card is logged, the bot posts "That's a wrap!" with a written recap and the results picture (to your matches channel, or where you logged it). Each match gets a sentence: who won, how, the stipulation, title changes, defenses, and "their 3rd meeting, X leads the series 2-1". `/card recap` now includes the written version too. `/card auto-recap enabled:false` turns the automatic post off.
- **Weekly staff report.** Every Monday morning the staff channel gets idle wrestlers (30+ days), the busiest ones, thin divisions, titles that haven't been defended or are vacant, wrestlers passed over on signups, contracts ending soon and things waiting for you. `/report now` shows it any time (admins).
- **Contracts (just for fun).** `/contract offer` (admin) sets months, monthly pay and optional clauses; the wrestler's owner presses **Accept & sign** and the bot posts a signed contract graphic. Owners can ask for a new deal with `/contract request` and an admin approves with a button. `/contract view`, `list`, `free-agents`, `release`. Not everyone needs a contract and contracts never affect booking. Profiles show "Contract through ...".
- **Earnings.** Wrestlers under contract earn their monthly pay for the days they are signed, plus a bonus per win and an extra bonus per title-match win (`/contract bonuses`, defaults $500 and $2,000). `/contract earnings` is the career-earnings leaderboard. It is worked out from the matches, so undoing a match corrects it.
- **Warnings.** The staff channel is told 14 days before a contract ends and when it expires. Expired contracts only show as expired.
- Database: migration 012 runs by itself.

## 2.8.0 — Show signups
- **`/signup open`** posts a signup (title, optional deadline date, optional channel) with a **Sign up / change** button and a **Withdraw** button. Players pick any of their approved wrestlers from a private menu (every division at once, as many as they like) and can change their picks until it closes. The post shows who is in each division. Injured wrestlers aren't offered.
- **`/signup list`** (admins) shows who is available by division with records, champions and how many earlier shows they were passed over for. **`/signup add`** and **`remove`** let you sign someone up or take them off. **`/signup close`** locks it and sends the final list to the staff channel; a deadline closes it by itself after that day.
- **Matchmaking uses it.** `/matchmaking suggest` lists signed-up wrestlers first (📝) and wrestlers who were passed over before (⏭️); add `only_signed_up:true` to show only them. `/card auto` books from the signup (falls back to everyone, and says so, if fewer than 2 signed up in that division); `use_signup:false` ignores it. A signup counts for a week after it closes.
- **Passed over:** a wrestler who signed up for shows but hasn't wrestled since is moved up in booking until they get a match.
- Database: migration 011 runs by itself.

## 2.7.0 — Booking depth: stipulations, rematches, calendar, tournaments and more
- **Fix any reign, even ones the bot logged.** `/championship edit-reign` now works on every reign: won/lost dates, defenses, notes, the champion (wrestler, team or typed name) and an interim flag. `/championship remove-reign` also works on bot-logged reigns. The overlap check still stops two champions at once.
- **Stipulations, finishes and scores.** Every `/match log-...` and both `/championship log-...-title-match` commands take `stipulation` (pick Ladder, Hell in a Cell, Last Man Standing, Iron Man, Steel Cage... or type your own), `finish` (pinfall, submission, DQ, count-out, knockout, interference, escape, forfeit) and `score` (like 3-2 for Iron Man). They show on the result graphic. A stipulation planned on a `/card` carries over when you log the match. `/stats character` shows a record per stipulation and wins by finish. `/match edit` can change them later.
- **Rematch clause.** When a champion loses the belt they are owed a rematch (default 30 days). The result says so, `/championship rematches` lists who is owed one, the staff channel gets a reminder 3 days before it runs out, and it is ticked off when they get the match. `/admin rematches` turns it on/off and sets the days; `/championship waive-rematch` cancels one.
- **Title deadlines.** `/admin deadlines` warns staff when a belt has gone N days without a defense (once a week per belt) and can auto-vacate a belt when the champion has not wrestled at all for N days. `/championship watch` shows the days for every title.
- **Interim champions.** `/championship interim` crowns one (the old reign is ended and noted); `/championship unify` makes the real champion undisputed. Interim reigns are labelled everywhere.
- **Staff channel + booking calendar.** `/admin set-admin-channel` picks a private staff channel. `/card schedule` gives a card a show date, `/card upcoming` lists them, and from noon on show day the bot posts "Tonight's card" with the picture in the staff channel. `/admin set-timezone` makes dates and times follow your time zone.
- **Match of the Night vote.** `/card vote` posts a poll with a button per match logged from that card (one vote each, changeable). `/card vote-close` announces the winner; winners earn a profile badge.
- **Character depth (all optional).** `/character story` adds signature moves, a catchphrase, a finisher and a long story. Moves and catchphrase show on the profile card; a **Story & moves** button opens the full story page.
- **Badges, grand slam and career timeline.** Profile cards show achievement badges (undefeated, win milestones, hot streaks, multi-time champion, five-star classic, match of the night, tournament winner, grand slam). `/stats badges` lists them. `/championship grand-slam` shows who has held every title in a division. `/stats timeline` draws a career timeline picture.
- **Feuds.** `/feud start` `log` `view` `list` `heat` `end`: a storyline timeline per rivalry (your notes plus every match between the two) with a record and a heat meter that rises with recent matches and storyline moments and cools down over time.
- **Tournaments.** `/tournament create` `add` `start` `bracket` `advance` `cancel`: 4 to 16 singles wrestlers, random draw with byes, a bracket picture, and the bracket advances by itself when you log the match with `/match log-singles`. Optionally the winner is crowned champion of a title.
- **Weekly newsletter.** `/admin set-newsletter-channel` and the bot posts every Monday morning: championship news, stars of the week, match of the week, hottest feuds, upcoming cards, injuries, and your own lines. `/newsletter add` `list` `remove` `preview` `post`.
- **Bulk import.** `/admin import` brings in characters or past singles results from a CSV file, with a preview first (nothing saved until you add `apply:true`). `/admin import-template` sends example files.
- Database: migration 010 runs by itself.

## 2.6.0 — Pictures, rankings graphic, injuries, seasons
- **Easy picture upload.** Attach an image when you use `/character submit`, `assign` or `edit` (the new **picture** option), or use the new `/character picture` command. No link needed. The picture is saved inside the bot's database, so it never expires. Links still work too. Owners can change their own wrestler's picture; admins can change anyone's.
- **`/rankings` is now a picture**: the top 10 of a division with portraits, points, records, and CHAMPION / #1 CONTENDER tags. The dropdown still switches divisions.
- **`/stats user` is now a player card picture**: overall record, a record for each division, streaks, and all of the player's wrestlers (former ones are marked). Add `text:true` for the old text version.
- **Belt cards show the last 3 champions** with how long each held it.
- **Injuries** (`/injury add` `clear` `list`): a wrestler is out until a return date. Auto cards skip them, `/match` and `/card add` warn when you book them anyway, their profile shows an INJURED badge, and the bot posts in your matches channel when they are back.
- **Seasons** (`/season recap` and `/season standings`): a calendar-year view with top wrestlers and players, who held each title at the end of the year, and match of the year. Nothing is ever reset. If a Wrestler of the Month channel is set, the bot also posts last year's recap in January.
- Database: migrations 008 and 009 run by themselves.

## 2.5.1
- **`/roster division:`**: flip through every wrestler in a division, A to Z, as full profile cards with picture. **◀ Prev** and **Next ▶** buttons (it loops from Z back to A). Only the person who opened it can press the buttons, so two people can browse at once. Add `include_retired:true` to include retired wrestlers.

## 2.5.0 — Player records, factions and more
- **Records now follow the player.** Every match remembers who owned each wrestler at the time. `/stats user` shows a player's overall record plus one for each division (Men's, Women's, Custom, Custom Women's). Switching characters, or leaving and rejoining the server, never resets it. If a character is transferred, the old player keeps what they earned and the new player starts at 0-0 with it. A character's page shows the current owner's record, and "All owners" when it has changed hands. Old matches are credited to each character's current owner.
- **Factions** (`/faction`): groups of 3 to 8 wrestlers with a shared record and a graphic. Separate from tag teams: a wrestler can be in both, but only one faction.
- **Hall of Fame** (`/halloffame`): induct legends with a gold graphic showing their career.
- **Star ratings**: admins rate matches 1 to 5 stars with `/match rate`.
- **Wrestler of the Month**: posts on its own each month (set the channel with `/admin set-monthly-channel`) with the top wrestler, match of the month (from star ratings) and hottest rivalries. `/admin monthly-awards` posts it on demand. `/stats rivalries` shows the hottest rivalries any time.
- **Milestone shout-outs**: every 5th win in a row, big career win numbers, and "3-time champion" announcements appear with the match result. Turn off with `/admin milestones`.
- **Weekly backup**: `/admin backup action:Turn on` sends you spreadsheets (CSV files) of all records by DM every week. "Send one now" works too.
- **`/card request`**: put an approved player match request on a card.
- Database: migrations 006 and 007 run by themselves.

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
