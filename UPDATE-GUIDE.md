# How to install the Version 2.3 update (Mac, step by step)

(This zip contains the whole bot, so it works whether or not you already installed Version 2.)

You do this on your Mac. It takes about 10 minutes. Nothing here can delete your characters,
matches or titles: the database upgrade only *adds* things.

**Good news:** you do NOT need to run `npm install`, `npm run migrate` or `npm run deploy`.
The bot upgrades its own database and registers its own slash commands every time it starts.

Do the steps in order. Do one step, then the next. Type each command **exactly** as written
and press Return. Only one command at a time.

---

## Step 1: Get the new files onto your Mac

1. Download the file **wrestling-bot-v2.3.zip** I sent you in this chat.
2. Open your **Downloads** folder and double-click the zip. A new folder named
   **wrestling-bot-v2.3** appears next to it. (Your old folder is called **wrestling-bot**.
   Don't mix them up: v2 is the NEW one.)

## Step 2: Open Terminal and go to your old folder

1. Press Cmd + Space, type **Terminal**, press Return.
2. Type this and press Return:

   `cd ~/Downloads/wrestling-bot`

3. Check you are in the right place. Type `ls` and press Return. You should see
   `package.json`, `src`, `README.md` in the list. If you get "no such file or directory",
   your old folder is somewhere else. Tell me where it is and I'll give you the right command.

## Step 3: Copy the new files over the old ones

Type this (it is ONE line) and press Return:

`rsync -a ~/Downloads/wrestling-bot-v2.3/ ~/Downloads/wrestling-bot/`

Nothing prints when it works. This copies the new files in and **keeps** your hidden
settings (`.env`) and git history. Important: do NOT do this by dragging folders in Finder
and clicking "Replace". That can wipe the hidden files. Use the command above.

## Step 4: Check what changed

Type: `git status` and press Return.

- You should see a list of changed/new files, mostly under `src/`.
- **Stop and tell me if you see `.env` in that list.** (It should not be there.)

## Step 5: Save and upload

Run these three commands, one at a time:

1. `git add .`
2. `git commit -m "Version 2.3"`
3. `git push`

`git push` will ask for a **Username** and **Password**:

- Username: your GitHub username (JimmyBo445).
- Password: a **personal access token**, NOT your GitHub password. When you type or paste it,
  **nothing shows on screen. That is normal.** Just paste it and press Return.

### If you need a new token
(You should have deleted the old ones, so you will probably need one now.)

1. Go to https://github.com/settings/tokens
2. **Generate new token** → **Generate new token (classic)**.
3. Note: `wrestling bot`. Expiration: 90 days. Tick the box named **repo**.
4. Scroll down, click **Generate token**, copy the long code that starts with `ghp_`.
5. Paste it at the Password prompt. Never paste it into the chat or into a file.

When it works you'll see a line like `main -> main`. That means the upload succeeded.

## Step 6: Let Railway do its part (about 2 minutes)

1. Go to https://railway.app and open your project → click the **wrestling-bot** service.
2. Click **Deployments**. A new deployment starts by itself. Wait until it says **Active**/**Success**.
3. Click that deployment → **View logs**. You should see lines like:
   - `Logged in as <your bot name>`
   - `Registering 12 slash commands`
   - `Slash commands registered.`

   If you see `Database not ready ... Retrying`, just wait a minute. It retries on its own.

## Step 7: Try it in Discord

1. In Discord press Cmd + R (reloads Discord) so the new slash commands show up.
   (The very first time, new commands can take a few minutes to appear.)
2. Type `/admin settings`. You should get a settings card.
3. Type `/admin set-pending-channel` and pick the channel where approvals should appear.
4. Fix your accidental character: `/character transfer` (pick the character, then choose the
   right owner). Or, if it's a mistake that has no matches yet: `/character remove`.
5. Try `/help`, then `/card auto` (pick RAW or SmackDown and a division), `/character profile`. Have fun!

---

## If something goes wrong

| What you see | What to do |
|---|---|
| `fatal: not a git repository` | You're in the wrong folder. Redo Step 2. |
| `git push` says "rejected" | Tell me the exact message. |
| `Authentication failed` | The token is wrong/expired. Make a new one (Step 5). |
| Railway deploy shows "Failed" | Click the deployment, copy the last ~20 lines of the log, and send them to me. (Make sure no tokens or passwords are in what you copy.) |
| Slash commands look old / missing | Cmd + R in Discord; wait 5 minutes; check the Railway log says "Slash commands registered". |
| Commands appear **twice** | Tell me. It means old per-server commands are left over. |

## Optional: instant command updates

Add a variable named `GUILD_ID` on the Railway bot service, with your server's ID as the value
(Discord → Settings → Advanced → turn on Developer Mode, then right-click your server's icon → Copy Server ID).
Then new slash commands show up immediately in your server after each update.

## Future updates

Each time I send you a new version it's the same: Step 1, then Steps 2 to 7. Steps 3 to 7 are the same every time.
