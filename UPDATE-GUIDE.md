# How to install Version 3.0.0 (Mac, step by step)

The new files are already in your **wrestling-bot** folder in Downloads, and Version 3.0.0 is
already saved in git. Nothing changes on Discord or Railway until you upload it.
If 2.21.0 isn't uploaded yet either, one push sends both.

**Tell your admins:** there's a new `/match log` for every match type. The old `/match log-…`
commands still work the same, so nobody has to switch right away.

---

## Step 1: Upload

1. Press Cmd + Space, type **Terminal**, press Return.
2. `cd ~/Downloads/wrestling-bot`
3. `git push`
   - Username: `JimmyBo445`
   - Password: your GitHub token starting with `ghp_` (nothing shows when you paste it).
   - It worked when you see `main -> main`.

## Step 2: Let Railway deploy

Railway → **wrestling-bot** → **Deployments**. Wait for **Active/Success** (about 2 minutes).
The log should say `Applying migration 020_v3.sql` and `Slash commands registered.`

## Step 3: Set it up (in Discord)

Press Cmd + R first.

1. Channels: `/admin channels power:#power-rankings staff:#staff-room`
   (skip `staff:` if you already set it; the staff room now also gets error alerts.)
2. Look at the rankings: `/standings power`. The first automatic post is next Monday from 10am.

## Step 4: Try it

- **Log a match:** `/match log type:Singles wrestler1:… wrestler2:… winner:1`
  (tag matches: Team 1 in wrestler1–2, Team 2 in wrestler3–4, `winner:` is 1 or 2).
- **After a PLE** (run through `/card view` as usual): `/match ple event:WrestleMania`
  tags every match logged today. A Money in the Bank or Royal Rumble winner gets the Legacy
  accolade by itself. `/match ple` with nothing filled in shows your PLE history.
- **Award vote:**
  1. `/legacy vote-open accolade:Year-end award award_name:Rookie of the Year year:2025 nominees_by:Everyone`
  2. `/legacy nominate` (anyone, because of `nominees_by:Everyone`)
  3. `/legacy vote-start` when nominations are done
  4. `/legacy vote-close` when voting is done. Only you see the totals; everyone sees the winner.

---

## If something goes wrong

| What you see | What to do |
|---|---|
| `Authentication failed` | The token is wrong or expired. Make a new one at https://github.com/settings/tokens (classic, tick **repo**). |
| `git push` says "rejected" | Tell me the exact message. |
| Railway deploy shows "Failed" | Copy the last ~20 lines of the log (no tokens or passwords) and send them to me. |
| New commands don't show up | Cmd + R in Discord and wait 5 minutes. |
| "⚠️ Bot problem" in the staff room | Copy it and send it to me. |
