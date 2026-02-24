/**
 * One-time script — moves TaskRefs and receipts folders to new parent locations.
 *
 * Moves:
 * 1. TaskRefs → Bryan's specified Drive folder (1t5jYWLBo_...)
 * 2. receipts → External shared Drive folder (1G6dSyvG58-...)
 *
 * Folder IDs don't change — .env stays the same.
 * Usage: node scripts/move-folders.js
 */

require('dotenv').config();

const { google } = require('googleapis');

const oauth2 = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);
oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

const drive = google.drive({ version: 'v3', auth: oauth2 });

/* Current folder IDs from .env */
const TASK_REFS_FOLDER_ID = process.env.GDRIVE_TASK_REFS_FOLDER_ID;
const RECEIPTS_FOLDER_ID = process.env.GDRIVE_RECEIPTS_FOLDER_ID;

/* New parent destinations */
const NEW_TASK_REFS_PARENT = '1t5jYWLBo_IL2ktlvkN_K-s8GbxZxAi1q';
const NEW_RECEIPTS_PARENT = '1G6dSyvG58-LWh7y07M0JuiUTTlIasu-J';

/**
 * Moves a folder to a new parent by updating its parents.
 * Gets current parents first, then removes old + adds new in one call.
 */
async function moveFolder(folderId, newParentId, label) {
  /* Get current parent(s) */
  const file = await drive.files.get({
    fileId: folderId,
    fields: 'id, name, parents',
    supportsAllDrives: true,
  });

  const currentParents = (file.data.parents || []).join(',');
  console.log(`  ${label}: "${file.data.name}" (${folderId})`);
  console.log(`    Current parent(s): ${currentParents}`);
  console.log(`    Moving to: ${newParentId}`);

  /* Move: remove old parent(s), add new parent */
  await drive.files.update({
    fileId: folderId,
    addParents: newParentId,
    removeParents: currentParents,
    supportsAllDrives: true,
    fields: 'id, parents',
  });

  console.log(`    Done!\n`);
}

async function main() {
  console.log('Moving Google Drive folders...\n');

  /* 1. Move TaskRefs folder */
  await moveFolder(TASK_REFS_FOLDER_ID, NEW_TASK_REFS_PARENT, 'TaskRefs');

  /* 2. Move receipts folder (to external shared Drive) */
  await moveFolder(RECEIPTS_FOLDER_ID, NEW_RECEIPTS_PARENT, 'receipts');

  console.log('All folders moved. .env folder IDs remain unchanged.');
}

main().catch((err) => {
  console.error('Move failed:', err.message);
  if (err.errors) console.error('Details:', JSON.stringify(err.errors, null, 2));
  process.exit(1);
});
