# How to install Version 3.2.0 (Mac, step by step)

The new files are already in your **wrestling-bot** folder in Downloads, and Version 3.2.0 is
already saved in git. Nothing changes on Discord or Railway until you upload it.

**Tell your admins:** 🛠 Staff Tools now has ⏳ Unfinished matches: matches from past cards
that have no result yet, with a button to ping the players. All the old commands still work the same.

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
The log should say `Applying migration 022_unfinished.sql` and `Slash commands registered.`

## Step 3: Set it up (in Discord, press Cmd + R first)

1. `/fnlw` → 🛠 **Staff Tools** → ⏳ **Unfinished matches** to see what's left from past cards.
2. For the daily pings: 📺 **Channels** → pick **Unfinished match pings** → pick a channel
   (for example #match-reminders). Or type `/admin channels reminders:#match-reminders`.
   From then on, every day from noon the bot pings players whose card match is at least a day
   late, up to 6 days in a row.
3. Players see their own late matches in `/fnlw` → 🙋 **My Wrestlers**.

---

## If something goes wrong

| What you see | What to do |
|---|---|
| `Authentication failed` | The token is wrong or expired. Make a new one at https://github.com/settings/tokens (classic, tick **repo**). |
| `git push` says "rejected" | Tell me the exact message. |
| Railway deploy shows "Failed" | Copy the last ~20 lines of the log (no tokens or passwords) and send them to me. |
| New buttons don't show up | Cmd + R in Discord and run `/fnlw` again. |
| "⚠️ Bot problem" in the staff room | Copy it and send it to me. |
