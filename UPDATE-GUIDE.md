# How to install Version 2.21.0 (Mac, step by step)

The new files are already in your **wrestling-bot** folder in Downloads, and Version 2.21.0 is
already saved in git. Nothing changes on Discord or Railway until you upload it.

**If you haven't pushed 2.20.0 yet, that's fine:** one push sends both versions.

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
The log should say `Applying migration 019_legacy.sql` (and `018_staff_role.sql` if 2.20.0 went
up at the same time), `Registering 19 slash commands` and `Slash commands registered.`

## Step 3: Set up Legacy (in Discord)

Press Cmd + R first.

1. Pick the announcement channel: `/admin channels legacy:#your-channel`
2. Check the year-end award names: `/legacy award-names`
   - Add one: `/legacy award-names action:Add a name name:Promo of the Year`
   - Rename one: `action:Rename name:OMG Moment of the Year new_name:...`
   - Remove one: `action:Remove a name name:...`
3. Add past winners, one at a time:
   `/legacy award accolade:Money in the Bank character:Ace Blackout year:2026`
   - For an old win by a wrestler who has changed hands since, add `player:@whoever played them then`.
   - Add `announce:False` for old wins so the channel isn't flooded.

## Step 4: Look at it

- `/character profile` for a champion: the CHAMPIONSHIPS section lists each belt, and Legacy shows as gold badges.
- `/stats user`: the player card has CHAMPIONSHIPS and LEGACY.
- `/championship records title:World Heavyweight Championship`, or the 📚 Records button on any belt panel.
- `/legacy list`: the honor roll.

---

## If something goes wrong

| What you see | What to do |
|---|---|
| `Authentication failed` | The token is wrong or expired. Make a new one at https://github.com/settings/tokens (classic, tick **repo**). |
| `git push` says "rejected" | Tell me the exact message. |
| Railway deploy shows "Failed" | Copy the last ~20 lines of the log (no tokens or passwords) and send them to me. |
| `/legacy` doesn't show up | Cmd + R in Discord and wait 5 minutes. |
| "isn't on your award list" | Add the name first with `/legacy award-names action:Add a name`. |
