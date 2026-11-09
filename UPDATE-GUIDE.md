# How to install Version 3.4.0 (Mac, step by step)

The new files are already in your **wrestling-bot** folder in Downloads, and Version 3.4.0 is
already saved in git. Nothing changes on Discord or Railway until you upload it.

**Tell your admins:** the signup picker now has **Request a new wrestler** and **Claim a wrestler**
buttons. Claim requests show up in the staff room with Approve / Deny.

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
The log should say `Applying migration 023_claims.sql` and `Slash commands registered.`

## Step 3: Try it (in Discord, press Cmd + R first)

1. Make sure the staff room is set (`/admin channels staff:#staff-room`); claim requests go there.
2. Open signups the usual way, press **Sign up / change**: you'll see the new message and buttons.
3. Try **Claim a wrestler** with a test account (or ask a member) and approve it in the staff room.
   The wrestler moves to them and lands on the signup.

---

## If something goes wrong

| What you see | What to do |
|---|---|
| `Authentication failed` | The token is wrong or expired. Make a new one at https://github.com/settings/tokens (classic, tick **repo**). |
| `git push` says "rejected" | Tell me the exact message. |
| Railway deploy shows "Failed" | Copy the last ~20 lines of the log (no tokens or passwords) and send them to me. |
| New buttons don't show up | Cmd + R in Discord and run `/fnlw` again. |
| "⚠️ Bot problem" in the staff room | Copy it and send it to me. |
