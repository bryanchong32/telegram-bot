# Deployment Guide — Telegram Bots

Step-by-step instructions for deploying both bots to the Hetzner VPS (5.223.49.206).

---

## Prerequisites

- SSH access to VPS as root (then switch to deploy user)
- Node.js 20+ installed on VPS
- PM2 installed under `deploy` user
- Nginx + certbot already configured (from ECOMWAVE CRM)
- LibreOffice for Office→PDF conversion: `apt-get install libreoffice`

---

## Step 1: Upload Code to VPS

From your local machine (in the telegram-bot directory):

```bash
# Create the project directory on VPS
ssh root@5.223.49.206 "mkdir -p /home/deploy/telegram-bots/logs && chown -R deploy:deploy /home/deploy/telegram-bots"

# Upload code (exclude node_modules, data, .env)
scp -r src/ scripts/ nginx/ package.json package-lock.json ecosystem.config.js .env.example root@5.223.49.206:/home/deploy/telegram-bots/

# Fix ownership
ssh root@5.223.49.206 "chown -R deploy:deploy /home/deploy/telegram-bots"
```

---

## Step 2: Create .env on VPS

```bash
ssh root@5.223.49.206
su - deploy
cd /home/deploy/telegram-bots
cp .env.example .env
nano .env  # Fill in all values
```

Required environment variables (all must be set for production):
- `TELEGRAM_BOT1_TOKEN` — from @BotFather
- `TELEGRAM_BOT2_TOKEN` — from @BotFather
- `ALLOWED_TELEGRAM_USER_ID` — Bryan's Telegram user ID
- `NOTION_TOKEN` — from notion.so/my-integrations
- `NOTION_TASKS_DB_ID` — Master Tasks database ID
- `NOTION_QUICKNOTES_DB_ID` — Quick Notes database ID
- `ANTHROPIC_API_KEY` — Claude API key
- `GOOGLE_CLIENT_ID` — from GCP console
- `GOOGLE_CLIENT_SECRET` — from GCP console
- `GOOGLE_REFRESH_TOKEN` — from OAuth Playground
- `GDRIVE_TASK_REFS_FOLDER_ID` — TaskRefs root folder
- `GDRIVE_RECEIPTS_FOLDER_ID` — Receipts root folder
- `GSHEETS_EXPENSE_LOG_ID` — Expense Log spreadsheet
- `NODE_ENV=production`
- `PORT=3003`
- `TZ=Asia/Kuala_Lumpur`

---

## Step 3: Install Dependencies

```bash
su - deploy
cd /home/deploy/telegram-bots
npm ci --production
```

---

## Step 4: Create data/ Directory

```bash
mkdir -p /home/deploy/telegram-bots/data
```

SQLite database is created automatically on first run.

---

## Step 5: Configure Nginx

Add the webhook location blocks to the existing ecomwave Nginx config:

```bash
# As root:
nano /etc/nginx/sites-available/ecomwave
```

Add these inside the `server { listen 443 ssl; ... }` block (AFTER existing CRM locations):

```nginx
# Bot 1 webhook — Personal Assistant
location /webhook/bot1 {
    proxy_pass http://127.0.0.1:3003/webhook/bot1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# Bot 2 webhook — Receipt Tracker
location /webhook/bot2 {
    proxy_pass http://127.0.0.1:3003/webhook/bot2;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# Bot health check
location /bot-health {
    proxy_pass http://127.0.0.1:3003/health;
    proxy_set_header Host $host;
}
```

Test and reload:
```bash
nginx -t && systemctl reload nginx
```

---

## Step 6: Start with PM2

**CRITICAL: Always use the `deploy` user for PM2. Never run PM2 as root.**

```bash
su - deploy
cd /home/deploy/telegram-bots
pm2 start ecosystem.config.js
pm2 save
```

Verify it's running:
```bash
pm2 status
pm2 logs telegram-bots --lines 20
```

---

## Step 7: Set Telegram Webhooks

From the VPS (as deploy user):

```bash
cd /home/deploy/telegram-bots
node scripts/set-webhooks.js
```

This sets both bots to receive updates via `https://ecomwave.duckdns.org/webhook/bot1` and `/webhook/bot2`.

---

## Step 8: Verify Deployment

1. **Health check**: `curl https://ecomwave.duckdns.org/bot-health`
2. **Bot 1**: Send `/health` to the Personal Assistant bot in Telegram
3. **Bot 2**: Send `/health` to the Receipt Tracker bot in Telegram
4. **Test Bot 1**: Send "show today's tasks"
5. **Test Bot 2**: Send a receipt photo

---

## Ongoing Operations

### Restarting after code update
```bash
# Upload new code
scp -r src/ root@5.223.49.206:/home/deploy/telegram-bots/
ssh root@5.223.49.206 "chown -R deploy:deploy /home/deploy/telegram-bots"

# Restart (ALWAYS as deploy user)
ssh root@5.223.49.206 "su - deploy -c 'cd /home/deploy/telegram-bots && pm2 restart telegram-bots && pm2 save'"
```

### Viewing logs
```bash
su - deploy
pm2 logs telegram-bots --lines 50
# or
tail -f /home/deploy/telegram-bots/logs/out.log
```

### Checking process status
```bash
su - deploy -c 'pm2 status'
```

### VPS restart recovery
PM2 auto-starts saved processes on boot. The app also:
- Restores open draft buffers from SQLite
- Re-runs missed scheduler triggers from the last 24 hours
- Reconnects to all external services automatically

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Bot not responding | `su - deploy -c 'pm2 restart telegram-bots'` |
| 409 conflict on startup | Normal — Telegram keeps old connections for ~30s. The bot retries automatically. |
| Webhook not receiving | Check Nginx: `nginx -t`, check logs: `pm2 logs telegram-bots` |
| PDF conversion failing | Install LibreOffice: `apt-get install libreoffice` |
| Notion errors | Check API token in .env, check /health |
| Google API errors | Refresh token may have expired — re-do OAuth Playground flow |
