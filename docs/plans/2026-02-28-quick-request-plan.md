# Quick Request Feature — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users send a plain text message to Reqqo and log it in Notion as an "Unscoped" request via inline button flow (project → type → priority).

**Architecture:** In-memory conversation state (`Map<chatId, pending>`) in the router. Three callback query rounds collect project, type, and priority. Auto-generates next REQ-XXX by querying the Notion database. Creates a minimal Notion entry (no GitHub commit).

**Tech Stack:** grammY (existing), @notionhq/client (existing), Node.js

---

### Task 1: Add `getNextRequestId` to notion.js

**Files:**
- Modify: `src/bot3/notion.js`

**Step 1: Add the function after `createRequestEntry`**

Query Notion for all Request ID values, find the highest REQ-XXX, return the next one.

```js
/**
 * Queries the Notion database for the highest REQ-XXX ID and returns the next one.
 *
 * @param {string} notionDatabaseId
 * @returns {Promise<string>} e.g. "REQ-006"
 */
async function getNextRequestId(notionDatabaseId) {
  let highest = 0;
  let hasMore = true;
  let startCursor;

  while (hasMore) {
    const response = await withRetry(() =>
      notion.databases.query({
        database_id: notionDatabaseId,
        ...(startCursor && { start_cursor: startCursor }),
        page_size: 100,
        filter_properties: ['Request ID'],
      })
    );

    for (const page of response.results) {
      const richText = page.properties['Request ID']?.rich_text;
      if (!richText || richText.length === 0) continue;

      const value = richText[0].plain_text;
      const match = value.match(/^REQ-(\d+)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > highest) highest = num;
      }
    }

    hasMore = response.has_more;
    startCursor = response.next_cursor;
  }

  const next = highest + 1;
  return `REQ-${String(next).padStart(3, '0')}`;
}
```

**Step 2: Add `createQuickEntry` after `getNextRequestId`**

Creates a minimal Notion entry for unscoped requests — no GitHub URLs, no effort.

```js
/**
 * Creates a minimal Notion entry for a quick (unscoped) request.
 *
 * @param {Object} params
 * @param {string} params.title
 * @param {string} params.requestId — auto-generated REQ-XXX
 * @param {string} params.project — e.g. "ecomwave-crm"
 * @param {string} params.type — e.g. "Feature"
 * @param {string} params.priority — e.g. "P3 Backlog"
 * @param {string} params.notionDatabaseId
 * @returns {Promise<{pageId: string, pageUrl: string}>}
 */
async function createQuickEntry({ title, requestId, project, type, priority, notionDatabaseId }) {
  logger.info('Creating quick Notion entry', { requestId });

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });

  const page = await withRetry(() =>
    notion.pages.create({
      parent: { database_id: notionDatabaseId },
      properties: {
        'Request Title': {
          title: [{ text: { content: title } }],
        },
        'Request ID': {
          rich_text: [{ text: { content: requestId } }],
        },
        Type: {
          select: { name: type },
        },
        Priority: {
          select: { name: priority },
        },
        Status: {
          select: { name: 'Unscoped' },
        },
        Source: {
          select: { name: 'Quick Request' },
        },
        Project: {
          select: { name: project },
        },
        'Date Logged': {
          date: { start: today },
        },
      },
    })
  );

  logger.info('Quick Notion entry created', { pageId: page.id });

  return {
    pageId: page.id,
    pageUrl: page.url,
  };
}
```

**Step 3: Update module.exports**

```js
module.exports = { createRequestEntry, getNextRequestId, createQuickEntry };
```

---

### Task 2: Add conversation state and text handler to router.js

**Files:**
- Modify: `src/bot3/router.js`

**Step 1: Add imports and conversation state map**

At the top of the file, after the existing imports, add:

```js
const { createQuickEntry, getNextRequestId } = require('./notion');
```

Update the existing `createRequestEntry` import to:

```js
const { createRequestEntry, createQuickEntry, getNextRequestId } = require('./notion');
```

After the `DEDUP_TTL_MS` constant, add:

```js
/* ─── Quick request conversation state ─── */

const pendingQuickRequests = new Map();
const QR_TTL_MS = 5 * 60 * 1000; /* 5 minutes */

/**
 * Gets pending quick request for a chat, cleaning up expired entries.
 */
function getPending(chatId) {
  const now = Date.now();
  for (const [id, req] of pendingQuickRequests) {
    if (now - req.timestamp > QR_TTL_MS) pendingQuickRequests.delete(id);
  }
  return pendingQuickRequests.get(chatId);
}
```

**Step 2: Replace the catch-all text handler**

Replace the existing catch-all handler:

```js
/* ─── Catch-all for non-document messages ─── */
bot.on('message', async (ctx) => {
  await ctx.reply('Send me a .md file from a scoping session to file it.');
});
```

With:

```js
/* ─── Quick Request — plain text message ─── */

bot.on('message:text', async (ctx) => {
  const text = ctx.message.text.trim();
  if (!text || text.startsWith('/')) return;

  pendingQuickRequests.set(ctx.chat.id, {
    title: text,
    step: 'project',
    timestamp: Date.now(),
  });

  const projectKeys = Object.keys(projects);
  await ctx.reply('Which project?', {
    reply_markup: {
      inline_keyboard: [
        projectKeys.map((key) => ({
          text: key,
          callback_data: `qr:project:${key}`,
        })),
      ],
    },
  });
});

/* ─── Catch-all for other messages (photos, stickers, etc.) ─── */

bot.on('message', async (ctx) => {
  await ctx.reply('Send me a .md file or a text message to log a quick request.');
});
```

---

### Task 3: Add callback query handler for inline buttons

**Files:**
- Modify: `src/bot3/router.js`

**Step 1: Add callback query handler inside `registerRouter`, before the catch-all**

Place this between the `bot.on('message:document', ...)` handler and the new `bot.on('message:text', ...)` handler:

```js
/* ─── Quick Request — inline button callbacks ─── */

const VALID_TYPES = ['Bug', 'Feature', 'Enhancement', 'UX/Polish', 'Refactor'];
const VALID_PRIORITIES = ['P1 Critical', 'P2 Important', 'P3 Backlog'];

bot.on('callback_query:data', async (ctx) => {
  const data = ctx.callbackQuery.data;
  if (!data.startsWith('qr:')) return;
  await ctx.answerCallbackQuery();

  const chatId = ctx.chat.id;
  const pending = getPending(chatId);

  if (!pending) {
    await ctx.reply('Session expired. Send a new text message to start again.');
    return;
  }

  const parts = data.split(':');
  const action = parts[1];
  const value = parts.slice(2).join(':');

  if (action === 'project') {
    pending.project = value;
    pending.step = 'type';

    await ctx.editMessageText('Type?', {
      reply_markup: {
        inline_keyboard: [
          VALID_TYPES.map((t) => ({
            text: t,
            callback_data: `qr:type:${t}`,
          })),
        ],
      },
    });

  } else if (action === 'type') {
    pending.type = value;
    pending.step = 'priority';

    await ctx.editMessageText('Priority?', {
      reply_markup: {
        inline_keyboard: [
          VALID_PRIORITIES.map((p) => ({
            text: p,
            callback_data: `qr:priority:${p}`,
          })),
        ],
      },
    });

  } else if (action === 'priority') {
    pending.priority = value;
    pendingQuickRequests.delete(chatId);

    const projectConfig = projects[pending.project];
    if (!projectConfig) {
      await ctx.editMessageText('Unknown project. Send a new message to try again.');
      return;
    }

    try {
      await ctx.editMessageText(`Logging request...`);

      const requestId = await getNextRequestId(projectConfig.notion_database_id);

      await createQuickEntry({
        title: pending.title,
        requestId,
        project: pending.project,
        type: pending.type,
        priority: pending.priority,
        notionDatabaseId: projectConfig.notion_database_id,
      });

      await ctx.editMessageText(
        `✅ ${requestId} logged\n\n` +
        `${pending.title}\n` +
        `Project: ${pending.project}\n` +
        `Type: ${pending.type} | Priority: ${pending.priority}\n` +
        `Status: Unscoped\n\n` +
        `📋 Notion entry created`
      );

      logger.info('Quick request filed', { requestId, project: pending.project });

    } catch (err) {
      logger.error('Quick request failed', { error: err.message, stack: err.stack });
      await ctx.editMessageText(
        `❌ Failed to log request\n\nError: ${err.message}\n\nTry again — send the text message again.`
      );
    }
  }
});
```

---

### Task 4: Update /help and /start messages

**Files:**
- Modify: `src/bot3/router.js`

**Step 1: Update /start reply**

Replace the existing /start reply text with:

```
'Hey! I\'m the Request Agent.\n\n' +
'Two ways to use me:\n\n' +
'📄 Full scoping — send a .md file and I\'ll commit docs to GitHub + create Notion entry\n\n' +
'💬 Quick request — send any text message and I\'ll log it in Notion as Unscoped\n\n' +
'Just send a message — I handle the rest.'
```

**Step 2: Update /help reply**

Replace the existing /help reply text with:

```
'Request Agent — Help\n\n' +
'📄 Scoped request (full .md file):\n' +
'  1. Finish a scoping session in Claude Chat\n' +
'  2. Download the combined .md file\n' +
'  3. Send it here\n\n' +
'💬 Quick request (text message):\n' +
'  1. Send any text message as the request title\n' +
'  2. Tap buttons to select project, type, priority\n' +
'  3. Entry logged in Notion as Unscoped\n\n' +
'Valid projects: ' + Object.keys(projects).join(', ')
```

---

### Task 5: Deploy and test on VPS

**Step 1: SCP changed files to VPS**

```bash
scp src/bot3/notion.js root@5.223.49.206:/tmp/notion.js
scp src/bot3/router.js root@5.223.49.206:/tmp/router.js
ssh root@5.223.49.206 "cp /tmp/notion.js /home/deploy/telegram-bots/src/bot3/notion.js && cp /tmp/router.js /home/deploy/telegram-bots/src/bot3/router.js && chown deploy:deploy /home/deploy/telegram-bots/src/bot3/notion.js /home/deploy/telegram-bots/src/bot3/router.js"
```

**Step 2: Restart PM2**

```bash
ssh root@5.223.49.206 "su - deploy -c 'pm2 restart request-agent && pm2 save'"
```

**Step 3: Verify no crash**

```bash
ssh root@5.223.49.206 "su - deploy -c 'pm2 logs request-agent --lines 10 --nostream'"
```

**Step 4: Manual test in Telegram**

1. Send text message: "add dark mode toggle"
2. Tap project button → ecomwave-crm
3. Tap type button → Feature
4. Tap priority button → P3 Backlog
5. Verify confirmation message shows REQ-XXX
6. Check Notion database for new Unscoped entry

**Step 5: Test existing scoped flow still works**

Send the example .md file to verify the scoped flow is unaffected.
