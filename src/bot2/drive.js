/**
 * Google Drive receipt upload module.
 *
 * Uploads receipt images/PDFs to the receipts/ folder in Google Drive.
 * Organizes files by year/month subfolders: receipts/2026/02/
 * Creates subfolders on demand if they don't exist yet.
 *
 * Files are named: YYYY-MM-DD_merchant_amount.ext
 * Shared as "anyone with link can view" for easy Sheets linking.
 */

const fs = require('fs');
const { drive, withGoogleRetry } = require('../utils/google');
const config = require('../shared/config');
const logger = require('../utils/logger');

/* Cache for year/month subfolder IDs: { "2026/02": "folderId" } */
const folderCache = {};

/**
 * Gets or creates the YYYY/MM subfolder under the receipts root folder.
 * Caches folder IDs so we only create each subfolder once.
 *
 * @param {string} dateStr — receipt date in YYYY-MM-DD format
 * @returns {Promise<string>} — folder ID for the year/month subfolder
 */
async function getMonthFolder(dateStr) {
  const receiptsRoot = config.GDRIVE_RECEIPTS_FOLDER_ID;
  if (!receiptsRoot) {
    throw new Error('GDRIVE_RECEIPTS_FOLDER_ID not set — run scripts/setup-google.js first');
  }

  const [year, month] = dateStr.split('-');
  const cacheKey = `${year}/${month}`;

  /* Return cached folder ID if we already have it */
  if (folderCache[cacheKey]) return folderCache[cacheKey];

  /* Step 1: Find or create the year folder (e.g. "2026") */
  const yearFolderId = await findOrCreateFolder(year, receiptsRoot);

  /* Step 2: Find or create the month folder (e.g. "02") under the year folder */
  const monthFolderId = await findOrCreateFolder(month, yearFolderId);

  folderCache[cacheKey] = monthFolderId;
  logger.info('Receipt folder resolved', { path: cacheKey, folderId: monthFolderId });
  return monthFolderId;
}

/**
 * Finds an existing folder by name under a parent, or creates it.
 *
 * @param {string} name — folder name to find/create
 * @param {string} parentId — parent folder ID
 * @returns {Promise<string>} — folder ID
 */
async function findOrCreateFolder(name, parentId) {
  /* Search for existing folder */
  const res = await withGoogleRetry(() =>
    drive.files.list({
      q: `'${parentId}' in parents and name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    })
  );

  if (res.data.files && res.data.files.length > 0) {
    return res.data.files[0].id;
  }

  /* Folder doesn't exist — create it */
  const created = await withGoogleRetry(() =>
    drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      },
      fields: 'id',
      supportsAllDrives: true,
    })
  );

  logger.info('Created receipt subfolder', { name, parentId, id: created.data.id });
  return created.data.id;
}

/**
 * Uploads a receipt file to Google Drive in the correct year/month subfolder.
 *
 * @param {string} filePath — local path to the file to upload
 * @param {string} receiptDate — receipt date in YYYY-MM-DD format (for folder + naming)
 * @param {string} merchant — merchant name (for filename)
 * @param {number} amount — amount (for filename)
 * @param {string} mimeType — MIME type of the file
 * @returns {Promise<{fileId: string, webViewLink: string, fileName: string}>}
 */
async function uploadReceiptToDrive(filePath, receiptDate, merchant, amount, mimeType) {
  /* Build a descriptive filename: 2026-02-24_GrabFood_45.50.jpg */
  const ext = filePath.split('.').pop() || 'jpg';
  const safeMerchant = merchant.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
  const fileName = `${receiptDate}_${safeMerchant}_${amount}.${ext}`;

  /* Get the target year/month folder */
  const folderId = await getMonthFolder(receiptDate);

  /* Upload the file */
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
      supportsAllDrives: true,
    })
  );

  const fileId = res.data.id;

  /* Set sharing: "Anyone with link can view" so the Sheets link works */
  await withGoogleRetry(() =>
    drive.permissions.create({
      fileId,
      requestBody: { role: 'reader', type: 'anyone' },
      supportsAllDrives: true,
    })
  );

  /* Fetch the shareable link */
  const fileInfo = await drive.files.get({
    fileId,
    fields: 'webViewLink',
    supportsAllDrives: true,
  });

  const webViewLink = fileInfo.data.webViewLink;
  logger.info('Receipt uploaded to Drive', { fileId, fileName, folder: receiptDate });

  return { fileId, webViewLink, fileName };
}

module.exports = { uploadReceiptToDrive };
