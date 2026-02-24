/**
 * One-time setup script — creates Google Drive folders and Sheets expense log.
 *
 * Creates:
 * 1. TaskRefs/ root folder with 5 stream subfolders (Minionions, KLN, Overdrive, Personal, Property)
 * 2. receipts/ root folder (for Bot 2, Phase 6)
 * 3. Google Sheets "Expense Log" spreadsheet (for Bot 2, Phase 6)
 *
 * After running, copy the output IDs to .env:
 *   GDRIVE_TASK_REFS_FOLDER_ID, GDRIVE_RECEIPTS_FOLDER_ID, GSHEETS_EXPENSE_LOG_ID
 *
 * Usage: node scripts/setup-google.js
 */

require('dotenv').config();

const { google } = require('googleapis');

/* Create auth client directly (can't import from src/ due to config requiring all env vars) */
const oauth2 = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);
oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

const drive = google.drive({ version: 'v3', auth: oauth2 });
const sheetsApi = google.sheets({ version: 'v4', auth: oauth2 });

/* Stream names — must match the Master Tasks DB select options */
const STREAMS = ['Minionions', 'KLN', 'Overdrive', 'Personal', 'Property'];

/**
 * Creates a folder in Google Drive and returns its ID.
 * If parentId is provided, creates it as a subfolder.
 */
async function createFolder(name, parentId) {
  const metadata = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) {
    metadata.parents = [parentId];
  }

  const res = await drive.files.create({
    requestBody: metadata,
    fields: 'id, name',
  });

  console.log(`  Created folder: ${name} (${res.data.id})`);
  return res.data.id;
}

/**
 * Creates the Google Sheets expense log with headers.
 * Returns the spreadsheet ID.
 */
async function createExpenseLog() {
  const res = await sheetsApi.spreadsheets.create({
    requestBody: {
      properties: { title: 'Expense Log — Telegram Bot' },
      sheets: [{
        properties: { title: 'Expenses' },
        data: [{
          startRow: 0,
          startColumn: 0,
          rowData: [{
            values: [
              { userEnteredValue: { stringValue: 'Date' } },
              { userEnteredValue: { stringValue: 'Merchant' } },
              { userEnteredValue: { stringValue: 'Amount' } },
              { userEnteredValue: { stringValue: 'Currency' } },
              { userEnteredValue: { stringValue: 'Category' } },
              { userEnteredValue: { stringValue: 'Receipt Link' } },
              { userEnteredValue: { stringValue: 'Notes' } },
              { userEnteredValue: { stringValue: 'Created At' } },
            ],
          }],
        }],
      }],
    },
  });

  const id = res.data.spreadsheetId;
  console.log(`  Created spreadsheet: Expense Log (${id})`);
  return id;
}

async function main() {
  console.log('Google Setup — Creating Drive folders + Sheets expense log\n');

  /* 1. Create TaskRefs root folder */
  console.log('1. Creating TaskRefs folder...');
  const taskRefsFolderId = await createFolder('TaskRefs');

  /* 2. Create stream subfolders under TaskRefs */
  console.log('\n2. Creating stream subfolders...');
  const streamFolders = {};
  for (const stream of STREAMS) {
    streamFolders[stream] = await createFolder(stream, taskRefsFolderId);
  }

  /* 3. Create receipts root folder */
  console.log('\n3. Creating receipts folder...');
  const receiptsFolderId = await createFolder('receipts');

  /* 4. Create Google Sheets expense log */
  console.log('\n4. Creating Sheets expense log...');
  const expenseLogId = await createExpenseLog();

  /* 5. Output the IDs for .env */
  console.log('\n' + '='.repeat(60));
  console.log('Add these to your .env file:\n');
  console.log(`GDRIVE_TASK_REFS_FOLDER_ID=${taskRefsFolderId}`);
  console.log(`GDRIVE_RECEIPTS_FOLDER_ID=${receiptsFolderId}`);
  console.log(`GSHEETS_EXPENSE_LOG_ID=${expenseLogId}`);
  console.log('\nStream subfolder IDs (for reference only — not needed in .env):');
  for (const [stream, id] of Object.entries(streamFolders)) {
    console.log(`  ${stream}: ${id}`);
  }
  console.log('='.repeat(60));
}

main().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
