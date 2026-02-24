/**
 * Entry point — initialises both Telegram bots, SQLite, scheduler workers,
 * and the Express server for webhook endpoints + health check.
 *
 * Runs as a single Node.js process on port 3003, managed by PM2.
 */

const express = require('express');
const { webhookCallback } = require('grammy');
const config = require('./shared/config');
const { initTables } = require('./shared/db');
const { bot1 } = require('./bot1/bot');
const { bot2 } = require('./bot2/bot');
const { startScheduler, stopScheduler } = require('./shared/scheduler');
const { startPendingSyncWorker, stopPendingSyncWorker } = require('./shared/pendingSync');
const { runHealthChecks, formatHealthMessage } = require('./utils/health');
const { restoreOpenDrafts, clearAllState } = require('./bot1/notes/buffer');
const logger = require('./utils/logger');

/**
 * Starts a bot with long polling, retrying on 409 conflicts.
 * Telegram keeps stale polling connections for up to 30s after a process dies.
 * This retries up to 5 times with 5s delays to wait it out.
 */
function startBotWithRetry(bot, label, attempt = 0) {
  const maxAttempts = 5;

  bot.start({
    drop_pending_updates: true,
    onStart: () => logger.info(`${label} started — long polling`),
  }).catch((err) => {
    if (err.error_code === 409 && attempt < maxAttempts) {
      logger.warn(`${label} got 409 conflict, retrying in 5s (attempt ${attempt + 1}/${maxAttempts})`);
      setTimeout(() => startBotWithRetry(bot, label, attempt + 1), 5000);
    } else {
      logger.error(`${label} failed to start`, { error: err.message });
    }
  });
}

async function main() {
  logger.info('Starting Telegram Bots', { port: config.PORT, env: config.NODE_ENV });

  /* 1. Initialise SQLite tables */
  initTables();

  /* 2. Register /health command on both bots (needs db to be ready) */
  bot1.command('health', async (ctx) => {
    await ctx.reply('Running health checks...');
    const results = await runHealthChecks();
    await ctx.reply(formatHealthMessage(results));
  });

  bot2.command('health', async (ctx) => {
    await ctx.reply('Running health checks...');
    const results = await runHealthChecks();
    await ctx.reply(formatHealthMessage(results));
  });

  /* 3. Create Express app for HTTP health endpoint (always available) */
  const app = express();

  /* HTTP health endpoint — for external monitoring / Nginx checks */
  app.get('/health', async (req, res) => {
    const results = await runHealthChecks();
    const statusCode = results.status === 'ok' ? 200 : 503;
    res.status(statusCode).json(results);
  });

  /* Root endpoint — simple alive check */
  app.get('/', (req, res) => {
    res.json({ service: 'telegram-bots', status: 'running' });
  });

  /* 4. Start background workers */
  startScheduler();
  startPendingSyncWorker();

  /* 5. Start bots — webhook mode (production) or long polling (development) */
  if (config.NODE_ENV === 'production') {
    /* Production: Register webhook routes on Express, then start the server.
       Webhook URLs are set via the deployment script after Nginx is configured. */
    app.post('/webhook/bot1', webhookCallback(bot1, 'express'));
    app.post('/webhook/bot2', webhookCallback(bot2, 'express'));
    logger.info('Production mode — webhook routes registered');
  } else {
    /* Development: Use long polling (no webhook needed, works without a public URL).
       Reset any stale polling sessions first via deleteWebhook, wait for Telegram
       to release the connection, then start polling. */
    logger.info('Development mode — resetting stale sessions before polling');

    /* Call deleteWebhook with drop_pending_updates to clear any stale getUpdates */
    await bot1.api.deleteWebhook({ drop_pending_updates: true });
    await bot2.api.deleteWebhook({ drop_pending_updates: true });
    logger.info('Stale sessions cleared — waiting for Telegram to release');
    await new Promise((r) => setTimeout(r, 1000));

    /* Start polling — catch 409 conflicts and retry instead of crashing */
    startBotWithRetry(bot1, 'Bot 1 (Personal Assistant)');
    startBotWithRetry(bot2, 'Bot 2 (Receipt Tracker)');
  }

  /* 5b. Restore open drafts from SQLite (VPS restart safety) */
  restoreOpenDrafts(bot1).catch((err) => {
    logger.error('Draft restoration failed', { error: err.message });
  });

  /* 6. Start Express server (always, for health endpoint + webhooks in production) */
  const server = app.listen(config.PORT, () => {
    logger.info(`Express server listening on port ${config.PORT}`);
  });

  /* 7. Graceful shutdown handler */
  const shutdown = async (signal) => {
    logger.info(`Received ${signal} — shutting down gracefully`);
    clearAllState();
    stopScheduler();
    stopPendingSyncWorker();
    await bot1.stop();
    await bot2.stop();
    server.close(() => {
      logger.info('Express server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  logger.info('All systems initialised');
}

/* Run the main function and catch any startup errors */
main().catch((err) => {
  logger.error('Fatal startup error', { error: err.message, stack: err.stack });
  process.exit(1);
});
