# Request Agent Bot — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Telegram bot that receives a markdown file, commits 3 documents to GitHub, creates a Notion entry, and confirms via Telegram.

**Architecture:** Separate PM2 process (port 3004) in `src/bot3/`. Self-contained — own config, logger, Express server. Reuses `grammy` and `@notionhq/client` packages. Raw `fetch()` for GitHub API. `gray-matter` for frontmatter parsing.

**Tech Stack:** Node.js, grammY (Telegram), @notionhq/client (Notion), gray-matter (YAML), native fetch (GitHub API), Express (webhooks)

**Reference files to study before starting:**
- `src/shared/config.js` — env var loading pattern to replicate
- `src/bot2/bot.js` — grammY bot setup pattern to replicate
- `src/bot2/router.js` — message handling + file download pattern to replicate
- `src/utils/notion.js` — Notion client + retry pattern to replicate
- `src/utils/logger.js` — JSON structured logging pattern to replicate
- `src/index.js` — Express + webhook + shutdown pattern to replicate
- `ecosystem.config.js` — PM2 config to extend

---

## Task 1: Install dependency + create bot3 directory

**Files:**
- Modify: `package.json` (via npm install)
- Create: `src/bot3/` directory

**Step 1: Install gray-matter**

Run: `npm install gray-matter`
Expected: Added to package.json dependencies

**Step 2: Create the bot3 directory**

Run: `mkdir src/bot3`

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add gray-matter dependency for request agent"
```

---

## Task 2: Config + projects + logger

Foundation modules that everything else imports from.

**Files:**
- Create: `src/bot3/config.js`
- Create: `src/bot3/projects.js`
- Create: `src/bot3/logger.js`

**Step 1: Create `src/bot3/config.js`**

Self-contained env loader. Same pattern as `src/shared/config.js` but only loads bot3 vars. Must call `dotenv.config()` itself since this is a separate process.

```js
/**
 * Bot 3 — Request Agent configuration.
 * Separate from shared/config.js because this runs as its own PM2 process
 * and doesn't need Bot 1/2 env vars (Gemini, Google OAuth, etc.).
 */

require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name, fallback) {
  return process.env[name] || fallback;
}

module.exports = {
  REQUEST_AGENT_BOT_TOKEN: required('REQUEST_AGENT_BOT_TOKEN'),
  ALLOWED_TELEGRAM_USER_ID: Number(required('ALLOWED_TELEGRAM_USER_ID')),
  NOTION_TOKEN: required('NOTION_TOKEN'),
  GITHUB_TOKEN: required('GITHUB_TOKEN'),
  NODE_ENV: optional('NODE_ENV', 'development'),
  PORT: Number(optional('PORT', '3004')),
  TZ: optional('TZ', 'Asia/Kuala_Lumpur'),
};
```

**Step 2: Create `src/bot3/projects.js`**

JS config object for project mappings. Placeholder Notion database IDs.

```js
/**
 * Project configuration for the Request Agent.
 * Maps project keys (from frontmatter) to GitHub repo + Notion DB details.
 *
 * Bryan fills in notion_database_id after creating the Notion databases.
 */

module.exports = {
  'ecomwave-crm': {
    github_repo: 'bryanchong32/mom-crm-webapp',
    github_branch: 'main',
    notion_database_id: '<placeholder>',
    docs_path: 'docs/requests',
  },
  'telegram-bot': {
    github_repo: 'bryanchong32/telegram-bot',
    github_branch: 'main',
    notion_database_id: '<placeholder>',
    docs_path: 'docs/requests',
  },
};
```

**Step 3: Create `src/bot3/logger.js`**

Same pattern as `src/utils/logger.js` but imports from `./config`. Identical logic (JSON structured logging, MYT timestamps, security note about not logging content).

```js
/**
 * Structured logger for Bot 3 (Request Agent).
 * Same pattern as src/utils/logger.js but uses bot3's own config.
 *
 * SECURITY: Never log file content — requests may contain
 * sensitive project details. Log IDs and metadata only.
 */

const config = require('./config');

function timestamp() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Kuala_Lumpur' }).replace(' ', 'T');
}

function log(level, message, meta = {}) {
  const entry = {
    ts: timestamp(),
    level,
    msg: message,
    ...meta,
  };

  const line = JSON.stringify(entry);

  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

module.exports = {
  info: (msg, meta) => log('info', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  error: (msg, meta) => log('error', msg, meta),
  debug: (msg, meta) => {
    if (config.NODE_ENV === 'development') {
      log('debug', msg, meta);
    }
  },
};
```

**Step 4: Commit**

```bash
git add src/bot3/config.js src/bot3/projects.js src/bot3/logger.js
git commit -m "feat(request-agent): add config, project mappings, and logger"
```

---

## Task 3: Parser module

Pure logic — no API calls. Parses frontmatter and splits the markdown body into 3 sections.

**Files:**
- Create: `src/bot3/parser.js`

**Step 1: Create `src/bot3/parser.js`**

Two exported functions:
1. `parseFrontmatter(content)` — uses gray-matter, validates 8 required fields
2. `splitSections(body)` — regex-based splitting by `# HEADER` patterns

```js
/**
 * Markdown file parser for request documents.
 * Extracts YAML frontmatter and splits the body into three sections:
 * PRD, Decision Notes, and Claude Code Instructions.
 */

const matter = require('gray-matter');

const REQUIRED_FIELDS = [
  'request_id',
  'project',
  'title',
  'type',
  'priority',
  'effort',
  'source',
  'date',
];

const VALID_TYPES = ['Bug', 'Feature', 'Enhancement', 'UX/Polish', 'Refactor'];
const VALID_PRIORITIES = ['P1 Critical', 'P2 Important', 'P3 Backlog'];
const VALID_EFFORTS = ['Small', 'Medium', 'Large'];
const VALID_SOURCES = [
  'Own Testing',
  'Client Feedback',
  'Claude Chat Session',
  'Code Review',
  'User Report',
];

/**
 * Parses YAML frontmatter from the markdown content.
 * Validates all required fields are present and valid.
 *
 * @param {string} content — raw markdown file content
 * @returns {{ meta: Object, body: string }}
 * @throws {Error} with descriptive message listing issues
 */
function parseFrontmatter(content) {
  const { data, content: body } = matter(content);

  /* Check for missing required fields */
  const missing = REQUIRED_FIELDS.filter((field) => !data[field]);
  if (missing.length > 0) {
    throw new Error(`Missing required fields: ${missing.join(', ')}`);
  }

  /* Validate field formats */
  const errors = [];

  if (!/^REQ-\d+$/.test(data.request_id)) {
    errors.push(`request_id must match format REQ-XXX (got "${data.request_id}")`);
  }

  if (!VALID_TYPES.includes(data.type)) {
    errors.push(`type must be one of: ${VALID_TYPES.join(', ')} (got "${data.type}")`);
  }

  if (!VALID_PRIORITIES.includes(data.priority)) {
    errors.push(`priority must be one of: ${VALID_PRIORITIES.join(', ')} (got "${data.priority}")`);
  }

  if (!VALID_EFFORTS.includes(data.effort)) {
    errors.push(`effort must be one of: ${VALID_EFFORTS.join(', ')} (got "${data.effort}")`);
  }

  if (!VALID_SOURCES.includes(data.source)) {
    errors.push(`source must be one of: ${VALID_SOURCES.join(', ')} (got "${data.source}")`);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
    errors.push(`date must be YYYY-MM-DD format (got "${data.date}")`);
  }

  if (errors.length > 0) {
    throw new Error(`Validation errors:\n${errors.join('\n')}`);
  }

  return { meta: data, body: body.trim() };
}

/**
 * Splits the markdown body into three sections by top-level headers.
 * Sections: # PRD, # DECISION NOTES, # CLAUDE CODE INSTRUCTIONS
 *
 * Strips --- horizontal rule separators between sections.
 *
 * @param {string} body — markdown body (after frontmatter)
 * @returns {{ prd: string, decisionNotes: string, ccInstructions: string }}
 * @throws {Error} if any section is missing or empty
 */
function splitSections(body) {
  /* Match top-level headers — case-insensitive for robustness */
  const prdMatch = body.match(/^# PRD\s*$/im);
  const dnMatch = body.match(/^# DECISION NOTES\s*$/im);
  const ccMatch = body.match(/^# CLAUDE CODE INSTRUCTIONS\s*$/im);

  const missing = [];
  if (!prdMatch) missing.push('# PRD');
  if (!dnMatch) missing.push('# DECISION NOTES');
  if (!ccMatch) missing.push('# CLAUDE CODE INSTRUCTIONS');

  if (missing.length > 0) {
    throw new Error(`Missing sections: ${missing.join(', ')}`);
  }

  /* Extract content between headers */
  const prdStart = prdMatch.index;
  const dnStart = dnMatch.index;
  const ccStart = ccMatch.index;

  const prdRaw = body.substring(prdStart, dnStart);
  const dnRaw = body.substring(dnStart, ccStart);
  const ccRaw = body.substring(ccStart);

  /* Clean each section: strip trailing --- separators and trim */
  const clean = (text) => text.replace(/\n---\s*$/, '').trim();

  const prd = clean(prdRaw);
  const decisionNotes = clean(dnRaw);
  const ccInstructions = clean(ccRaw);

  /* Validate sections have content beyond just the header */
  const empties = [];
  if (prd.split('\n').length <= 1) empties.push('PRD');
  if (decisionNotes.split('\n').length <= 1) empties.push('DECISION NOTES');
  if (ccInstructions.split('\n').length <= 1) empties.push('CLAUDE CODE INSTRUCTIONS');

  if (empties.length > 0) {
    throw new Error(`Empty sections (no content after header): ${empties.join(', ')}`);
  }

  return { prd, decisionNotes, ccInstructions };
}

module.exports = { parseFrontmatter, splitSections };
```

**Step 2: Verify parser manually**

Create a quick test script (don't commit — just verify locally):

```bash
node -e "
const { parseFrontmatter, splitSections } = require('./src/bot3/parser');
const fs = require('fs');
// Will test with example file after Task 11
console.log('Parser module loads OK');
"
```

Expected: "Parser module loads OK" (no require errors)

**Step 3: Commit**

```bash
git add src/bot3/parser.js
git commit -m "feat(request-agent): add markdown parser with frontmatter + section splitting"
```

---

## Task 4: GitHub module

Wraps the GitHub Git Data API. Creates a multi-file commit via trees/blobs.

**Files:**
- Create: `src/bot3/github.js`

**Step 1: Create `src/bot3/github.js`**

```js
/**
 * GitHub Git Data API wrapper.
 * Commits multiple files in a single commit using the low-level
 * trees/blobs API (no working directory needed).
 *
 * Uses native fetch() — no Octokit dependency.
 */

const config = require('./config');
const logger = require('./logger');

const GITHUB_API = 'https://api.github.com';

/**
 * Makes an authenticated GitHub API request.
 *
 * @param {string} endpoint — API path (e.g. /repos/owner/repo/git/ref/heads/main)
 * @param {Object} [options] — fetch options (method, body)
 * @returns {Promise<Object>} — parsed JSON response
 * @throws {Error} with status code and message from GitHub
 */
async function githubFetch(endpoint, options = {}) {
  const url = `${GITHUB_API}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    const err = new Error(`GitHub API ${response.status}: ${errorBody}`);
    err.status = response.status;
    throw err;
  }

  return response.json();
}

/**
 * Commits multiple files to a GitHub repository in a single commit.
 * Uses the Git Data API (trees + commits + refs).
 *
 * @param {Object} params
 * @param {string} params.owner — repo owner (e.g. "bryanchong32")
 * @param {string} params.repo — repo name (e.g. "mom-crm-webapp")
 * @param {string} params.branch — branch name (e.g. "main")
 * @param {Array<{path: string, content: string}>} params.files — files to commit
 * @param {string} params.message — commit message
 * @returns {Promise<{commitSha: string, commitUrl: string}>}
 */
async function commitFiles({ owner, repo, branch, files, message }) {
  logger.info('GitHub commit starting', { owner, repo, branch, fileCount: files.length });

  /* Step 1: Get the current commit SHA for the branch */
  const ref = await githubFetch(`/repos/${owner}/${repo}/git/ref/heads/${branch}`);
  const latestCommitSha = ref.object.sha;

  /* Step 2: Get the tree SHA from the current commit */
  const commit = await githubFetch(`/repos/${owner}/${repo}/git/commits/${latestCommitSha}`);
  const baseTreeSha = commit.tree.sha;

  /* Step 3: Create a new tree with the files (using inline content) */
  const tree = files.map((file) => ({
    path: file.path,
    mode: '100644', /* Regular file */
    type: 'blob',
    content: file.content,
  }));

  const newTree = await githubFetch(`/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    body: {
      base_tree: baseTreeSha,
      tree,
    },
  });

  /* Step 4: Create a new commit pointing to the new tree */
  const newCommit = await githubFetch(`/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    body: {
      message,
      tree: newTree.sha,
      parents: [latestCommitSha],
    },
  });

  /* Step 5: Update the branch ref to point to the new commit */
  await githubFetch(`/repos/${owner}/${repo}/git/ref/heads/${branch}`, {
    method: 'PATCH',
    body: {
      sha: newCommit.sha,
    },
  });

  logger.info('GitHub commit complete', { sha: newCommit.sha });

  return {
    commitSha: newCommit.sha,
    commitUrl: newCommit.html_url,
  };
}

module.exports = { commitFiles };
```

**Step 2: Commit**

```bash
git add src/bot3/github.js
git commit -m "feat(request-agent): add GitHub Git Data API wrapper for multi-file commits"
```

---

## Task 5: Notion module

Creates a database page with all properties mapped from the spec.

**Files:**
- Create: `src/bot3/notion.js`

**Step 1: Create `src/bot3/notion.js`**

```js
/**
 * Notion API integration for the Request Agent.
 * Creates database pages for request tracking.
 *
 * Reuses @notionhq/client already installed in the repo.
 * Same retry pattern as src/utils/notion.js.
 */

const { Client } = require('@notionhq/client');
const config = require('./config');
const logger = require('./logger');

const notion = new Client({ auth: config.NOTION_TOKEN });

/**
 * Retries a Notion API call with exponential backoff.
 * Handles 429 (rate limit) and 5xx (server error).
 */
async function withRetry(fn, maxRetries = 3) {
  const delays = [1000, 3000, 9000];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err.status || err.code;
      const isRetryable = status === 429 || (status >= 500 && status < 600);

      if (!isRetryable || attempt === maxRetries) {
        throw err;
      }

      const delay = delays[attempt] || 9000;
      logger.warn('Notion API retry', { attempt: attempt + 1, status, delay });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Creates a Notion database page for a filed request.
 *
 * @param {Object} params
 * @param {Object} params.meta — parsed frontmatter (request_id, title, type, etc.)
 * @param {Object} params.githubUrls — { prd, decisionNotes, ccInstructions } URLs
 * @param {string} params.notionDatabaseId — target Notion database ID
 * @returns {Promise<{pageId: string, pageUrl: string}>}
 */
async function createRequestEntry({ meta, githubUrls, notionDatabaseId }) {
  logger.info('Creating Notion entry', { requestId: meta.request_id });

  const page = await withRetry(() =>
    notion.pages.create({
      parent: { database_id: notionDatabaseId },
      properties: {
        /* Title property — Notion requires exactly one title property */
        'Request Title': {
          title: [{ text: { content: meta.title } }],
        },
        'Request ID': {
          rich_text: [{ text: { content: meta.request_id } }],
        },
        Type: {
          select: { name: meta.type },
        },
        Priority: {
          select: { name: meta.priority },
        },
        Effort: {
          select: { name: meta.effort },
        },
        Status: {
          select: { name: 'Scoped' },
        },
        Source: {
          select: { name: meta.source },
        },
        'Date Logged': {
          date: { start: meta.date },
        },
        'PRD Link': {
          url: githubUrls.prd,
        },
        'Decision Notes Link': {
          url: githubUrls.decisionNotes,
        },
        'CC Instructions Link': {
          url: githubUrls.ccInstructions,
        },
      },
    })
  );

  logger.info('Notion entry created', { pageId: page.id });

  return {
    pageId: page.id,
    pageUrl: page.url,
  };
}

module.exports = { createRequestEntry };
```

**Step 2: Commit**

```bash
git add src/bot3/notion.js
git commit -m "feat(request-agent): add Notion integration for request page creation"
```

---

## Task 6: Bot setup

grammY bot instance with auth middleware.

**Files:**
- Create: `src/bot3/bot.js`

**Step 1: Create `src/bot3/bot.js`**

Same pattern as `src/bot2/bot.js`. Inlines auth middleware instead of importing from `src/shared/auth.js` (which depends on shared config).

```js
/**
 * Bot 3 — Request Agent.
 * Sets up the grammY bot instance with auth middleware and
 * registers the message router.
 */

const { Bot } = require('grammy');
const config = require('./config');
const { registerRouter } = require('./router');
const logger = require('./logger');

/* Create bot instance with Request Agent token */
const bot3 = new Bot(config.REQUEST_AGENT_BOT_TOKEN);

/* Auth middleware — silently drops messages from non-whitelisted users.
   Inlined here (instead of importing shared/auth) because shared/config
   would require Bot 1/2 env vars that this process doesn't have. */
bot3.use((ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  if (userId !== config.ALLOWED_TELEGRAM_USER_ID) {
    logger.warn('Unauthorised access attempt', { userId });
    return;
  }

  return next();
});

/* Register all command + message handlers */
registerRouter(bot3);

/* Set bot commands menu (visible in Telegram) */
bot3.api.setMyCommands([
  { command: 'start', description: 'What this bot does' },
  { command: 'help', description: 'Usage instructions' },
]).catch((err) => logger.warn('setMyCommands failed (Bot 3)', { error: err.message }));

/* Error handler — log and notify user of unexpected failures */
bot3.catch((err) => {
  logger.error('Bot 3 unhandled error', {
    error: err.message,
    stack: err.stack,
  });

  try {
    err.ctx?.reply('Something went wrong. Please try again.').catch(() => {});
  } catch (_) {
    /* Silently ignore */
  }
});

module.exports = { bot3 };
```

**Step 2: Commit**

```bash
git add src/bot3/bot.js
git commit -m "feat(request-agent): add grammY bot instance with auth middleware"
```

---

## Task 7: Router + pipeline orchestration

The main message handler that ties parser, github, and notion together.

**Files:**
- Create: `src/bot3/router.js`

**Step 1: Create `src/bot3/router.js`**

This is the largest module. Handles `/start`, `/help`, document messages, and orchestrates the full filing pipeline with step-by-step error tracking.

```js
/**
 * Bot 3 — Request Agent message router.
 *
 * Routes:
 * - /start, /help — usage info
 * - Document (.md file) → parse → GitHub commit → Notion entry → confirm
 * - Any other message → friendly nudge to send a .md file
 */

const { parseFrontmatter, splitSections } = require('./parser');
const { commitFiles } = require('./github');
const { createRequestEntry } = require('./notion');
const projects = require('./projects');
const logger = require('./logger');

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

  /* ─── Document Processing ─── */

  bot.on('message:document', async (ctx) => {
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
  const completed = []; /* Steps that succeeded — for partial success reporting */

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

    /* Build error message with partial success info */
    let errorMsg = `❌ Filing failed\n\nStep: ${getFailedStep(completed)}\nError: ${err.message}`;

    if (completed.length > 0) {
      errorMsg += `\n\nCompleted before failure:\n${completed.map((s) => `  ✅ ${s}`).join('\n')}`;
    }

    errorMsg += '\n\nFix and resend, or file manually in Notion.';

    await ctx.reply(errorMsg).catch(() => {
      /* If we can't even reply, log it */
      logger.error('Failed to send error message to user');
    });
  }
}

/**
 * Determines which step failed based on what completed successfully.
 */
function getFailedStep(completed) {
  const steps = [
    'File download',
    'Frontmatter parsing',
    'Project validation',
    'Section splitting',
    'Status message',
    'GitHub commit',
    'GitHub URL construction',
    'Notion entry creation',
  ];

  return steps[completed.length] || 'Unknown';
}

module.exports = { registerRouter };
```

**Step 2: Commit**

```bash
git add src/bot3/router.js
git commit -m "feat(request-agent): add router with full filing pipeline"
```

---

## Task 8: Entry point (index.js)

Express server + webhook/polling + graceful shutdown.

**Files:**
- Create: `src/bot3/index.js`

**Step 1: Create `src/bot3/index.js`**

Mirrors `src/index.js` but much simpler — no SQLite, no scheduler, no pending sync, no draft buffer.

```js
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
```

**Step 2: Commit**

```bash
git add src/bot3/index.js
git commit -m "feat(request-agent): add entry point with Express, webhook, and graceful shutdown"
```

---

## Task 9: Deployment config updates

Update ecosystem.config.js and .env.example.

**Files:**
- Modify: `ecosystem.config.js`
- Modify: `.env.example`

**Step 1: Update `ecosystem.config.js`**

Add a second app entry for the Request Agent. Keep the existing `telegram-bots` entry unchanged.

Add this as the second element in the `apps` array:

```js
{
  name: 'request-agent',
  script: 'src/bot3/index.js',
  cwd: '/home/deploy/telegram-bots',
  env: {
    NODE_ENV: 'production',
    PORT: 3004,
    TZ: 'Asia/Kuala_Lumpur',
  },
  max_restarts: 10,
  min_uptime: '10s',
  restart_delay: 5000,
  error_file: '/home/deploy/telegram-bots/logs/request-agent-error.log',
  out_file: '/home/deploy/telegram-bots/logs/request-agent-out.log',
  log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
  merge_logs: true,
  watch: false,
},
```

**Step 2: Update `.env.example`**

Add these lines after the existing Telegram section:

```
# Request Agent (Bot 3)
REQUEST_AGENT_BOT_TOKEN=
GITHUB_TOKEN=
```

`NOTION_TOKEN` already exists — no need to duplicate.

**Step 3: Commit**

```bash
git add ecosystem.config.js .env.example
git commit -m "feat(request-agent): add PM2 config and env var template"
```

---

## Task 10: Example input file

Create a test file matching the expected format. Uses the example from the spec (duplicate email import).

**Files:**
- Create: `docs/examples/REQ-001-example.md`

**Step 1: Create the example file**

```markdown
---
request_id: REQ-001
project: ecomwave-crm
title: Handle Duplicate Emails During Contact Import
type: Bug
priority: P1 Critical
effort: Small
source: Own Testing
date: 2026-02-28
---

# PRD

## Problem

When importing contacts via CSV, duplicate email addresses cause the import to fail silently. The user receives a success message but some rows are dropped without explanation.

## Solution

Detect duplicate emails during import and surface them to the user with options to skip, overwrite, or merge.

## Requirements

1. During CSV import, check each email against existing contacts
2. If duplicates found, show a summary before proceeding
3. User can choose: Skip duplicates, Overwrite existing, or Cancel import
4. Log all skipped/overwritten rows for audit trail

---

# DECISION NOTES

## Approach

- Check duplicates at parse time (before DB insert) to give fast feedback
- Use a Set for O(1) lookup of emails already seen in the CSV
- Query existing contacts in a single batch (not per-row) for DB efficiency
- Show duplicate summary in a modal with radio button choices

## Rejected Alternatives

- Post-insert cleanup: Too risky, could corrupt data
- Silent skip: Bad UX, user doesn't know what happened
- Per-row confirmation: Too tedious for large imports

---

# CLAUDE CODE INSTRUCTIONS

## Context

- Import handler: `server/routes/contacts.js` → `POST /api/contacts/import`
- CSV parsing: `server/utils/csv.js` → `parseContactsCsv()`
- Frontend: `client/src/pages/Contacts/ImportModal.jsx`

## Steps

1. In `parseContactsCsv()`, collect all emails into a Set during parsing
2. After parsing, query `contacts` table for any matching emails
3. If duplicates found, return them in the parse result (don't throw)
4. In the import route, check for duplicates before inserting
5. In `ImportModal.jsx`, show duplicate summary if present
6. Add "Skip duplicates" / "Overwrite" / "Cancel" buttons
7. Handle each choice in the import route

## Testing

- Import CSV with no duplicates → all rows imported
- Import CSV with duplicates in CSV itself → detected before DB check
- Import CSV with emails matching existing contacts → summary shown
- Choose "Skip" → only new contacts imported
- Choose "Overwrite" → existing contacts updated
```

**Step 2: Commit**

```bash
git add docs/examples/REQ-001-example.md
git commit -m "docs: add example request file for testing the Request Agent"
```

---

## Task 11: Documentation updates

Update ARCHITECTURE.md and DEPLOY.md to include the Request Agent.

**Files:**
- Modify: `ARCHITECTURE.md`
- Modify: `DEPLOY.md`

**Step 1: Update `ARCHITECTURE.md`**

Add a new section for Bot 3 after the existing Bot 2 section. Include:
- System context (separate PM2 process, port 3004)
- Message flow diagram (document → validate → parse → GitHub → Notion → confirm)
- Module list with descriptions
- Note that it runs independently from Bot 1/2

Read the existing ARCHITECTURE.md first, then add the new section following the same formatting style.

**Step 2: Update `DEPLOY.md`**

Add deployment instructions for the Request Agent:
- New PM2 process: `pm2 start ecosystem.config.js` (starts both)
- New Nginx location block for `/webhook/request-agent` → `localhost:3004`
- Webhook registration for bot3
- New env vars needed

Read the existing DEPLOY.md first, then add the new section following the same formatting style.

**Step 3: Commit**

```bash
git add ARCHITECTURE.md DEPLOY.md
git commit -m "docs: add Request Agent to architecture and deployment docs"
```

---

## Task 12: Local verification

Verify everything loads and starts correctly before deployment.

**Step 1: Add bot3 env vars to local `.env`**

Add placeholder values to test startup (bot won't connect to Telegram without a real token, but we can verify no require/syntax errors):

```
REQUEST_AGENT_BOT_TOKEN=test_token_placeholder
GITHUB_TOKEN=test_token_placeholder
```

**Step 2: Test that the module loads without errors**

Run: `node -e "require('./src/bot3/config'); console.log('config OK')"`
Expected: Either "config OK" or a clear error about missing env vars

Run: `node -e "require('./src/bot3/parser'); console.log('parser OK')"`
Expected: "parser OK"

Run: `node -e "require('./src/bot3/github'); console.log('github OK')"`
Expected: "github OK"

Run: `node -e "require('./src/bot3/notion'); console.log('notion OK')"`
Expected: "notion OK"

**Step 3: Test parser with example file**

```bash
node -e "
const fs = require('fs');
const { parseFrontmatter, splitSections } = require('./src/bot3/parser');
const content = fs.readFileSync('docs/examples/REQ-001-example.md', 'utf-8');
const { meta, body } = parseFrontmatter(content);
console.log('Frontmatter:', JSON.stringify(meta, null, 2));
const sections = splitSections(body);
console.log('PRD length:', sections.prd.length);
console.log('Decision Notes length:', sections.decisionNotes.length);
console.log('CC Instructions length:', sections.ccInstructions.length);
console.log('All sections have content:', sections.prd.length > 50 && sections.decisionNotes.length > 50 && sections.ccInstructions.length > 50);
"
```

Expected: All three sections parsed with content, `true` for the content check.

**Step 4: Remove placeholder env vars from `.env`**

Don't leave test placeholders in — Bryan will add real values later.

---

## Summary of all files created/modified

### New files (8):
- `src/bot3/config.js` — environment variable loader
- `src/bot3/projects.js` — project config mapping
- `src/bot3/logger.js` — structured JSON logger
- `src/bot3/parser.js` — frontmatter + section splitting
- `src/bot3/github.js` — GitHub Git Data API wrapper
- `src/bot3/notion.js` — Notion page creation
- `src/bot3/bot.js` — grammY bot instance + auth
- `src/bot3/router.js` — commands + filing pipeline
- `src/bot3/index.js` — Express entry point
- `docs/examples/REQ-001-example.md` — test input file

### Modified files (4):
- `package.json` — added gray-matter dependency
- `ecosystem.config.js` — added request-agent PM2 entry
- `.env.example` — added REQUEST_AGENT_BOT_TOKEN, GITHUB_TOKEN
- `ARCHITECTURE.md` — added Bot 3 section
- `DEPLOY.md` — added Request Agent deployment steps

### Bryan's setup tasks (after code is deployed):
1. Create new Telegram bot via @BotFather → get `REQUEST_AGENT_BOT_TOKEN`
2. Create GitHub fine-grained PAT with Contents:Read+Write on `mom-crm-webapp` + `telegram-bot` → get `GITHUB_TOKEN`
3. Create Notion databases for request tracking (one per project or shared)
4. Share Notion databases with existing integration
5. Copy database IDs into `src/bot3/projects.js`
6. Add all tokens to `.env` on VPS
7. Add Nginx location block for `/webhook/request-agent`
8. Deploy via SCP + `pm2 start ecosystem.config.js`
9. Register webhook: `curl https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://ecomwave.duckdns.org/webhook/request-agent`
