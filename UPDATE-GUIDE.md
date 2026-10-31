# How to install Version 2.19.0 (Mac, step by step)

The new files are already in your **wrestling-bot** folder in Downloads. Nothing changes on
Discord or Railway until you upload them (Step 3). There is **no database change** this time.

---

## Step 1: Open Terminal in your bot folder

Press Cmd + Space, type **Terminal**, press Return. Then type `cd ~/Downloads/wrestling-bot` and press Return.

## Step 2: Check what changed

Type `git status` and press Return. You should see only:

- changed: `CHANGELOG.md`, `README.md`, `UPDATE-GUIDE.md`, `package.json`,
  `src/commands/directory.js`, `src/commands/help.js`, `test/v30.test.js`
- new: `src/commands/whois.js`, `src/modules/rosterList.js`, `src/utils/rosterInfo.js`, `test/v37.test.js`

**Stop and tell me if you see `.env` in the list.**

## Step 3: Save and upload

One at a time:

1. `git add .`
2. `git commit -m "Version 2.19.0"`
3. `git push` (password = your GitHub token starting with `ghp_`; nothing shows when you paste it)

## Step 4: Let Railway deploy

Railway → **wrestling-bot** → **Deployments**. Wait for **Active/Success** (about 2 minutes).
The log should say `Registering 18 slash commands` and `Slash commands registered.`

## Step 5: Try it in Discord

Press Cmd + R in Discord first (new commands can take a few minutes to show up).

1. `/whois character:` and start typing a name, e.g. Ace Blackout. You'll see who plays him and
   all of that player's wrestlers.
2. `/whois player:` and pick someone to see their wrestlers.
3. `/directory list` for the whole roster as text. Try `sort: Grouped by player` too.
4. `/directory roster` still works the same, with the pictures.

---

## If something goes wrong

| What you see | What to do |
|---|---|
| `fatal: not a git repository` | You're in the wrong folder. Redo Step 1. |
| `Authentication failed` | The token is wrong or expired. Make a new one at https://github.com/settings/tokens (classic, tick **repo**). |
| Railway deploy shows "Failed" | Copy the last ~20 lines of the log (no tokens or passwords) and send them to me. |
| `/whois` doesn't show up | Cmd + R in Discord and wait 5 minutes. Check the Railway log says "Slash commands registered". |
