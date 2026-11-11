# How to install Versions 3.8.0 + 3.9.0 (Mac, step by step)

Both versions are already saved in git in your **wrestling-bot** folder in Downloads.
Nothing changes on Discord or Railway until you upload them (one `git push` uploads both,
plus 3.7 if you haven't pushed that yet).

**What changed, in one line:** almost every command now shows only one or two typed parts.
Everything else is a button on the screen it opens.

**Tell your members** (copy this):
> The bot got simpler! Try `/stats wrestler:`, `/standings`, `/legacy`, `/championship`, `/directory`,
> `/feud` and `/contract`. Each one opens a screen with buttons. Only you see it, unless you add
> `show_everyone:True`. Edit your wrestler in `/fnlw` → 🙋 My Wrestlers. Award votes now have a
> 🙋 Nominate button right on the post.

**Cheat sheet for staff** (copy this into your staff room):
> • Settings, rules, staff role, newsletter, backups → `/admin panel` · approvals → `/admin pending`
> • Cards → `/card view` (🧰 More tools) · one match → `/card add` · results → `/match log`
> • Belts → `/title manage` (log match, contender, vacate, interim, fix any reign, add old reigns)
> • Retire / transfer / unclaim a wrestler → `/whois` → 🛠 Staff
> • Accolades and votes → `/legacy` · Hall of Fame and injuries → `/directory`
> • Teams and tournaments → `/team view`, `/tournament view` · PLE tags → `/fnlw` → Results

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
The log should say `Slash commands registered.` (if you're also uploading 3.7, it says
`Applying migration 024_match_reports.sql` first).

## Step 3: Check it (in Discord, press Cmd + R first so it loads the new command lists)

1. Type `/stats` → you should only see **wrestler**, **player** and **show_everyone**. Pick a wrestler.
2. Type `/title` → only **manage** and **belt-image**. Run `/title manage`, pick a belt, open 📜 Fix a reign.
3. Type `/admin panel` and `/card view` → 🧰 More tools.
4. Run `/legacy` → staff see 🗳 Open a vote and 🏷 Award names.

---

## If something goes wrong

| What you see | What to do |
|---|---|
| Discord still shows the old long lists | Press Cmd + R. If it's still there after a few minutes, fully quit Discord and reopen it. |
| `Authentication failed` | The token is wrong or expired. Make a new one at https://github.com/settings/tokens (classic, tick **repo**). |
| `git push` says "rejected" | Tell me the exact message. |
| Railway deploy shows "Failed" | Copy the last ~20 lines of the log (no tokens or passwords) and send them to me. |
| "⚠️ Bot problem" in the staff room | Copy it and send it to me. |
