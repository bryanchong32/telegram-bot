/**
 * File Handling — ATTACH_FILE handler.
 *
 * Handles file messages (photos, documents) sent to Bot 1.
 * Flow:
 * 1. Download file from Telegram servers
 * 2. If Office doc → convert to PDF via LibreOffice
 * 3. Upload to Google Drive in TaskRefs/{stream}/
 * 4. If caption references a task → search and link file to that task
 * 5. Otherwise → create new Inbox task with the filename as title
 * 6. Reply with confirmation
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { uploadFileToDrive } = require('./drive');
const { shouldConvert, convertToPdf } = require('./convert');
const { createTask, searchTasks, getPageTitle } = require('../todo/notion');
const { appendFileLink } = require('./notionFiles');
const { inferStream } = require('../streamRouter');
const { chat } = require('../../utils/anthropic');
const { db } = require('../../shared/db');
const logger = require('../../utils/logger');

/**
 * Handles an incoming file message (photo or document).
 * Downloads from Telegram, converts if needed, uploads to Drive,
 * and links to an existing task or creates a new Inbox task.
 *
 * @param {Object} ctx — grammY context (message:photo or message:document)
 */
async function handleAttachFile(ctx) {
  let tempPath = null;
  let convertedPath = null;

  try {
    await ctx.reply('Received file — processing...');

    /* ─── Step 1: Get file info from Telegram ─── */
    const { fileId, fileName, mimeType } = extractFileInfo(ctx);

    /* ─── Step 2: Parse caption for stream + task link hints ─── */
    const caption = ctx.message.caption || '';
    const hints = await parseFileCaption(caption, fileName);

    /* ─── Step 3: Download the file from Telegram ─── */
    tempPath = await downloadTelegramFile(ctx, fileId, fileName);

    /* ─── Step 4: Convert Office docs to PDF if applicable ─── */
    let uploadPath = tempPath;
    let uploadName = fileName;
    let uploadMime = mimeType;
    let conversionNote = '';

    if (shouldConvert(fileName)) {
      const { pdfPath, converted } = await convertToPdf(tempPath);
      if (converted) {
        convertedPath = pdfPath;
        uploadPath = pdfPath;
        uploadName = path.basename(pdfPath);
        uploadMime = 'application/pdf';
      } else {
        conversionNote = '\n(PDF conversion failed — original file uploaded)';
      }
    }

    /* ─── Step 5: Upload to Google Drive ─── */
    const stream = hints.stream || 'Personal';
    const { webViewLink, fileName: driveFileName } = await uploadFileToDrive(
      uploadPath,
      uploadName,
      stream,
      uploadMime
    );

    /* ─── Step 6: Link to existing task or create new Inbox task ─── */
    let taskTitle;

    if (hints.linkToTask) {
      /* Try to find the referenced task */
      const matches = await searchTasks(hints.linkToTask);

      if (matches.length > 0) {
        /* Link file to the top matching task */
        const task = matches[0];
        taskTitle = getPageTitle(task);
        await appendFileLink(task.id, driveFileName, webViewLink);
      } else {
        /* Task not found — create a new Inbox task instead */
        taskTitle = hints.linkToTask;
        const page = await createTask({
          title: taskTitle,
          status: 'Inbox',
          urgency: 'No Urgency',
          stream,
          dueDate: null,
          energy: 'Low',
          notes: null,
        });
        await appendFileLink(page.id, driveFileName, webViewLink);
      }
    } else {
      /* No task reference — create new Inbox task named after the file */
      taskTitle = cleanFileName(fileName);
      const page = await createTask({
        title: taskTitle,
        status: 'Inbox',
        urgency: 'No Urgency',
        stream,
        dueDate: null,
        energy: 'Low',
        notes: null,
      });
      await appendFileLink(page.id, driveFileName, webViewLink);
    }

    /* ─── Step 7: Reply with confirmation ─── */
    const linkedTo = hints.linkToTask && taskTitle !== hints.linkToTask
      ? `${taskTitle}` /* Found existing task */
      : taskTitle === cleanFileName(fileName)
        ? 'new Inbox task'
        : taskTitle;

    await ctx.reply(
      `Saved: ${driveFileName} → ${stream}\nLinked to: ${linkedTo}${conversionNote}`
    );
  } catch (err) {
    logger.error('ATTACH_FILE failed', { error: err.message, stack: err.stack });

    /* Queue to pending_sync for retry if it was a Drive/Notion issue */
    queuePendingSync('upload_file', {
      caption: ctx.message.caption || '',
      fileName: extractFileInfo(ctx).fileName,
    });

    await ctx.reply('File upload failed. Queued for retry when services are restored.');
  } finally {
    /* Clean up temp files */
    cleanupTemp(tempPath);
    if (convertedPath && convertedPath !== tempPath) {
      cleanupTemp(convertedPath);
    }
  }
}

/**
 * Extracts file ID, name, and MIME type from a Telegram message.
 * Handles both photo messages (uses largest photo) and document messages.
 */
function extractFileInfo(ctx) {
  if (ctx.message.document) {
    return {
      fileId: ctx.message.document.file_id,
      fileName: ctx.message.document.file_name || 'document',
      mimeType: ctx.message.document.mime_type || 'application/octet-stream',
    };
  }

  if (ctx.message.photo && ctx.message.photo.length > 0) {
    /* Telegram sends multiple sizes — use the largest (last in array) */
    const largest = ctx.message.photo[ctx.message.photo.length - 1];
    return {
      fileId: largest.file_id,
      fileName: `photo_${Date.now()}.jpg`,
      mimeType: 'image/jpeg',
    };
  }

  throw new Error('No file found in message');
}

/**
 * Downloads a file from Telegram servers to a temporary local path.
 * grammY's getFile() returns file_path — we construct the download URL
 * and fetch the file bytes directly from Telegram's file server.
 *
 * @param {Object} ctx — grammY context
 * @param {string} fileId — Telegram file ID
 * @param {string} fileName — desired filename for the temp file
 * @returns {Promise<string>} — path to the downloaded temp file
 */
async function downloadTelegramFile(ctx, fileId, fileName) {
  /* Get file info from Telegram (includes file_path for download) */
  const file = await ctx.api.getFile(fileId);

  if (!file.file_path) {
    throw new Error('Telegram returned no file_path — file may be too large (>20MB)');
  }

  /* Construct the download URL from the bot token + file_path */
  const botToken = ctx.api.token;
  const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;

  /* Create a temp directory for this download */
  const tempDir = path.join(os.tmpdir(), 'telegram-bot-files');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  /* Fetch the file from Telegram and write to disk */
  const tempPath = path.join(tempDir, `${Date.now()}_${fileName}`);
  const response = await fetch(downloadUrl);

  if (!response.ok) {
    throw new Error(`Telegram file download failed: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(tempPath, buffer);

  logger.info('File downloaded from Telegram', { tempPath, size: buffer.length });
  return tempPath;
}

/**
 * Parses a file caption to extract stream and task link hints.
 * Uses Claude Haiku for smart extraction when caption has meaningful text.
 * Falls back to keyword-based stream inference for empty/short captions.
 *
 * @param {string} caption — the file message caption (may be empty)
 * @param {string} fileName — the original filename (used for stream inference fallback)
 * @returns {Promise<{stream: string|null, linkToTask: string|null}>}
 */
async function parseFileCaption(caption, fileName) {
  /* No caption or very short — just infer stream from filename */
  if (!caption || caption.trim().length < 3) {
    const routed = inferStream(fileName);
    return {
      stream: routed.stream || 'Personal',
      linkToTask: null,
    };
  }

  /* Use Claude Haiku to extract hints from the caption */
  try {
    const response = await chat({
      system:
        'You extract metadata from a file caption sent to a Telegram task bot. ' +
        'The user is sending a file and may mention which task to attach it to and/or which stream it belongs to.\n\n' +
        'Streams: Minionions, KLN, Overdrive, Personal, Property\n' +
        'Stream keywords: SVO/supplement/ads/inventory → Minionions, KLN/consultant/client/report → KLN, ' +
        'Overdrive/OD/event/pickleball → Overdrive, Solasta/renovation/contractor/rental → Property, else → Personal\n\n' +
        'Return ONLY valid JSON:\n' +
        '{"stream": "StreamName or null", "link_to_task": "task search keywords or null"}\n\n' +
        'If the caption just says a task name (e.g. "for the KLN report"), set link_to_task to search keywords.\n' +
        'If the caption is just a stream name or keywords, set stream only.\n' +
        'If ambiguous, set both to null.',
      userMessage: caption,
      model: 'haiku',
      maxTokens: 128,
    });

    let cleaned = response.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }
    const parsed = JSON.parse(cleaned);

    return {
      stream: parsed.stream || inferStream(caption + ' ' + fileName).stream || 'Personal',
      linkToTask: parsed.link_to_task || null,
    };
  } catch (err) {
    /* On failure, fall back to keyword-based inference */
    logger.warn('Caption parsing failed — using keyword inference', { error: err.message });
    const routed = inferStream(caption + ' ' + fileName);
    return {
      stream: routed.stream || 'Personal',
      linkToTask: null,
    };
  }
}

/**
 * Cleans a filename into a readable task title.
 * Removes date prefix, extension, and replaces separators with spaces.
 */
function cleanFileName(fileName) {
  let name = path.basename(fileName, path.extname(fileName));
  /* Remove common date prefixes like YYYY-MM-DD_ */
  name = name.replace(/^\d{4}-\d{2}-\d{2}_?/, '');
  /* Replace underscores and hyphens with spaces */
  name = name.replace(/[_-]+/g, ' ').trim();
  return name || fileName;
}

/**
 * Queues a failed file operation to pending_sync for retry.
 */
function queuePendingSync(action, payload) {
  try {
    const stmt = db.prepare(
      'INSERT INTO pending_sync (action, payload) VALUES (?, ?)'
    );
    stmt.run(action, JSON.stringify(payload));
    logger.info('Queued file operation to pending_sync', { action });
  } catch (err) {
    logger.error('Failed to queue pending_sync', { error: err.message });
  }
}

/**
 * Removes a temporary file if it exists.
 */
function cleanupTemp(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (err) {
      logger.warn('Failed to clean up temp file', { filePath, error: err.message });
    }
  }
}

module.exports = { handleAttachFile };
