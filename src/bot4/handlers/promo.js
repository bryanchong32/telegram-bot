/**
 * Promo command handler for Bot 4.
 * Admin-only /promo command to manage active promotions.
 */

const config = require('../config');
const { getActivePromos, addPromo, removePromo } = require('../services/promoStore');

const USAGE = [
  '\u{1F3F7}\uFE0F \u7528\u6CD5:',
  '  /promo list \u2014 \u67E5\u770B\u6240\u6709\u512A\u60E0',
  '  /promo add <name> \u2014 \u65B0\u589E\u512A\u60E0',
  '  /promo remove <name> \u2014 \u79FB\u9664\u512A\u60E0',
].join('\n');

/**
 * Handle /promo commands (admin-only).
 *
 * @param {object} ctx — Telegram bot context
 */
async function handlePromoCommand(ctx) {
  // 1. Admin check
  if (ctx.from.id !== config.ADMIN_TELEGRAM_USER_ID) {
    await ctx.reply('\u26A0\uFE0F \u7121\u6B0A\u9650');
    return;
  }

  // 2. Parse text
  const parts = (ctx.message.text || '').trim().split(/\s+/);
  const subcommand = parts[1] || '';
  const promoName = parts.slice(2).join(' ');

  // 3. Switch on subcommand
  switch (subcommand.toLowerCase()) {
    case 'list': {
      const promos = getActivePromos();
      if (promos.length === 0) {
        await ctx.reply('\u{1F3F7}\uFE0F \u76EE\u524D\u6C92\u6709\u512A\u60E0');
        return;
      }
      const lines = promos.map((p, i) => `${i + 1}. [${p.name}]`);
      await ctx.reply(`\u{1F3F7}\uFE0F \u7576\u524D\u512A\u60E0:\n${lines.join('\n')}`);
      break;
    }

    case 'add': {
      if (!promoName) {
        await ctx.reply(USAGE);
        return;
      }
      const added = addPromo(promoName);
      if (added) {
        await ctx.reply(`\u2705 \u5DF2\u65B0\u589E\u512A\u60E0: [${promoName}]`);
      } else {
        await ctx.reply(`\u26A0\uFE0F \u512A\u60E0 [${promoName}] \u5DF2\u5B58\u5728`);
      }
      break;
    }

    case 'remove': {
      if (!promoName) {
        await ctx.reply(USAGE);
        return;
      }
      const removed = removePromo(promoName);
      if (removed) {
        await ctx.reply(`\u2705 \u5DF2\u79FB\u9664\u512A\u60E0: [${promoName}]`);
      } else {
        await ctx.reply(`\u26A0\uFE0F \u627E\u4E0D\u5230\u512A\u60E0: [${promoName}]`);
      }
      break;
    }

    default:
      await ctx.reply(USAGE);
      break;
  }
}

module.exports = { handlePromoCommand };
