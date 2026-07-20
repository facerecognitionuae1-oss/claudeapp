// Text extraction from uploaded files. Fails soft: returns '' plus a note on unsupported/failed formats.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const config = require('../config');

function runOcr(filePath, originalName) {
  if (!config.ocr.enabled) return null;
  return new Promise(resolve => {
    const args = [filePath, 'stdout', '-l', config.ocr.lang];
    execFile(config.ocr.command, args, { timeout: config.ocr.timeoutMs, maxBuffer: 5 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        console.warn(`[ocr] ${originalName}: ${err.message}`);
        return resolve(`[Image file: ${originalName}. OCR was enabled but failed (${err.message}). Review manually or describe the image content in the brief.]`);
      }
      const text = String(stdout || '').trim();
      resolve(text || `[Image file: ${originalName}. OCR ran but found no readable text. Review manually or describe the image content in the brief.]`);
    });
  });
}

async function extractText(filePath, mimeType, originalName) {
  const ext = path.extname(originalName || filePath).toLowerCase();
  try {
    if (ext === '.txt' || ext === '.md' || ext === '.csv' || ext === '.json' || ext === '.log')
      return fs.readFileSync(filePath, 'utf8');

    if (ext === '.pdf') {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(fs.readFileSync(filePath));
      return data.text || '';
    }

    if (ext === '.docx') {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value || '';
    }

    if (ext === '.xlsx' || ext === '.xls') {
      const XLSX = require('xlsx');
      const wb = XLSX.readFile(filePath);
      return wb.SheetNames.map(name =>
        `--- Sheet: ${name} ---\n` + XLSX.utils.sheet_to_csv(wb.Sheets[name])
      ).join('\n\n');
    }

    if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext)) {
      const ocr = await runOcr(filePath, originalName);
      return ocr || `[Image file: ${originalName}. OCR is disabled. Set OCR_ENABLED=true and install/configure Tesseract OCR to extract image text automatically; otherwise review manually or describe the image content in the brief.]`;
    }

    return `[Unsupported format ${ext}: content not extracted. Reviewers should open the file manually.]`;
  } catch (err) {
    return `[Extraction failed for ${originalName}: ${err.message}]`;
  }
}

module.exports = { extractText };
