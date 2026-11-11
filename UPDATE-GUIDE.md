# How to install Version 3.5.0 (Mac, step by step)

The new files are already in your **wrestling-bot** folder in Downloads, and Version 3.5.0 is
already saved in git. Nothing changes on Discord or Railway until you upload it.

**Tell your admins** (copy this):
> Bot update: fewer commands. `/match log` replaces the old log-singles etc. `/faction` is now part of `/team`
> (pick Faction when creating). `/standings season`, `/title contender`, `/booking signup-edit` and `/admin data`
> replace pairs of old commands. Staff also get buttons on the signup post (Close / Mark done), on vote posts
> (Start / Close), on bracket posts (Decide a match) and a 🛠 Staff button on any wrestler.

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

## Step 3: Check it (in Discord, press Cmd + R first)

1. Type `/match`: you should only see log, ple, rate, undo, edit, recent.
2. Type `/faction`: it's gone. `/team create` now has a **kind** choice.
3. Open `/fnlw` → 🙋 My Wrestlers (or look up anyone with the roster) → **🛠 Staff** on a wrestler.
4. Your next signup post shows **🔒 Close (staff)**. Ask a regular member to tap it: they should be told no.

If Discord still shows an old command after a few minutes, fully quit and reopen Discord.

---

## If something goes wrong

| What you see | What to do |
|---|---|
| `Authentication failed` | The token is wrong or expired. Make a new one at https://github.com/settings/tokens (classic, tick **repo**). |
| `git push` says "rejected" | Tell me the exact message. |
| Railway deploy shows "Failed" | Copy the last ~20 lines of the log (no tokens or passwords) and send them to me. |
| New buttons don't show up | Cmd + R in Discord and run `/fnlw` again. |
| "⚠️ Bot problem" in the staff room | Copy it and send it to me. |
