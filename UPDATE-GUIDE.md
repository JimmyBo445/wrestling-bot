# How to install Version 3.1.0 (Mac, step by step)

The new files are already in your **wrestling-bot** folder in Downloads, and Version 3.1.0 is
already saved in git. Nothing changes on Discord or Railway until you upload it.

**Tell your admins:** every `/fnlw` section now has buttons. Staff see extra edit buttons
(green / red) that players never see. Every result also gets ⭐ Rate and 🛠 Staff buttons.
All the old commands still work the same.

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
The log should say `Applying migration 021_v31.sql` and `Slash commands registered.`

## Step 3: Try it (in Discord, press Cmd + R first)

1. `/fnlw` and tap each new button: 📈 Standings, 📊 Stats, 🎖 Legacy, 👥 Teams & Factions,
   🔥 Feuds, 🏟 Tournaments, 📝 Contracts, and 📋 Roster → 🏛 Hall of Fame / 🤕 Injuries.
2. 🙋 **My Wrestlers** → ✏️ **Edit details** on one of yours.
3. 🛠 **Staff Tools** → 📺 **Channels** to see the channel picker.
4. After your next match: tap ⭐ **Rate this match** under the result, then 🛠 **Staff**.
5. Ask a regular member to open `/fnlw` and check they **don't** see any edit buttons.

---

## If something goes wrong

| What you see | What to do |
|---|---|
| `Authentication failed` | The token is wrong or expired. Make a new one at https://github.com/settings/tokens (classic, tick **repo**). |
| `git push` says "rejected" | Tell me the exact message. |
| Railway deploy shows "Failed" | Copy the last ~20 lines of the log (no tokens or passwords) and send them to me. |
| New buttons don't show up | Cmd + R in Discord and run `/fnlw` again. |
| "⚠️ Bot problem" in the staff room | Copy it and send it to me. |
