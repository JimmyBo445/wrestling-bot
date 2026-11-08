# How to install Version 3.3.0 (Mac, step by step)

The new files are already in your **wrestling-bot** folder in Downloads, and Version 3.3.0 is
already saved in git. Nothing changes on Discord or Railway until you upload it.

**Tell your admins:** when you put a signed-up wrestler on a card, the signup post now shows
them crossed out under 🔴 Booked, so everyone can see who's still open. Nothing else changes.

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

## Step 3: Try it (in Discord, press Cmd + R first)

1. Open signups the usual way (`/booking signup-open`) and let a few people sign up.
2. Put two of them in a match on the card (`/card add` or `/card auto`).
3. A few seconds later the signup post shows them under 🔴 **Booked** with their names crossed out.
4. Remove that match from the card: they go back to the open list.

---

## If something goes wrong

| What you see | What to do |
|---|---|
| `Authentication failed` | The token is wrong or expired. Make a new one at https://github.com/settings/tokens (classic, tick **repo**). |
| `git push` says "rejected" | Tell me the exact message. |
| Railway deploy shows "Failed" | Copy the last ~20 lines of the log (no tokens or passwords) and send them to me. |
| New buttons don't show up | Cmd + R in Discord and run `/fnlw` again. |
| "⚠️ Bot problem" in the staff room | Copy it and send it to me. |
