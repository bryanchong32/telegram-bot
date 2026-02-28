/**
 * Entry point for the Request Agent bot (Bot 3).
 * Runs as a separate PM2 process on port 3004.
 *
 * Simpler than the main index.js — no SQLite, scheduler, or pending sync.
 * Just Express for webhooks + the bot.
 */

const express = require('express');
const { webhookCallback } = require('grammy');
const config = require('./config');
const { bot3 } = require('./bot');
const logger = require('./logger');

/**
 * Starts the bot with long polling, retrying on 409 conflicts.
 * Same pattern as src/index.js — Telegram keeps stale polling
 * connections for up to 30s after a process dies.
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
  logger.info('Starting Request Agent', { port: config.PORT, env: config.NODE_ENV });

  /* Create Express app */
  const app = express();
  app.use(express.json());

  /* Health endpoint */
  app.get('/health', (req, res) => {
    res.json({ service: 'request-agent', status: 'running' });
  });

  app.get('/', (req, res) => {
    res.json({ service: 'request-agent', status: 'running' });
  });

  /* Start bot — webhook (production) or long polling (development) */
  if (config.NODE_ENV === 'production') {
    app.post('/webhook/request-agent', webhookCallback(bot3, 'express'));
    logger.info('Production mode — webhook route registered');
  } else {
    logger.info('Development mode — resetting stale sessions before polling');
    await bot3.api.deleteWebhook({ drop_pending_updates: true });
    await new Promise((r) => setTimeout(r, 1000));
    startBotWithRetry(bot3, 'Bot 3 (Request Agent)');
  }

  /* Start Express server */
  const server = app.listen(config.PORT, () => {
    logger.info(`Express server listening on port ${config.PORT}`);
  });

  /* Graceful shutdown */
  const shutdown = async (signal) => {
    logger.info(`Received ${signal} — shutting down gracefully`);

    const forceTimer = setTimeout(() => {
      logger.error('Graceful shutdown timed out after 10s — forcing exit');
      process.exit(1);
    }, 10000);
    forceTimer.unref();

    await bot3.stop();
    server.close(() => {
      logger.info('Express server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  logger.info('Request Agent initialised');
}

/* Process-level error handlers */

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  logger.error('Unhandled promise rejection', { error: msg, stack });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception — exiting', { error: err.message, stack: err.stack });
  process.exit(1);
});

main().catch((err) => {
  logger.error('Fatal startup error', { error: err.message, stack: err.stack });
  process.exit(1);
});
