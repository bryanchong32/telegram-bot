# Deployment Guide — Telegram Bots

Deployment is managed by Coolify (self-hosted PaaS) on the Hetzner VPS (5.223.49.206). Pushing to `main` on GitHub triggers automatic builds and deployments.

---

## Architecture

| Service | Dockerfile | Port | Coolify App |
|---------|-----------|------|-------------|
| Bot 1+2 (Personal Assistant + Receipt Tracker) | `Dockerfile` | 3003 | telegram-bots |
| Bot 3 (Request Agent) | `Dockerfile.request-agent` | 3004 | request-agent |

Both containers are built from the same repo (`bryanchong32/telegram-bot`), `main` branch.

---

## How Deployments Work

1. Push code to `main` branch on GitHub
2. Coolify detects the push via GitHub App webhook
3. Coolify builds Docker images using the respective Dockerfiles
4. Coolify replaces old containers with new ones
5. Nginx continues proxying webhook traffic to the container ports

No SSH or manual commands needed for routine deployments.

---

## Environment Variables

Managed in the **Coolify dashboard** (not `.env` files on disk).

Required variables for Bot 1+2:
- `TELEGRAM_BOT1_TOKEN`, `TELEGRAM_BOT2_TOKEN`
- `ALLOWED_TELEGRAM_USER_ID`
- `NOTION_TOKEN`, `NOTION_TASKS_DB_ID`, `NOTION_QUICKNOTES_DB_ID`
- `GEMINI_API_KEY`, `GOOGLE_CLOUD_API_KEY`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`
- `GDRIVE_TASK_REFS_FOLDER_ID`, `GDRIVE_RECEIPTS_FOLDER_ID`, `GSHEETS_EXPENSE_LOG_ID`
- `NODE_ENV=production`, `PORT=3003`, `TZ=Asia/Kuala_Lumpur`

Required variables for Bot 3:
- `REQUEST_AGENT_BOT_TOKEN`, `ALLOWED_TELEGRAM_USER_ID`
- `NOTION_TOKEN`, `GITHUB_TOKEN`
- `GEMINI_API_KEY`
- `NODE_ENV=production`, `PORT=3004`, `TZ=Asia/Kuala_Lumpur`

---

## Persistent Data

Bot 1+2 use SQLite at `/app/data/bot.db`. A Coolify persistent volume is mounted at `/app/data` so the database survives container restarts and redeployments.

---

## Nginx Routing

Nginx proxies webhook paths from `bryan-bots.duckdns.org` to the Docker containers:

| Path | Target |
|------|--------|
| `/webhook/bot1` | localhost:3003 |
| `/webhook/bot2` | localhost:3003 |
| `/webhook/request-agent` | localhost:3004 |
| `/bot-health` | localhost:3003/health |
| `/request-agent-health` | localhost:3004/health |

SSL is managed by Let's Encrypt via Nginx.

---

## Telegram Webhooks

Webhooks are registered to:
- Bot 1: `https://bryan-bots.duckdns.org/webhook/bot1`
- Bot 2: `https://bryan-bots.duckdns.org/webhook/bot2`
- Bot 3: `https://bryan-bots.duckdns.org/webhook/request-agent`

If webhooks need re-registering (e.g., after domain change):
```bash
curl "https://api.telegram.org/bot<BOT1_TOKEN>/setWebhook?url=https://bryan-bots.duckdns.org/webhook/bot1"
curl "https://api.telegram.org/bot<BOT2_TOKEN>/setWebhook?url=https://bryan-bots.duckdns.org/webhook/bot2"
curl "https://api.telegram.org/bot<BOT3_TOKEN>/setWebhook?url=https://bryan-bots.duckdns.org/webhook/request-agent"
```

---

## Verification

1. **Health check (Bot 1+2)**: `curl https://bryan-bots.duckdns.org/bot-health`
2. **Health check (Bot 3)**: `curl https://bryan-bots.duckdns.org/request-agent-health`
3. **Bot 1**: Send `/health` to the Personal Assistant bot in Telegram
4. **Bot 2**: Send `/health` to the Receipt Tracker bot in Telegram
5. **Bot 3**: Send `/health` to the Request Agent bot in Telegram

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Bot not responding | Check Coolify dashboard for container status, restart if needed |
| Build failing | Check Coolify deployment logs for Docker build errors |
| Webhook not receiving | Check Nginx config: `nginx -t`, check container logs in Coolify |
| PDF conversion failing | Verify LibreOffice is installed in the Docker image (see Dockerfile) |
| Notion errors | Check API token in Coolify env vars |
| GitHub commit failing (Bot 3) | Check GITHUB_TOKEN in Coolify env vars — may have expired |
| Google API errors | Refresh token may have expired — re-do OAuth Playground flow |
| Container keeps restarting | Check Coolify logs for crash loop, verify env vars are set |

---

## Coolify Dashboard

Access at: `coolify-solworks.duckdns.org` (port 8000)

From the dashboard you can:
- View container status and logs
- Restart services
- Update environment variables
- View deployment history
- Trigger manual deployments
