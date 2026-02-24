/**
 * One-time script: Sets the Telegram webhook URLs for both bots.
 * Run this AFTER Nginx + SSL are configured on the VPS.
 *
 * Default domain: ecomwave.duckdns.org (same as CRM — SSL already configured).
 * Override: WEBHOOK_DOMAIN=custom.domain.com node scripts/set-webhooks.js
 */

require('dotenv').config();

const DOMAIN = process.env.WEBHOOK_DOMAIN || 'ecomwave.duckdns.org';
console.log(`Using domain: ${DOMAIN}`);

const BOT1_TOKEN = process.env.TELEGRAM_BOT1_TOKEN;
const BOT2_TOKEN = process.env.TELEGRAM_BOT2_TOKEN;

async function setWebhook(token, path, label) {
  const url = `https://${DOMAIN}${path}`;
  const apiUrl = `https://api.telegram.org/bot${token}/setWebhook`;

  console.log(`Setting ${label} webhook → ${url}`);

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  const result = await response.json();
  if (result.ok) {
    console.log(`✅ ${label} webhook set successfully`);
  } else {
    console.error(`❌ ${label} webhook failed:`, result.description);
  }
}

async function main() {
  await setWebhook(BOT1_TOKEN, '/webhook/bot1', 'Bot 1 (Personal Assistant)');
  await setWebhook(BOT2_TOKEN, '/webhook/bot2', 'Bot 2 (Receipt Tracker)');
  console.log('\nDone!');
}

main().catch(console.error);
