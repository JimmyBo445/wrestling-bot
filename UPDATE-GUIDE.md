# How to install Version 3.6.0 (Mac, step by step)

The new files are already in your **wrestling-bot** folder in Downloads, and Version 3.6.0 is
already saved in git. Nothing changes on Discord or Railway until you upload it.

**What changes:** unfinished match pings go out around 1 pm instead of noon, and timed posts now land
right at the top of the hour.

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
The log should say `Slash commands registered.` (no database change this time).

## Step 3: Set your time zone (once, in Discord)

`/admin rules timezone:America/Chicago`

The bot was still on UTC, which is why noon showed up as 6:40 am for you. After this, the pings come
around 1 pm Central. Your other timed posts move to Central time too: the tonight's-card reminder at noon,
the newsletter and staff report Monday 9 am, power rankings Monday 10 am.

Check it with `/admin settings` (Time zone should say America/Chicago).

---

## If something goes wrong

| What you see | What to do |
|---|---|
| `Authentication failed` | The token is wrong or expired. Make a new one at https://github.com/settings/tokens (classic, tick **repo**). |
| `git push` says "rejected" | Tell me the exact message. |
| Railway deploy shows "Failed" | Copy the last ~20 lines of the log (no tokens or passwords) and send them to me. |
| New buttons don't show up | Cmd + R in Discord and run `/fnlw` again. |
| "⚠️ Bot problem" in the staff room | Copy it and send it to me. |
