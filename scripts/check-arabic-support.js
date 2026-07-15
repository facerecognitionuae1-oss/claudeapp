const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const checks = [
  ['server/routes/workspaces.js', 'تقرير مساحة العمل', 'Arabic workspace export title'],
  ['server/routes/workspaces.js', 'سجل الأسئلة والأجوبة', 'Arabic chat export heading'],
  ['server/routes/studio.js', 'عرض تقديمي', 'Arabic generated deck title'],
  ['server/routes/studio.js', 'إنفوجرافيك', 'Arabic infographic title'],
  ['server/services/search.js', 'translate useful search facts into natural Modern Standard Arabic', 'Arabic web-search translation rule'],
  ['server/services/prompts.js', 'do not label text as [GENERAL KNOWLEDGE] and do not show confidence labels', 'Chat hides general-knowledge/confidence labels'],
  ['server/routes/chat.js', 'cleanChatAnswer', 'Chat answer label sanitizer'],
  ['server/routes/chat.js', "require('../services/knowledge').retrieve", 'Assistant uses company knowledge context'],
  ['server/routes/analysis.js', "require('../services/knowledge').retrieve", 'Analysis uses company knowledge context'],
  ['server/routes/analysis.js', 'req.body?.web === true', 'Analysis web search gated by globe'],
  ['server/routes/studio.js', "require('../services/knowledge').retrieve", 'Studio uses company knowledge context'],
  ['server/routes/studio.js', 'req.body?.web === true', 'Studio web search gated by globe'],
  ['server/services/knowledge.js', 'PRIVATE COMPANY KNOWLEDGE BASE', 'Knowledge service formats private context'],
  ['server/routes/knowledge.js', 'Admin only', 'Admin-only knowledge API'],
  ['public/app.js', 'uploadKnowledge', 'Knowledge base admin UI'],
  ['server/services/pptx.js', "const ARABIC_FONT = 'Tahoma'", 'Arabic PPTX font fallback'],
  ['server/services/pptx.js', 'شكرا', 'Arabic PPTX closing text without harakat'],
  ['server/services/prompts.js', 'Do not use harakat', 'Arabic prompt no-harakat rule'],
  ['public/app.js', 'textDir', 'Dynamic message direction'],
  ['public/app.js', 'cleanAnalysis', 'Analysis citation cleanup'],
  ['public/styles.css', '.msg[dir="rtl"]', 'RTL chat bubble CSS'],
  ['public/styles.css', '.a-section[dir="rtl"]', 'RTL analysis CSS'],
];

let failed = 0;
for (const [file, needle, label] of checks) {
  const ok = read(file).includes(needle);
  console.log(`${ok ? 'ok' : 'FAIL'} - ${label}`);
  if (!ok) failed += 1;
}

if (failed) {
  console.error(`Arabic support check failed: ${failed} missing safeguard(s).`);
  process.exit(1);
}

console.log('Arabic support check passed.');
