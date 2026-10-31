# How to install Version 2.18.0 (Mac, step by step)

The new files are already in your **wrestling-bot** folder in Downloads. Nothing changes on
Discord or Railway until you upload them (Step 3). There is **no database change** this time.

---

## Step 1: Open Terminal in your bot folder

Press Cmd + Space, type **Terminal**, press Return. Then type `cd ~/Downloads/wrestling-bot` and press Return.

## Step 2: Check what changed

Type `git status` and press Return. You should see only:

- changed: `CHANGELOG.md`, `README.md`, `UPDATE-GUIDE.md`, `package.json`,
  `src/commands/admin.js`, `src/utils/historyChannel.js`, `src/utils/titleImport.js`
- new: `test/v36.test.js`

**Stop and tell me if you see `.env` in the list.**

## Step 3: Save and upload

One at a time:

1. `git add .`
2. `git commit -m "Version 2.18.0"`
3. `git push` (password = your GitHub token starting with `ghp_`; nothing shows when you paste it)

## Step 4: Let Railway deploy

Railway → **wrestling-bot** → **Deployments**. Wait for **Active/Success** (about 2 minutes).

## Step 5: Link characters to your title history

The file **fnlw-title-history-import.csv** in your Downloads folder now has a **character**
column. Ace Blackout is already filled in for his two Showtime reigns.

1. In Discord: `/admin import`, **what: Title history**, attach the file, leave **apply** empty.
   - If you already imported the history: the preview says "no new reigns to add" and that it
     **will link** the character on 2 reigns.
   - If you haven't imported yet: it says 148 reigns are ready.
2. Run it again with **apply: True**.
3. Check `/character profile` for Ace Blackout: his championships now show.

## Filling in more characters later

1. Open the CSV in **Numbers** (double-click it). Type the wrestler's name in the **character**
   column for any reign you remember. Use the name exactly as it is in the bot. For tag titles,
   put both with `&` between them, e.g. `Liv Morgan & Kai Storm`.
2. Save it as CSV: **File → Export To → CSV**, and save it over the old file.
3. Run `/admin import` with the file again (preview first, then **apply: True**).
   Only reigns that don't have a character yet get one. Nothing else changes, so run it as
   often as you like.

To fix just one reign, `/reign edit` (pick the title and reign, then fill in **character**) works too.

---

## If something goes wrong

| What you see | What to do |
|---|---|
| `fatal: not a git repository` | You're in the wrong folder. Redo Step 1. |
| `Authentication failed` | The token is wrong or expired. Make a new one at https://github.com/settings/tokens (classic, tick **repo**). |
| Railway deploy shows "Failed" | Copy the last ~20 lines of the log (no tokens or passwords) and send them to me. |
| "I don't know a wrestler called …" | Check the spelling against `/directory roster`. That reign is still added, just without the character. |
