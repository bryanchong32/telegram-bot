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
const logger = require('./utils/logger');

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
    /* Development: Use long polling (no webhook needed, works without a public URL) */
    logger.info('Development mode — starting long polling for both bots');
    bot1.start({
      onStart: () => logger.info('Bot 1 (Personal Assistant) started — long polling'),
    });
    bot2.start({
      onStart: () => logger.info('Bot 2 (Receipt Tracker) started — long polling'),
    });
  }

  /* 6. Start Express server (always, for health endpoint + webhooks in production) */
  const server = app.listen(config.PORT, () => {
    logger.info(`Express server listening on port ${config.PORT}`);
  });

  /* 7. Graceful shutdown handler */
  const shutdown = async (signal) => {
    logger.info(`Received ${signal} — shutting down gracefully`);
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
