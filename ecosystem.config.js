/**
 * PM2 ecosystem configuration.
 * Runs the bot process under the `deploy` user on the VPS.
 *
 * Usage (on VPS, as deploy user):
 *   pm2 start ecosystem.config.js
 *   pm2 save
 */

module.exports = {
  apps: [
    {
      name: 'telegram-bots',
      script: 'src/index.js',
      cwd: '/home/deploy/telegram-bots',
      node_args: '--env-file=.env',
      env: {
        NODE_ENV: 'production',
        PORT: 3003,
        TZ: 'Asia/Kuala_Lumpur',
      },
      /* Restart policy */
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
      /* Logging */
      error_file: '/home/deploy/telegram-bots/logs/error.log',
      out_file: '/home/deploy/telegram-bots/logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      /* Watch (disabled in production — use pm2 restart instead) */
      watch: false,
    },
  ],
};
