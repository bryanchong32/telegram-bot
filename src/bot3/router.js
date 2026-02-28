/**
 * Bot 3 — Request Agent message router.
 *
 * Routes:
 * - /start, /help, /health — usage info + health check
 * - Document (.md file) → parse → GitHub commit → Notion entry → confirm
 * - Any other message → friendly nudge to send a .md file
 */

const { parseFrontmatter, splitSections } = require('./parser');
const { commitFiles } = require('./github');
const { createRequestEntry } = require('./notion');
const projects = require('./projects');
const logger = require('./logger');

/* ─── Message dedup ─── */

/* Tracks recently processed message IDs to prevent duplicate processing.
   Telegram retries webhook delivery when response is slow (GitHub + Notion
   can take a few seconds). Using a Map with TTL cleanup. */
const processedMessages = new Map();
const DEDUP_TTL_MS = 5 * 60 * 1000; /* 5 minutes */

/**
 * Returns true if this message was already processed (duplicate).
 * Cleans up expired entries on each call.
 */
function isDuplicate(messageId) {
  const now = Date.now();
  for (const [id, ts] of processedMessages) {
    if (now - ts > DEDUP_TTL_MS) processedMessages.delete(id);
  }
  if (processedMessages.has(messageId)) return true;
  processedMessages.set(messageId, now);
  return false;
}

/**
 * Registers all command and message handlers on the bot instance.
 */
function registerRouter(bot) {

  /* ─── Commands ─── */

  bot.command('start', async (ctx) => {
    logger.info('Bot 3 /start', { chatId: ctx.chat.id });
    await ctx.reply(
      'Hey! I\'m the Request Agent.\n\n' +
      'Send me a .md file from a scoping session and I\'ll:\n' +
      '  1. Commit PRD, Decision Notes, and CC Instructions to GitHub\n' +
      '  2. Create a Notion tracking entry\n' +
      '  3. Confirm when everything is filed\n\n' +
      'Just send the file — I handle the rest.'
    );
  });

  bot.command('help', async (ctx) => {
    logger.info('Bot 3 /help', { chatId: ctx.chat.id });
    await ctx.reply(
      'Request Agent — Help\n\n' +
      'How to use:\n' +
      '  1. Finish a scoping session in Claude Chat\n' +
      '  2. Download the combined .md file\n' +
      '  3. Send it here\n\n' +
      'The file must have:\n' +
      '  - YAML frontmatter (request_id, project, title, etc.)\n' +
      '  - Three sections: # PRD, # DECISION NOTES, # CLAUDE CODE INSTRUCTIONS\n\n' +
      'Valid projects: ' + Object.keys(projects).join(', ')
    );
  });

  /* /health — simple health check via Telegram */
  bot.command('health', async (ctx) => {
    logger.info('Bot 3 /health', { chatId: ctx.chat.id });
    await ctx.reply('Request Agent is running.');
  });

  /* ─── Document Processing ─── */

  bot.on('message:document', async (ctx) => {
    /* Dedup — Telegram retries webhook delivery if processing is slow.
       Skip if we've already started processing this exact message. */
    if (isDuplicate(ctx.message.message_id)) {
      logger.warn('Duplicate request message skipped', { messageId: ctx.message.message_id });
      return;
    }
    await handleDocument(ctx);
  });

  /* ─── Catch-all for non-document messages ─── */

  bot.on('message', async (ctx) => {
    await ctx.reply('Send me a .md file from a scoping session to file it.');
  });
}

/**
 * Full document processing pipeline.
 * Each step is tracked so we can report exactly where a failure occurred
 * and which steps already succeeded (partial success).
 */
async function handleDocument(ctx) {
  const completed = [];

  try {
    /* ─── Step 1: Validate file extension ─── */
    const fileName = ctx.message.document.file_name || '';
    if (!fileName.toLowerCase().endsWith('.md')) {
      await ctx.reply(
        'Please send a markdown (.md) file.\n' +
        `Got: "${fileName}"`
      );
      return;
    }

    /* ─── Step 2: Download file from Telegram ─── */
    const file = await ctx.api.getFile(ctx.message.document.file_id);
    if (!file.file_path) {
      throw new Error('Telegram returned no file_path — file may be too large');
    }

    const downloadUrl = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new Error(`File download failed: HTTP ${response.status}`);
    }

    const content = await response.text();
    completed.push('File downloaded');

    /* ─── Step 3: Parse frontmatter ─── */
    const { meta, body } = parseFrontmatter(content);
    completed.push('Frontmatter parsed');

    /* ─── Step 4: Validate project exists in config ─── */
    const projectConfig = projects[meta.project];
    if (!projectConfig) {
      await ctx.reply(
        `Unknown project: "${meta.project}"\n\n` +
        'Valid projects:\n' +
        Object.keys(projects).map((k) => `  - ${k}`).join('\n')
      );
      return;
    }
    completed.push('Project validated');

    /* ─── Step 5: Split into 3 sections ─── */
    const { prd, decisionNotes, ccInstructions } = splitSections(body);
    completed.push('Sections split');

    /* ─── Step 6: Send processing status ─── */
    await ctx.reply(`Filing ${meta.request_id}...`);

    /* ─── Step 7: Commit to GitHub ─── */
    const [owner, repo] = projectConfig.github_repo.split('/');
    const docsPath = projectConfig.docs_path;

    const { commitSha } = await commitFiles({
      owner,
      repo,
      branch: projectConfig.github_branch,
      files: [
        { path: `${docsPath}/${meta.request_id}/PRD.md`, content: prd },
        { path: `${docsPath}/${meta.request_id}/DECISION-NOTES.md`, content: decisionNotes },
        { path: `${docsPath}/${meta.request_id}/CC-INSTRUCTIONS.md`, content: ccInstructions },
      ],
      message: `docs: add ${meta.request_id} - ${meta.title}`,
    });
    completed.push('GitHub commit');

    /* ─── Step 8: Construct GitHub URLs ─── */
    const baseUrl = `https://github.com/${projectConfig.github_repo}/blob/${projectConfig.github_branch}/${docsPath}/${meta.request_id}`;
    const githubUrls = {
      prd: `${baseUrl}/PRD.md`,
      decisionNotes: `${baseUrl}/DECISION-NOTES.md`,
      ccInstructions: `${baseUrl}/CC-INSTRUCTIONS.md`,
    };

    /* ─── Step 9: Create Notion entry ─── */
    await createRequestEntry({
      meta,
      githubUrls,
      notionDatabaseId: projectConfig.notion_database_id,
    });
    completed.push('Notion entry');

    /* ─── Step 10: Confirmation message ─── */
    await ctx.reply(
      `✅ ${meta.request_id} filed\n\n` +
      `${meta.title}\n` +
      `Project: ${meta.project}\n` +
      `Priority: ${meta.priority} | Effort: ${meta.effort}\n` +
      `Status: Scoped\n\n` +
      `📁 Docs committed to GitHub\n` +
      `📋 Notion entry created\n\n` +
      `Ready for build.`
    );

    logger.info('Request filed successfully', {
      requestId: meta.request_id,
      project: meta.project,
      commitSha,
    });

  } catch (err) {
    logger.error('Request filing failed', {
      error: err.message,
      stack: err.stack,
      completed,
    });

    let errorMsg = `❌ Filing failed\n\nStep: ${getFailedStep(completed)}\nError: ${err.message}`;

    if (completed.length > 0) {
      errorMsg += `\n\nCompleted before failure:\n${completed.map((s) => `  ✅ ${s}`).join('\n')}`;
    }

    errorMsg += '\n\nFix and resend, or file manually in Notion.';

    await ctx.reply(errorMsg).catch(() => {
      logger.error('Failed to send error message to user');
    });
  }
}

/**
 * Determines which step failed based on what completed successfully.
 */
function getFailedStep(completed) {
  /* Must match the order of completed.push() calls in handleDocument:
     0: File downloaded → 1: Frontmatter parsed → 2: Project validated →
     3: Sections split → 4: GitHub commit → 5: Notion entry */
  const steps = [
    'File download',
    'Frontmatter parsing',
    'Project validation',
    'Section splitting',
    'GitHub commit',
    'Notion entry creation',
  ];

  return steps[completed.length] || 'Unknown';
}

module.exports = { registerRouter };
