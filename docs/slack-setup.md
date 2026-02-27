# Slack App Setup Guide

This guide walks through creating and configuring the Slack app for Goose from scratch.

---

## Step 1 — Create the App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App → From scratch**
3. Name it `Goose` (or whatever you prefer)
4. Select your workspace → **Create App**

---

## Step 2 — Enable Socket Mode & Get App Token

Socket Mode lets the bot connect via WebSocket — no public URL or ngrok required.

1. Left sidebar → **Settings → Socket Mode**
2. Toggle **Enable Socket Mode** on
3. You'll be prompted to create an App-Level Token:
   - **Token Name:** `socket-token` (anything works)
   - **Scope:** `connections:write`
   - Click **Generate**
4. Copy the `xapp-...` token → this is your **`SLACK_APP_TOKEN`** in `.env`

---

## Step 3 — Add Bot Scopes

1. Left sidebar → **OAuth & Permissions**
2. Scroll down to **Scopes → Bot Token Scopes**
3. Click **Add an OAuth Scope** and add each of the following:

| Scope | Why it's needed |
|---|---|
| `chat:write` | Post and update messages |
| `commands` | Receive `/agent` slash command |
| `im:history` | Read DM message history |
| `im:read` | Access DM channel info |
| `im:write` | Send DMs to users |

---

## Step 4 — Install the App & Get Bot Token

1. Still on **OAuth & Permissions**, scroll to the top
2. Click **Install to Workspace** → **Allow**
3. Copy the **Bot User OAuth Token** (`xoxb-...`) → this is your **`SLACK_BOT_TOKEN`** in `.env`

> If you add more scopes later, you'll need to reinstall the app to apply them.

---

## Step 5 — Get the Signing Secret

1. Left sidebar → **Basic Information**
2. Scroll to **App Credentials**
3. Copy the **Signing Secret** → this is your **`SLACK_SIGNING_SECRET`** in `.env`

---

## Step 6 — Create the `/agent` Slash Command

1. Left sidebar → **Slash Commands**
2. Click **Create New Command**
3. Fill in:
   - **Command:** `/agent`
   - **Request URL:** `https://placeholder.example.com` *(Socket Mode ignores this field)*
   - **Short Description:** `Ask Goose to do something`
   - **Usage Hint:** `<your task here>`
4. Click **Save**

---

## Step 7 — Enable DM Events

1. Left sidebar → **Event Subscriptions**
2. Toggle **Enable Events** on
3. Under **Subscribe to bot events**, click **Add Bot User Event**
4. Search for and add: `message.im`
5. Click **Save Changes**

---

## Step 8 — Enable the Messages Tab (required for DMs)

This step is easy to miss — without it, users will see *"Sending messages to this app has been turned off"* when trying to DM the bot.

1. Left sidebar → **App Home**
2. Scroll down to **Show Tabs**
3. Toggle **Messages Tab** on
4. Check the box: **"Allow users to send Slash commands and messages from the messages tab"**

---

## Step 9 — Reinstall the App

After making scope or feature changes, Slack will show a yellow banner. Click **reinstall your app** and re-authorise to apply all changes.

---

## Step 10 — Fill in `.env`

```bash
cp .env.example .env
```

Open `.env` and populate with the values collected above:

```env
SLACK_BOT_TOKEN=xoxb-...          # Step 4
SLACK_APP_TOKEN=xapp-...          # Step 2
SLACK_SIGNING_SECRET=...          # Step 5

OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=qwen2.5:14b

AGENT_NAME=Goose
MAX_TOOL_ITERATIONS=10
REQUIRE_APPROVAL=true
ALLOWED_PATHS=/Users
```

---

## Step 11 — Start the Bot

```bash
npm start
```

You should see:

```
  Agent name : Goose
  Model      : qwen2.5:14b
  Ollama host: http://localhost:11434

✅ Goose is online and listening in Slack.
```

---

## Verification Checklist

- [ ] `/agent what time is it?` responds in a channel
- [ ] DM-ing the bot works (no "turned off" message)
- [ ] `/agent run the command: echo hello` shows Approve/Deny buttons
- [ ] Clicking **Approve** runs the command and returns output
- [ ] Clicking **Deny** skips execution
- [ ] `clear memory` in a DM resets conversation history

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "Sending messages to this app has been turned off" | Messages Tab not enabled | Step 8 above |
| `/agent` command not found | Slash command not created or app not reinstalled | Steps 6 & 9 |
| Bot doesn't respond at all | Wrong tokens in `.env` or bot not running | Check terminal for errors |
| Approve/Deny buttons don't work | `interactivity` not enabled | Left sidebar → Interactivity & Shortcuts → turn on |
| Bot responds but no tool results | Ollama not running or wrong model name | Run `ollama list` to check |
