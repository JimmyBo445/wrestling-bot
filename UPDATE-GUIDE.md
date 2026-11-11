# How to install Versions 3.8 → 3.10 (Mac, step by step)

One `git push` uploads everything that's waiting (3.7 report results, 3.8 + 3.9 fewer commands,
3.10 menu post / My requests / bot usage).

**Tell your members** (copy this):
> New: check out #start-here (or wherever you put the menu). Every button there answers only you:
> make a wrestler, see your wrestlers, report a result, and **📨 My requests** to see what's waiting
> for staff (you can cancel a request there too).

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
The log should say `Applying migration 025_menu_usage.sql` (and `024_match_reports.sql` if 3.7 wasn't
uploaded yet) and `Slash commands registered.`

Nothing to change in the Discord Developer Portal: the bot now listens for "a message was posted"
(so the menu can move down), which doesn't need any special switch, and it never reads what people write.

## Step 3: Set up the menu post (in Discord, press Cmd + R first)

1. Make a channel for it, e.g. **#start-here**. The bot needs to be able to **see** the channel,
   **send messages**, **embed links** and **read message history** there.
2. `/admin panel` → **📌 Menu post** → pick the channel. The menu appears there.
3. Press a few of its buttons yourself to check them.
4. Optional: `/admin panel` → **📈 Bot usage** shows what people use. It starts counting from now,
   so give it a week. It's also added to the Monday staff report.

---

## If something goes wrong

| What you see | What to do |
|---|---|
| "I couldn't post in #channel" | Channel settings → Permissions → the bot's role: allow View Channel, Send Messages, Embed Links, Read Message History. |
| The menu doesn't move to the bottom | Same permissions as above, then 📌 Menu post → 🔄 Post it again now. |
| Discord still shows the old long command lists | Press Cmd + R. If it's still there after a few minutes, fully quit Discord and reopen it. |
| `Authentication failed` | The token is wrong or expired. Make a new one at https://github.com/settings/tokens (classic, tick **repo**). |
| Railway deploy shows "Failed" | Copy the last ~20 lines of the log (no tokens or passwords) and send them to me. |
