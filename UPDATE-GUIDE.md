# How to install Version 2.20.0 (Mac, step by step)

The new files are already in your **wrestling-bot** folder in Downloads. Nothing changes on
Discord or Railway until you upload them (Step 3). The database change only adds one setting.

**Tell your admins before you install:** `/reign` is now part of `/title` (`/title reign-add`,
`reign-edit`, ...), and the `/admin set-…` settings are now `/admin channels` and `/admin rules`.

---

## Step 1: Open Terminal in your bot folder

Press Cmd + Space, type **Terminal**, press Return. Then type `cd ~/Downloads/wrestling-bot` and press Return.

## Step 2: Remove the old /reign file

Type `git rm src/commands/reign.js` and press Return. (It moved into `/title`.)

## Step 3: Check what changed

Type `git status` and press Return. You should see about 30 files: changed files under `src/`
and `test/`, plus new ones like `src/commands/fnlw.js`, `src/modules/menus.js` and
`src/db/migrations/018_staff_role.sql`, and `src/commands/reign.js` as deleted.

**Stop and tell me if you see `.env` in the list.**

## Step 4: Save and upload

One at a time:

1. `git add .`
2. `git commit -m "Version 2.20.0"`
3. `git push` (password = your GitHub token starting with `ghp_`; nothing shows when you paste it)

## Step 5: Let Railway deploy

Railway → **wrestling-bot** → **Deployments**. Wait for **Active/Success** (about 2 minutes).
The log should say `Applying migration 018_staff_role.sql`, `Registering 18 slash commands`
and `Slash commands registered.`

## Step 6: Set up your staff role (optional but recommended)

1. In Discord, press Cmd + R.
2. `/admin staff-role role:@YourStaffRole`
3. So staff can **see** the admin commands: Server Settings → **Integrations** → your bot →
   click `/admin`, `/card`, `/match` and `/title` one at a time → **Add Roles or Members** →
   pick the staff role → Save.

## Step 7: Try it

1. `/fnlw`: tap through Champions, Next Show, Results, Roster, My Wrestlers and Help.
2. `/whois character:` someone, then try the dropdown and buttons.
3. `/admin channels` and `/admin rules` with nothing filled in: they show your current settings.
4. Fix a tag reign: `/title reign-edit`, pick the tag title and reign, then `character`, `partner`
   and `team_name`.

---

## If something goes wrong

| What you see | What to do |
|---|---|
| `fatal: not a git repository` | You're in the wrong folder. Redo Step 1. |
| `git rm` says "did not match any files" | It's already gone. Carry on with Step 3. |
| `Authentication failed` | The token is wrong or expired. Make a new one at https://github.com/settings/tokens (classic, tick **repo**). |
| Railway deploy shows "Failed" | Copy the last ~20 lines of the log (no tokens or passwords) and send them to me. |
| `/fnlw` doesn't show up | Cmd + R in Discord and wait 5 minutes. Check the Railway log says "Slash commands registered". |
| Staff can't see `/title` or `/card` | Do Step 6.3 for that command. |
