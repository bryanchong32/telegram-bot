/**
 * Google Drive upload module.
 *
 * Uploads files to the TaskRefs/{stream}/ folder structure in Google Drive.
 * Each file is date-prefixed (YYYY-MM-DD_filename) and shared via link.
 *
 * Folder structure (created by scripts/setup-google.js):
 *   TaskRefs/
 *   ├── Minionions/
 *   ├── KLN/
 *   ├── Overdrive/
 *   ├── Personal/
 *   └── Property/
 */

const fs = require('fs');
const path = require('path');
const { drive, withGoogleRetry } = require('../../utils/google');
const config = require('../../shared/config');
const { todayMYT } = require('../../utils/dates');
const logger = require('../../utils/logger');

/* Map stream names to their Drive subfolder IDs.
   Lazily populated on first upload by listing TaskRefs subfolders. */
let streamFolderMap = null;

/**
 * Builds the stream→folderId map by listing subfolders of TaskRefs.
 * Called once on first upload, then cached for the process lifetime.
 */
async function loadStreamFolders() {
  const parentId = config.GDRIVE_TASK_REFS_FOLDER_ID;
  if (!parentId) {
    throw new Error('GDRIVE_TASK_REFS_FOLDER_ID not set — run scripts/setup-google.js first');
  }

  const res = await drive.files.list({
    q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
  });

  streamFolderMap = {};
  for (const folder of res.data.files) {
    streamFolderMap[folder.name] = folder.id;
  }

  logger.info('Stream folder map loaded', { streams: Object.keys(streamFolderMap) });
  return streamFolderMap;
}

/**
 * Returns the Drive folder ID for a given stream name.
 * Falls back to Personal if the stream doesn't have a folder.
 */
async function getStreamFolderId(stream) {
  if (!streamFolderMap) {
    await loadStreamFolders();
  }

  const folderId = streamFolderMap[stream] || streamFolderMap['Personal'];
  if (!folderId) {
    throw new Error(`No Drive folder found for stream "${stream}" or Personal fallback`);
  }
  return folderId;
}

/**
 * Uploads a file to Google Drive in the correct stream subfolder.
 *
 * @param {string} filePath — local path to the file to upload
 * @param {string} originalName — the original filename (used for naming in Drive)
 * @param {string} stream — stream name (Minionions/KLN/Overdrive/Personal/Property)
 * @param {string} mimeType — the MIME type of the file
 * @returns {Promise<{fileId: string, webViewLink: string, fileName: string}>}
 */
async function uploadFileToDrive(filePath, originalName, stream, mimeType) {
  /* Prefix filename with today's date: YYYY-MM-DD_originalname */
  const datePrefix = todayMYT();
  const fileName = `${datePrefix}_${originalName}`;

  /* Get the target folder ID for this stream */
  const folderId = await getStreamFolderId(stream);

  /* Upload the file to Drive */
  const res = await withGoogleRetry(() =>
    drive.files.create({
      requestBody: {
        name: fileName,
        parents: [folderId],
      },
      media: {
        mimeType: mimeType || 'application/octet-stream',
        body: fs.createReadStream(filePath),
      },
      fields: 'id, webViewLink',
    })
  );

  const fileId = res.data.id;

  /* Set sharing: "Anyone with link can view" */
  await withGoogleRetry(() =>
    drive.permissions.create({
      fileId,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    })
  );

  /* Get the shareable link (webViewLink may already be set, but fetch fresh to be sure) */
  const fileInfo = await drive.files.get({
    fileId,
    fields: 'webViewLink',
  });

  const webViewLink = fileInfo.data.webViewLink;
  logger.info('File uploaded to Drive', { fileId, stream, fileName });

  return { fileId, webViewLink, fileName };
}

module.exports = { uploadFileToDrive };
