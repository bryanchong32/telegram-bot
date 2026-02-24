/**
 * Office → PDF conversion via LibreOffice headless.
 *
 * Converts DOCX, XLSX, PPTX files to PDF for better Notion preview support.
 * Uses LibreOffice's headless mode: `libreoffice --headless --convert-to pdf {file}`
 *
 * VPS system dependency: `apt-get install libreoffice`
 * If LibreOffice is not installed or conversion fails, falls back to the original file.
 */

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const logger = require('../../utils/logger');

/* File extensions that should be converted to PDF */
const CONVERTIBLE_EXTENSIONS = new Set(['.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt']);

/**
 * Checks if a file should be converted to PDF based on its extension.
 *
 * @param {string} fileName — the original filename
 * @returns {boolean} — true if the file is a convertible Office format
 */
function shouldConvert(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  return CONVERTIBLE_EXTENSIONS.has(ext);
}

/**
 * Converts an Office document to PDF using LibreOffice headless mode.
 *
 * @param {string} filePath — local path to the Office document
 * @returns {Promise<{pdfPath: string, converted: boolean}>}
 *   - pdfPath: path to the converted PDF (or original file if conversion failed)
 *   - converted: true if conversion succeeded, false if fell back to original
 */
async function convertToPdf(filePath) {
  const dir = path.dirname(filePath);
  const baseName = path.basename(filePath, path.extname(filePath));
  const expectedPdf = path.join(dir, `${baseName}.pdf`);

  return new Promise((resolve) => {
    /* Run LibreOffice in headless mode to convert the file */
    execFile(
      'libreoffice',
      ['--headless', '--convert-to', 'pdf', '--outdir', dir, filePath],
      { timeout: 30000 }, /* 30s timeout — large files can take a while */
      (error, stdout, stderr) => {
        if (error) {
          logger.warn('PDF conversion failed — using original file', {
            error: error.message,
            filePath,
          });
          resolve({ pdfPath: filePath, converted: false });
          return;
        }

        /* Verify the PDF was actually created */
        if (fs.existsSync(expectedPdf)) {
          logger.info('PDF conversion succeeded', { pdfPath: expectedPdf });
          resolve({ pdfPath: expectedPdf, converted: true });
        } else {
          logger.warn('PDF conversion produced no output — using original file', { filePath });
          resolve({ pdfPath: filePath, converted: false });
        }
      }
    );
  });
}

module.exports = { shouldConvert, convertToPdf };
