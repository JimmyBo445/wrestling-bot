# How to install Version 3.8.0 (Mac, step by step)

The new files are already in your **wrestling-bot** folder in Downloads, and Version 3.8.0 is
already saved in git. Nothing changes on Discord or Railway until you upload it.

**What changed, in one line:** `/admin`, `/booking`, `/card` and `/championship` show far fewer
typed options. The rest are buttons now.

**Tell your members** (copy this):
> The bot got simpler! `/championship` shows every title. Add `title:` to open a belt, then press
> ⚔️ **Challenge for it** to ask for a title shot. `/booking signups` has 🔎 **Suggest opponents**.

**Cheat sheet for staff** (copy this into your staff room):
> • Settings, rules, staff role, newsletter, backups → `/admin panel`
> • Approvals → `/admin pending` · Spreadsheet import → `/admin data`
> • Cards → `/card view` (🧰 **More tools** has new card, auto-build, schedule, recap, MOTN vote, clear) · one match → `/card add`
> • Signups → `/booking signups`

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
The log should say `Slash commands registered.` (there is no database change this time).

## Step 3: Check it (in Discord, press Cmd + R first so it loads the new command list)

1. Type `/admin` → you should only see **pending**, **panel** and **data**. Run `/admin panel` and press 📜 Rules.
2. Type `/card` → only **view** and **add**. Run `/card view` → press 🧰 **More tools**.
3. Type `/championship` and press Enter with nothing else → every title with buttons underneath.
4. Type `/booking signups` → the signup buttons.

---

## If something goes wrong

| What you see | What to do |
|---|---|
| Discord still shows the old long lists | Press Cmd + R. If it's still there after a few minutes, fully quit Discord and reopen it. |
| `Authentication failed` | The token is wrong or expired. Make a new one at https://github.com/settings/tokens (classic, tick **repo**). |
| `git push` says "rejected" | Tell me the exact message. |
| Railway deploy shows "Failed" | Copy the last ~20 lines of the log (no tokens or passwords) and send them to me. |
| "⚠️ Bot problem" in the staff room | Copy it and send it to me. |
