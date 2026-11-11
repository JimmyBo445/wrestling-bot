# How to install Version 3.7.0 (Mac, step by step)

The new files are already in your **wrestling-bot** folder in Downloads, and Version 3.7.0 is
already saved in git. Nothing changes on Discord or Railway until you upload it.

**Tell your members** (copy this):
> Played your card match? Report it yourself: `/fnlw` → My Wrestlers → 📝 Report a result, or `/match report`
> (you can add a screenshot there). Staff approve it before it counts, and you'll get a DM.

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
The log should say `Applying migration 024_match_reports.sql` and `Slash commands registered.`

## Step 3: Check it (in Discord, press Cmd + R first)

1. Make sure the staff room is set: `/admin channels staff:#your-staff-room` (reports go there).
2. **Integrations check:** Server Settings → Integrations → your bot → `/match`. If you limited `/match` to your
   staff role before, members won't see `/match report`. Either allow @everyone on `/match` (the staff-only
   parts still refuse players), or have members use the 📝 Report a result button instead.
3. With a member (or a test account) who's on a card: `/fnlw` → 🙋 My Wrestlers → 📝 Report a result.
4. Approve it in the staff room and check the result picture appears in your results channel.

---

## If something goes wrong

| What you see | What to do |
|---|---|
| `Authentication failed` | The token is wrong or expired. Make a new one at https://github.com/settings/tokens (classic, tick **repo**). |
| `git push` says "rejected" | Tell me the exact message. |
| Railway deploy shows "Failed" | Copy the last ~20 lines of the log (no tokens or passwords) and send them to me. |
| New buttons don't show up | Cmd + R in Discord and run `/fnlw` again. |
| "⚠️ Bot problem" in the staff room | Copy it and send it to me. |
