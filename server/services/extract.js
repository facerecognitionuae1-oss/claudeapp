// Text extraction from uploaded files. Fails soft: returns '' plus a note on unsupported/failed formats.
const fs = require('fs');
const path = require('path');

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

    if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext))
      return `[Image file: ${originalName}. Text extraction (OCR) not configured — review manually or describe the image content in the brief.]`;

    return `[Unsupported format ${ext}: content not extracted. Reviewers should open the file manually.]`;
  } catch (err) {
    return `[Extraction failed for ${originalName}: ${err.message}]`;
  }
}

module.exports = { extractText };
