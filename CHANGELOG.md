# Changelog

## 3.10.2 — Fix: wrestler lists past page 1
- Any wrestler list with more than 25 wrestlers (Stats, Suggest opponents, signups, etc.) broke on **page 2**: Discord refused it with "Component custom id cannot be duplicated", because the ◀ button and the "All" tab had the same hidden id. Fixed.
- The checkup (`npm run checkup`) now builds a roster of almost 100 wrestlers, so every list gets a page 2 and 3. It finds this kind of problem by itself now (it reported 37 places before the fix and none after).

## 3.10.1 — Checkup
A new checkup tool (`npm run checkup`, file `test/crawl.js`) builds a league that looks like a real one (12 wrestlers in every division, teams, a faction, title history, both cards, a signup, requests, a reported result, a feud, a tournament, contracts, Legacy, a vote, an injury, the Hall of Fame, the menu post) and then presses every button, menu and form it can reach from every command, as staff, as a player and as a brand-new member. It checks for errors, buttons that lead nowhere, and messages Discord would refuse (too long, too many buttons, repeated button ids, broken menus). About 2,300 presses per run.
Fixed what it found:
- **🏅 Grand slam** and **🔁 Rematches owed** buttons on `/championship` told players "only staff". Everyone can see them now.
- **🆚 Compare players** (`/stats player:`) could fail to show the names.
- On a vote where only staff nominate, the button now says so right away instead of after picking a wrestler.
- A few old hints still named removed commands (result footer, roster footer, Legacy footer, rules footer).

## 3.10.0 — Menu post, My requests, bot usage
- **📌 Menu post** (`/admin panel` → 📌 Menu post → pick a channel): one post with big buttons for everyone — 🆕 Make a wrestler, 🙋 My wrestlers, 📝 Report a result, 📨 My requests, 🏆 Champions, 📅 Next show, 📰 Results, 📋 Roster, 📊 Stats, 📈 Standings, 🎖 Legacy, ❓ Help. Every button answers only the person who pressed it. It **stays at the bottom**: about 10 seconds after anyone posts in that channel, the bot moves it back down. If it's deleted (or went missing while the bot was offline), it comes back. 🔄 Post it again, 🔕 Turn it off and 👁 Preview buttons too.
- **🆕 Make a wrestler** from the menu: pick a division, fill a short form, it goes to staff like `/character submit` (picture by link; file uploads still need `/character submit`).
- **📨 My requests** (menu post, or 🙋 My Wrestlers): new wrestlers and claims, match requests (and whether they're on a card), title challenges and reported results, each with its status. Waiting ones always show; finished ones for 30 days. **✖ Cancel** a waiting one: its staff card says "Cancelled by …" and loses its buttons, so staff can't approve it by accident. A cancelled new wrestler is marked denied.
- **📈 Bot usage** (`/admin panel` → 📈 Bot usage, 7 / 30 / 90 days, and a section in the Monday staff report): uses per command, button screen and menu button, with how many different people. It also lists commands nobody used. Counts only, it never shows who used what. Kept for about four months.
- The bot now asks Discord to tell it when messages are posted (so the menu can move down). It never reads what people write.
- Database change: migration 025. Still 18 commands.

## 3.9.0 — Every other command is mostly buttons too
| Command | What you type now | What became buttons |
|---|---|---|
| `/character` | `submit` · `profile` · `picture` · `assign` (staff) | Edit and story: `/fnlw` → 🙋 My Wrestlers. Retire, restore, move division, transfer, unclaim, delete: 🛠 Staff on a wrestler (`/whois`) |
| `/stats` | `/stats wrestler:` or `/stats player:` | All the stats tabs; a player's card has a 🆚 menu to compare with another player. Most decorated and rivalries are tabs in `/standings` |
| `/standings` | `/standings board:` (optional) | Power, leaderboards, rankings, season, rivalries tabs |
| `/legacy` | `/legacy`, `/legacy wrestler:` or `player:` | Staff: 🎖 Give accolade, 🗑 Take back (on a wrestler), 🗳 Open a vote (pick the award, then a short form), 🏷 Award names (add, rename, remove). Vote posts got **🙋 Nominate someone** (anyone when the vote allows it, with ➕ a second wrestler for rivalries/matches) |
| `/directory` | `/directory page: division:` | Roster list, 🗂 roster cards, Hall of Fame (staff: induct, 🗑 take out), injuries |
| `/feud` | `/feud`, `/feud feud:` | Log a moment, heat, end, start a feud |
| `/contract` | `/contract`, `/contract wrestler:` | Offer, request, release, tabs; staff 💵 Win bonuses form |
| `/team` | `create` · `view` | Add/remove members, rename, disband |
| `/tournament` | `create` · `view` | Add/remove wrestlers, start, decide matches, post bracket, cancel |
| `/match` | `log` (staff) · `report` | Edit, undo, rate: buttons under each result. `/fnlw` → Results got 🎆 PLEs (everyone) and 🎟 Tag today's matches as a PLE (staff) |
| `/title` | `manage` · `belt-image` | `/title manage` → a belt: 🎬 log match, 🎯/✖ contender, 🚫 vacate, 🩹 interim, 🔗 unify, 🔁 waive a rematch, ⏱ title watch, **📜 fix any reign** (dates, defenses, notes, interim, change the champion, add/remove written-down defenses, delete) and **➕ add an old reign**. Type a champion's name: if it matches a wrestler or team in the bot it gets linked, otherwise the name is saved as text |
- New screens are **private by default**. Add `show_everyone:True` to post the first screen in the channel (button presses still only answer the person pressing).
- You can type a wrestler's name instead of picking from the list for `/stats`, `/legacy` and `/contract`.
- A vacant belt's title match is logged with `/match log` + `title:`.
- Help and every "use `/…`" message now point to the right button.
- No database change. Still 18 commands. Old subcommands still work inside the bot.

## 3.8.0 — Fewer commands: /admin, /booking, /card and /championship are mostly buttons now
What Discord lists now (type `/` to see):
| Command | Typed parts left | Everything else is a button in… |
|---|---|---|
| `/admin` | `pending` (first), `panel`, `data` | **`/admin panel`**: 📥 Pending · 📝 Reported results · ⏳ Unfinished · 📺 Channels · 📜 Rules · 👮 Staff role · 🏆 History channel · ⚙️ All settings · 📰 Newsletter · 📊 Staff report · 🏅 Monthly awards · 📒 Audit log · 💾 Backup & import |
| `/booking` | `request`, `signups` | **`/booking signups`**: 🔎 Suggest opponents (everyone) · staff: 🆕 Open a signup · 📋 Who signed up · 🔒 Close · ✅ Mark finished · ➕ Sign a wrestler up · ➖ Take one off |
| `/card` | `view` (first), `add` | **`/card view`** → 🧰 **More tools**: 🆕 New card · ⚡ Auto-build · 📨 Add a match request · 📅 Schedule · 🗓 Upcoming · 🧾 Post recap here · ⭐ MOTN vote here · 🔒 Close MOTN vote · Auto recap on/off · 🗑 Clear. A 🔁 button flips between RAW and SmackDown. Each match also has 📼 **Tale of the tape** (with 📣 Post it here). |
| `/championship` | just `/championship` or `/championship title:` | No title: every champion, a menu to open a belt, 🏅 Grand slam per division, 🎯 #1 contenders, 🔁 Rematches owed. With a title: the belt with 📜 History · 🛡 Defenses · 🕰 Lineage · 📚 Records · 🎯 Contenders · ⚔️ **Challenge for it** (players pick one of their own wrestlers or teams; staff approve it) · 🔁 Rematches, plus the staff buttons as before. |
- Rules are a form (cooldown hours, streak wins, defense days, vacate days, rematch days) plus on/off buttons and a time zone form. Staff role is a role menu.
- `/card view` no longer errors when there's no card yet: it shows the tools so you can start one.
- 🛠 Staff Tools now has **🛠 Admin panel** and **📝 Signups** buttons, and 📺 Channels goes back to the admin panel.
- Every message that used to say "use `/card auto`", "`/admin channels`" etc. now says where the button is.
- Things that need a file still need typing: spreadsheet import is `/admin data`.
- Nothing is lost: the old subcommands still exist inside the bot (the buttons run them, with the same checks). No database change. Still 18 commands.

## 3.7.0 — Players report their own results (staff approve)
- **Players:** `/fnlw` → 🙋 My Wrestlers → **📝 Report a result** (shows how many of their card matches still need one), or **`/match report`**. Pick the match and how it ended (who won / draw / no contest). Finish, score, notes and a **screenshot** are optional (the screenshot only works with `/match report`). Only players whose wrestler is in the match can report it, and only unrecorded matches on the current cards. Reporting the same match again replaces your earlier report.
- **Staff:** each report is posted in the **staff room** with **✅ Approve · ✏️ Fix & approve · ❌ Deny**. Approving records it exactly like recording it in `/card view` (result picture in the results channel, title changes, contenders, tournaments). Fix lets you change the winner, finish, score and notes first. Deny asks for an optional reason. The player gets a DM either way.
- **Two players report different results?** Both are kept and both posts say ⚠️ *Different reports for this match*. Approve the right one; the others close by themselves (and those players are told).
- **🛠 Staff Tools → 📝 Reported results (n)** lists everything waiting (works even without a staff room set).
- `/match` is now visible to everyone so players can use `report`. Every other `/match` subcommand still only works for admins and the staff role.
- Database change: migration 024. Still 18 commands. `/card` works the same.

## 3.6.0 — Unfinished match pings at 1 pm
- The daily unfinished match pings now go out around **1 pm** (was noon) in the server's time zone.
- The bot's timed jobs now run just after the top of every hour (1:00, 2:00 …) instead of whenever the bot last restarted, so posts land close to their hour (the 6:40 was from a restart at :40).
- The server's time zone was still **UTC**, which is why noon showed up as 6 am in Chicago. Set it once with `/admin rules timezone:America/Chicago`. That also puts the other timed posts on Central time: tonight's-card reminder (noon), newsletter and staff report (Monday 9 am), power rankings (Monday 10 am), and the date the bot counts as "today".
- No database change. Still 18 commands.

## 3.5.0 — Fewer commands, more buttons
**Renamed / merged (what to type now):**
| Before | Now |
|---|---|
| `/match log-singles`, `log-tag2v2`, … (8 commands) | `/match log` (pick the type) |
| `/faction create / list / profile / add-member / remove-member / disband` | `/team …` (create has **kind: Tag team / Faction**; everything else lets you pick any team or faction from one list) |
| `/standings season-standings` and `season-recap` | `/standings season` (`picture:True` for the recap picture) |
| `/title contender-award` and `contender-revoke` | `/title contender action: Give / Take away` |
| `/booking signup-add` and `signup-remove` | `/booking signup-edit action: Add / Remove` |
| `/admin backup`, `import`, `import-template` | `/admin data action: …` (Import with no file sends the example files) |

**New staff-only buttons** (everyone sees them; only admins and the staff role can use them):
- **Signup post:** 🔒 Close while it's open, ✅ Mark done once it's closed.
- **A wrestler** (🙋 My Wrestlers / roster / `/whois` panels → 🛠 Staff): Retire / Restore, move to another division, give or move to a player (pick from a member list), Unclaim, Delete (asks first, and only works with no history). Each runs the normal `/character` command with all its checks.
- **Award vote post:** ▶️ Start voting while taking nominations, 🔒 Close vote while voting (asks first; only you see the totals).
- **Tournament bracket post:** 🏁 Decide a match while the tournament is running.

- 18 commands now (was 19). No database change. Old buttons and anything half-finished keep working. `/card` is unchanged.

## 3.4.0 — "Don't see your wrestler?" on signups
When someone presses **Sign up / change**, the private picker now says:
> **Don't see your wrestler?**
> ➕ New wrestler: tap **Request a new wrestler** (or `/character submit`)
> 🔄 Wrestler with no player: tap **Claim a wrestler**
> Staff approve both. Once approved, you're signed up automatically.

It also shows for players who have no approved wrestlers yet (instead of a dead end).
- **➕ Request a new wrestler**: pick the division, then a short form: name (required), finisher, face/heel/neutral, one-line bio and picture link (all optional). It goes through the normal character approval; the approval card says it came from the signup. To upload a picture file, `/character submit` still works.
- **🔄 Claim a wrestler**: lists only wrestlers with **no player** (unclaimed), by division. The request goes to the **staff room** (or the approvals channel if no staff room is set) with Approve / Deny. Approving moves the wrestler to that player with all its stats and history. Asking twice for the same wrestler is stopped; if two people ask, only the first approval goes through.
- **Approved while signups are still open** → the wrestler is signed up automatically. Either way the player gets a DM (if their DMs are open). Denied claims get a DM too.
- Players at the wrestler limit still see the buttons, with a note to ask staff to retire one first.
- Database change: migration 023 (new request type). Still 19 commands.

## 3.3.0 — Booked wrestlers on the signup post
- When a wrestler who signed up is put on the RAW or SmackDown card, the signup post **keeps their name but crosses it out under 🔴 Booked**, with which card they're on, e.g. `🔴 Booked: ~~Ace~~ (SmackDown)`. The division line shows how many are still open: `Men's (4 · 2 still open): Cruz, Dax`. If a whole division is booked it says *everyone is booked*.
- The post updates by itself a few seconds after any card change (add, move, remove, auto, clear). Take a match off the card and those wrestlers are open again.
- The staff list (`/booking signup-list` and the list posted when signups close) puts booked wrestlers at the bottom: `🔴 ~~Ace~~ · booked on SmackDown #1`.
- Only cards changed after the signup was opened count, so a leftover card from an earlier show doesn't mark anyone. A finished signup (`signup-done`) shows no booked marks.
- Discord can't show red text in posts that look right on phones, so "booked" is shown with 🔴 and crossed-out names instead.
- No database change. Still 19 commands. `/card` works the same.

## 3.2.0 — Unfinished match reminders
A match counts as **unfinished** when it was on a RAW or SmackDown card, the show date has passed, and no result was recorded for it. A card with no show date (never set with `/card schedule`) counts from the day it was made. Nothing about `/card` changed; the bot only reads your cards.
- **`/admin unfinished`** (`card:` RAW or SmackDown to see just one) or **🛠 Staff Tools → ⏳ Unfinished matches** (red when there are some; 🟥 RAW / 🟦 SmackDown / Both cards buttons): every unfinished match with who's in it and how many days late it is. **📣 Ping them here now** posts one message tagging everyone who still owes a match (staff only).
- **Daily pings**: pick a channel in 📺 Channels → *Unfinished match pings* (or `/admin channels reminders:`). From the day after the show, the bot pings the players once a day from noon (server time zone), **up to 6 days in a row** per match ("reminder 3/6", "last reminder"). After that the match just stays on the staff list. Moving a match on the card doesn't reset its count; a new show date starts fresh.
- **🙋 My Wrestlers** tells players "⏳ You have 1 unfinished match" with the details.
- When a result is recorded (card view, `/match log` or the old log commands), the match drops off the list and the pings stop.
- Database change: migration 022. Still 19 commands.

## 3.1.0 — Button panels for everything
Everyone can open and look at every panel. **Edit buttons only show up for admins and the staff role** (and, for a wrestler, their own player). Every button runs the normal command underneath, so all the usual checks still apply. **No command was removed or changed**; `/card` is untouched.

**Home menu (`/fnlw`)**: new buttons for 📈 Standings, 📊 Stats, 🎖 Legacy, 👥 Teams & Factions, 🔥 Feuds, 🏟 Tournaments and 📝 Contracts. `/fnlw go:` jumps straight to one of them.

- **📊 Stats**: pick any wrestler (by division, with pages), then tap Overview, Recent, Opponents, Badges, Timeline, Titles, Legacy, Card, Head-to-head or Tale of the tape. The 📊 Stats button under `/whois` opens this too.
- **📈 Standings**: Leaderboards (category and period menus), Rankings, Power (per division), Season (this year and the two before, plus the recap picture), Rivalries and Most decorated players.
- **🎖 Legacy**: the honor roll by accolade and year, look up any wrestler, and **🗳 Votes**: open votes can be voted on right from the panel. Staff: **🎖 Give accolade** (pick the wrestler, the accolade, then the year, a note and whether to announce it).
- **👥 Teams & Factions**: lists and cards for everyone. Staff: ➕ Add member, ➖ Remove member, ✏️ Rename (teams), 💔 Disband (asks first).
- **🏟 Tournaments**: entrants or the bracket for everyone. Staff: ➕ Add / ➖ Remove wrestlers, ▶️ Start (asks first), **🏁 Decide a match** (tap who advances), 📣 Post the bracket in the channel, ✖ Cancel.
- **Under every match result** (from `/match log` or your card): **⭐ Rate this match** for everyone (1–5 stars, one rating per person, only the average is shown, also in 📰 Results) and **🛠 Staff** (admins and staff only): edit notes / stipulation / score, or **↩️ Undo** (asks first, and marks the result post as undone). The staff rating from `/match rate` still decides "best match" for Wrestler of the Month.
- **📝 Contracts**: your wrestlers' deals, Under contract, Free agents, Earnings. Players: **🙋 Ask for a new deal** (posted for staff to approve). Staff: **📨 Offer a contract** (posted for the player to accept) and ✂️ Release.
- **🙋 My Wrestlers**: **✏️ Edit details** (name, alignment, bio, finisher, theme), **📖 Story & moves**, **🖼 Picture** (a link; uploading a file is still `/character picture`), 📝 Contract. Only the wrestler's player and staff see or can use these, and never on a public `/whois` post.
- **🔥 Feuds**: every feud with its timeline. Staff: 🔥 Start a feud, 📖 Add a moment, 🌡 Set heat, 🏁 End.
- **📋 Roster → 🏛 Hall of Fame and 🤕 Injuries**: the list and graphics for everyone. Staff: 🏛 Induct (the graphic is posted in the channel), 🤕 Add an injury, 💪 Mark healthy.
- **🛠 Staff Tools → 📺 Channels**: pick where the bot posts from a channel menu instead of typing it, or turn a post off.

- Database change: migration 021 (fan ratings). Still 19 commands.

## 3.0.0 — Award votes, PLEs, one match log, power rankings, error alerts
**Award votes** (`/legacy`)
- **`/legacy vote-open`** (admins and staff) for Face of FNLW MVP or any year-end award. Choose who can add nominees (`nominees_by`: admins and staff, or everyone) and who can vote (`voters`: everyone, or admins and staff). It posts in the Legacy channel (or `channel:`).
- **`/legacy nominate`** adds a nominee. For a rivalry or a match, add `character2` and an optional `label` like "Ace vs Bolt, Survivor Series".
- **`/legacy vote-start`** closes nominations and turns the post into a vote dropdown. **Votes are secret**: nobody sees who picked whom, people can change their vote, and the post never shows who is ahead.
- **`/legacy vote-close`** ends it. The winner (both wrestlers of a rivalry or match) gets the Legacy accolade and the gold announcement. Only the winner is made public; the admin who closes it sees the totals privately. A tie or no votes awards nothing (settle it with `/legacy award`). `cancel:true` cancels a vote.

**PLEs** (your graphics are untouched; this only tags matches)
- **`/match log ple:WrestleMania`** tags a match as it is logged. After a show run through `/card view`: **`/match ple event:WrestleMania`** tags every match logged that day (`date:` for another day, `match_id:` for one match, `clear:true` to remove a tag). The year is added for you.
- A **Money in the Bank** or **Royal Rumble** match won at a PLE gives the winner that Legacy accolade automatically (one clear winner only), with the announcement.
- The history channel, the record book and title history say "won at WrestleMania 2026" for a title won at a PLE; `/stats character` shows the record at PLEs; **`/match ple`** with nothing filled in shows every PLE and the most PLE wins.

**One `/match log`**
- **`/match log`**: pick the `type`, the wrestlers in order (tag matches: Team 1 first, then Team 2) and the `winner` (wrestler number, or team 1 / 2). Same title, contender, stipulation, finish, score, notes and cooldown options as before, plus `ple`.
- The old `/match log-singles`, `log-tag2v2` and so on **still work exactly the same**. Their `finish` is now a type-to-search list (same choices) to make room in Discord. `/card` is unchanged.

**Power rankings**
- **`/standings power`**: one list per division from the last 60 days. Counts wins (more for beating someone with a good record), title matches, recent form, current champions and #1 contenders; newer matches count more. Losses cost a little, less in a title match.
- Posted **every Monday from 10am** (server time zone) in the channel set with **`/admin channels power:`**, with ▲ / ▼ / 🆕 movement since the week before.

**Error alerts**
- When something unexpected breaks (a command error, the history channel or power rankings failing to post), the bot tells the **staff channel** (`/admin channels staff:`). The same problem is mentioned at most once every 6 hours.

- Database change: migration 020 (award votes, PLE tag on matches, power rankings). 19 commands.

## 2.21.0 — Legacy, belt-by-belt cards, record book
**Legacy** (`/legacy`)
- **`/legacy award`** (admins and staff): Money in the Bank and Royal Rumble (per division, defaults to the wrestler's), Face of FNLW MVP, or a year-end award. The accolade belongs to the character; the player who owned them gets the credit (for old wins, `player:` sets who played them then). Optional `year` (default this year) and `notes`.
- Year-end awards come from a list: Breakout Wrestler of the Year, Rivalry of the Year, Kickout King of the Year, Promo Prince of the Year, Match of the Year, Rookie of the Year, Cringe Guy Award and OMG Moment of the Year to start. **`/legacy award-names`** adds, renames (past winners follow the new name) or removes names.
- Awards are announced with a gold post in the Legacy channel: **`/admin channels legacy:#channel`**. `announce:false` skips it. Nobody is pinged.
- **`/legacy list`** (everyone): the honor roll, grouped by accolade, newest first, with a dropdown to show one accolade. **`/legacy view`** shows one wrestler's or one player's accolades. **`/legacy remove`** takes one back.
- Legacy shows as **gold badges** on the character card ("CUSTOM MITB 2026", "2X RUMBLE WINNER") and in a LEGACY row on the player card.

**Character card**
- The CHAMPIONSHIPS section lists every belt: current belts first in gold with the reign number ("Showtime Champion · 2nd reign"), then "Former Intercontinental Champion (2x)". Top 4, then "+N more belts". Tag belts count too.
- The banner on the picture says DOUBLE / TRIPLE CHAMPION when a wrestler holds more than one belt (it used to say "multi-time champion").

**Player card** (`/stats user`)
- New CHAMPIONSHIPS section: each belt, how many times, and which wrestler(s) held it.
- A gold marker next to wrestlers who hold a belt right now. The gold line under the name is shorter.

**Record book**
- **`/championship records`** and a **📚 Records** button on every belt panel: longest reign, shortest reign, most defenses in one reign and most reigns. Singles show the character with the player when the reign is linked, otherwise the player; tag titles show the team, its wrestlers and players.

- Database change: migration 019 (Legacy tables and the Legacy channel setting). The bot now has 19 commands.

## 2.20.0 — Home menu, buttons, staff role, simpler commands
**For everyone**
- **`/fnlw`**: a private home menu with buttons. 🏆 Champions (pick a title from the dropdown for its belt card, history, defenses and lineage), 📅 Next Show (the RAW and SmackDown cards, now visible to members), 📰 Results (the last 10 matches, now visible to members), 📋 Roster, 🙋 My Wrestlers and ❓ Help. Every section has a 🏠 Home button.
- **`/whois`** now has a dropdown of that player's wrestlers and buttons for the profile card, stats and title history.
- **`/directory list`** has buttons to switch division (All, Men's, Women's, Custom, Custom Women's), switch between A to Z and By player, and ◀ ▶ to page through a big roster.
- **`/character profile`** has 📊 Stats, 🙋 Who plays them and 🏆 Title history buttons.
- **`/stats user`** has a dropdown to open any of that player's wrestler cards.
- **`/championship list`** has a dropdown to open any title's belt card.
- **`/help`** has a topic dropdown: Getting started, Wrestlers & stats, Titles, Shows & results (and Staff tools for admins and staff).
- Clicking a button under a public message answers privately, so one person's clicks never change what everyone else sees.

**For admins and staff**
- **Staff role:** `/admin staff-role role:@Staff`. Members with that role can use every admin tool (booking, logging matches, titles, approvals) without the Manage Server permission. So they can *see* the admin commands, also add the role to them in Server Settings → Integrations → this bot.
- **`/admin channels`** sets every "post it here" channel in one command (approvals, staff reminders, match results copy, Wrestler of the Month, newsletter) and shows them all. `turn_off` stops one. Replaces `set-pending-channel`, `set-admin-channel`, `set-matches-channel`, `set-monthly-channel` and `set-newsletter-channel`.
- **`/admin rules`** sets the league rules in one command (singles cooldown, win-streak prompt, milestones, defense warning, auto-vacate, rematch clause, time zone) and shows them all. Replaces `set-cooldown`, `set-streak-threshold`, `milestones`, `deadlines`, `rematches` and `set-timezone`. `/admin` went from 25 parts to 13.
- **`/reign` moved into `/title`:** `/title reign-add`, `reign-edit`, `reign-remove`, `add-defense`, `remove-defense`. Now `/championship` is for looking at titles and `/title` is for changing them.
- **Tag title reigns with partners:** `/title reign-add` and `reign-edit` take `character` + `partner` (+ `partner2` for 3-person teams) and an optional `team_name`, for teams that aren't registered in the bot. Every wrestler is linked (it counts on each of their profiles) and every player gets credit. Editing an old reign keeps the player credit it already had. `team_name` alone renames a tag reign.
- **🛠 Staff Tools** in `/fnlw`: how many requests are waiting, with buttons for approvals, the RAW and SmackDown card editors and the title watch, plus a cheat sheet of staff commands.
- Database change: migration 018 (one setting for the staff role). The bot now has 18 commands.

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
