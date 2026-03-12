/**
 * Entry point for the Order Entry Bot (Bot 4).
 * Runs as a separate Coolify container on port 3006.
 */

const express = require('express');
const { webhookCallback } = require('grammy');
const config = require('./config');
const { bot4 } = require('./bot');
const logger = require('./logger');
const promoStore = require('./services/promoStore');
const pendingOrderStore = require('./services/pendingOrderStore');

/**
 * Starts the bot with long polling, retrying on 409 conflicts.
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
  logger.info('Starting Order Entry Bot', { port: config.PORT, env: config.NODE_ENV });

  /* Load persisted data */
  promoStore.load();
  pendingOrderStore.loadFromDisk();

  /* Create Express app */
  const app = express();
  app.use(express.json());

  /* Health endpoint */
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', bot: 'bot4-order', uptime: Math.floor(process.uptime()) });
  });

  app.get('/', (req, res) => {
    res.send('Bot 4 (Order Entry) is running.');
  });

  /* Start bot — webhook (production) or long polling (development) */
  if (config.NODE_ENV === 'production') {
    app.post('/webhook/order-bot', webhookCallback(bot4, 'express'));
    logger.info('Production mode — webhook route registered', { path: '/webhook/order-bot' });
  } else {
    logger.info('Development mode — resetting stale sessions before polling');
    await bot4.api.deleteWebhook({ drop_pending_updates: true });
    await new Promise((r) => setTimeout(r, 1000));
    startBotWithRetry(bot4, 'Bot 4 (Order Entry)');
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

    await bot4.stop();
    server.close(() => {
      logger.info('Express server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  logger.info('Order Entry Bot initialised');
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
