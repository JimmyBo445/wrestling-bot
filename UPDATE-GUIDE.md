# How to install Version 2.17.0 (Mac, step by step)

This time there is **no zip**. The new files are already in your **wrestling-bot** folder
in Downloads. Nothing changes on Discord or Railway until you upload them (Step 3).

Nothing here can delete your characters, matches or titles. The database upgrade only *adds*
a setting and one small table.

**You do NOT need** `npm install`, `npm run migrate` or `npm run deploy`. The bot upgrades its
database and registers its commands by itself when it starts.

---

## Step 1: Open Terminal in your bot folder

1. Press Cmd + Space, type **Terminal**, press Return.
2. Type `cd ~/Downloads/wrestling-bot` and press Return.

## Step 2: Check what changed

Type `git status` and press Return. You should see these, and nothing else:

- changed: `CHANGELOG.md`, `README.md`, `UPDATE-GUIDE.md`, `package.json`,
  `src/commands/admin.js`, `src/index.js`, `src/modules/titleExtras.js`, `src/utils/audit.js`, `test/v27.test.js`
- new: `src/db/migrations/017_history_channel.sql`, `src/utils/historyChannel.js`,
  `src/utils/titleImport.js`, `test/v35.test.js`

**Stop and tell me if you see `.env` in the list.**

## Step 3: Save and upload

Run these three commands, one at a time:

1. `git add .`
2. `git commit -m "Version 2.17.0"`
3. `git push`

For the password, paste your GitHub **personal access token** (nothing shows on screen, that's
normal). If you need a new one: https://github.com/settings/tokens → Generate new token (classic)
→ tick **repo** → Generate → copy the code starting with `ghp_`. Never paste it into the chat.

## Step 4: Let Railway deploy (about 2 minutes)

Railway → your project → **wrestling-bot** → **Deployments**. Wait for **Active/Success**, then
**View logs**. You should see `Applying migration 017_history_channel.sql` and
`Slash commands registered.`

## Step 5: Load your title history (in Discord)

Press Cmd + R in Discord first so the new options show up.

1. Type `/admin import`, pick **what: Title history (old reigns)**, attach
   **fnlw-title-history-import.csv** (it's in your Downloads folder), leave **apply** empty.
   This is only a **preview**. It should say **148** reigns are ready.
   - If it lists lines that **overlap** a reign already in the bot, that's a reign you already
     logged with the bot. Those lines are skipped, nothing is changed. Send me the list if
     the bot's version is wrong.
2. Run the same command again with **apply: True**.
3. Check one title: `/championship history title:World Heavyweight Championship`.

## Step 6: Turn on the history channel

1. `/admin history channel:#🏆 | history`. The bot posts every title's history there.
2. Delete the old hand-written history posts in that channel if you want. Don't delete the
   bot's messages; if you do, it just reposts the whole history.
3. From now on, every title change updates the channel by itself a few seconds later.
   - Turn that off: `/admin history auto:Off`. Then run `/admin history` (nothing filled in)
     whenever you want it updated.
   - Turn it back on: `/admin history auto:On`.
   - Fix a reign by hand any time: `/reign add`, `/reign edit`, `/reign remove`,
     `/reign add-defense`. The channel follows.

---

## If something goes wrong

| What you see | What to do |
|---|---|
| `fatal: not a git repository` | You're in the wrong folder. Redo Step 1. |
| `git push` says "rejected" | Tell me the exact message. |
| `Authentication failed` | The token is wrong or expired. Make a new one (Step 3). |
| Railway deploy shows "Failed" | Copy the last ~20 lines of the log (no tokens or passwords) and send them to me. |
| `/admin history` is missing | Cmd + R in Discord and wait a few minutes. |
| "I can't reach the history channel" | Give the bot permission to see and send messages in that channel. |
