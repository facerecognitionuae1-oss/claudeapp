// PPTX generation using pptxgenjs — creative UAE federal design system.
// Layouts: title, section, bullets, two_column, stats, quote, closing.
const path = require('path');
const fs = require('fs');
const config = require('../config');

const C = {
  charcoal: '232323', charcoalSoft: '3A3A38', gold: 'B68A35', goldLight: 'D4B06A',
  goldTint: 'F6EFE0', light: 'F4F1EA', white: 'FFFFFF', grey: '8A857C',
  green: '007A3D', red: 'C3002F', ink: '2B2A28',
};
const W = 10, H = 5.63; // 16:9 inches

function flagStrip(s, y) {
  s.addShape('rect', { x: 0, y, w: 1.0, h: 0.07, fill: { color: C.red } });
  s.addShape('rect', { x: 1.0, y, w: 3.0, h: 0.07, fill: { color: C.green } });
  s.addShape('rect', { x: 4.0, y, w: 3.0, h: 0.07, fill: { color: C.white } });
  s.addShape('rect', { x: 7.0, y, w: 3.0, h: 0.07, fill: { color: C.charcoal } });
}

// Halftone dot fan — echoes the ICP falcon wing motif.
function dotFan(s, cx, cy, scale = 1) {
  const rows = [
    { color: C.red, dy: 0 },
    { color: C.green, dy: 0.28 * scale },
    { color: C.grey, dy: 0.56 * scale },
  ];
  for (const row of rows) {
    for (let i = 0; i < 8; i++) {
      const size = (0.20 - i * 0.021) * scale;
      if (size <= 0.03) continue;
      s.addShape('ellipse', {
        x: cx - i * 0.30 * scale, y: cy + row.dy - i * 0.16 * scale,
        w: size, h: size, fill: { color: row.color },
      });
    }
  }
}

function footer(s, pageNum, rtl) {
  s.addShape('line', { x: 0.5, y: H - 0.42, w: W - 1, h: 0, line: { color: 'E5E1D8', width: 0.75 } });
  s.addText('UAEICP Employee Intelligence Workspace — internal, requires human verification', {
    x: 0.5, y: H - 0.38, w: W - 1.6, h: 0.3, fontSize: 8.5, color: C.grey, align: rtl ? 'right' : 'left',
  });
  s.addText(String(pageNum), {
    x: rtl ? 0.5 : W - 1.0, y: H - 0.38, w: 0.5, h: 0.3, fontSize: 9, bold: true, color: C.gold,
    align: rtl ? 'left' : 'right',
  });
}

function contentHeader(s, title, pageNum, rtl) {
  s.addShape('rect', { x: 0, y: 0, w: W, h: 0.95, fill: { color: C.charcoal } });
  s.addShape('rect', { x: 0, y: 0.95, w: W, h: 0.06, fill: { color: C.gold } });
  s.addShape('ellipse', { x: rtl ? W - 0.95 : 0.35, y: 0.22, w: 0.52, h: 0.52, fill: { color: C.gold } });
  s.addText(String(pageNum), { x: rtl ? W - 0.95 : 0.35, y: 0.22, w: 0.52, h: 0.52, fontSize: 15, bold: true, color: C.white, align: 'center', valign: 'middle' });
  s.addText(title || '', {
    x: rtl ? 0.5 : 1.05, y: 0.12, w: W - 1.6, h: 0.72, fontSize: 21, bold: true, color: C.white,
    align: rtl ? 'right' : 'left', valign: 'middle',
  });
}

async function buildDeck(spec, fileBase, rtl) {
  const PptxGenJS = require('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = 'UAEICP Employee Intelligence Workspace';
  if (rtl) pptx.rtlMode = true;
  const align = rtl ? 'right' : 'left';
  let page = 1;

  // ── Title slide ──
  let s = pptx.addSlide();
  s.background = { color: C.charcoal };
  s.addShape('ellipse', { x: W - 3.2, y: -1.6, w: 4.6, h: 4.6, fill: { color: C.charcoalSoft } });
  s.addShape('ellipse', { x: W - 2.6, y: -1.0, w: 3.4, h: 3.4, line: { color: C.gold, width: 1.5 }, fill: { type: 'none' } });
  dotFan(s, W - 1.7, 1.15, 1.15);
  s.addText(spec.title || 'Briefing', {
    x: 0.6, y: 1.7, w: W - 3.4, h: 1.5, fontSize: 33, bold: true, color: C.white, align, valign: 'top',
  });
  s.addShape('rect', { x: rtl ? W - 2.1 : 0.65, y: 1.45, w: 1.45, h: 0.09, fill: { color: C.gold } });
  s.addText(spec.subtitle || '', { x: 0.6, y: 3.25, w: W - 3.2, h: 0.9, fontSize: 15, color: C.goldLight, align });
  s.addText('UAEICP • Internal — for employee use only', {
    x: 0.6, y: 4.55, w: W - 1.2, h: 0.4, fontSize: 11, color: C.grey, align,
  });
  flagStrip(s, H - 0.07);

  let sectionNo = 0;
  for (const slide of spec.slides || []) {
    const layout = slide.layout || 'bullets';
    const sl = pptx.addSlide();
    page += 1;

    if (layout === 'section') {
      sectionNo += 1;
      sl.background = { color: C.gold };
      sl.addShape('ellipse', { x: -1.4, y: H - 3.0, w: 4.4, h: 4.4, fill: { color: C.goldLight } });
      sl.addText(String(sectionNo).padStart(2, '0'), {
        x: rtl ? W - 3.2 : 0.5, y: 0.7, w: 2.6, h: 1.6, fontSize: 64, bold: true, color: C.charcoal, align,
      });
      sl.addText(slide.title || '', {
        x: 0.6, y: 2.5, w: W - 1.2, h: 1.6, fontSize: 30, bold: true, color: C.white, align,
      });
      flagStrip(sl, H - 0.07);
      if (slide.notes) sl.addNotes(String(slide.notes));
      continue;
    }

    sl.background = { color: C.white };
    contentHeader(sl, slide.title, page, rtl);

    if (layout === 'two_column') {
      const cols = [
        { title: slide.left_title, bullets: slide.left_bullets, x: 0.5 },
        { title: slide.right_title, bullets: slide.right_bullets, x: W / 2 + 0.1 },
      ];
      for (const col of cols) {
        sl.addShape('roundRect', { x: col.x, y: 1.25, w: W / 2 - 0.6, h: 3.7, rectRadius: 0.08, fill: { color: C.light } });
        sl.addText(col.title || '', { x: col.x + 0.2, y: 1.4, w: W / 2 - 1.0, h: 0.45, fontSize: 15, bold: true, color: C.gold, align });
        const bl = (col.bullets || []).map(b => ({
          text: String(b), options: { bullet: { code: '2022' }, color: C.ink, fontSize: 13, breakLine: true, align },
        }));
        if (bl.length) sl.addText(bl, { x: col.x + 0.2, y: 1.95, w: W / 2 - 1.0, h: 2.85, valign: 'top' });
      }
    } else if (layout === 'stats') {
      const stats = (slide.stats || []).slice(0, 4);
      const cw = (W - 1.0 - (stats.length - 1) * 0.3) / Math.max(stats.length, 1);
      stats.forEach((st, i) => {
        const x = 0.5 + i * (cw + 0.3);
        sl.addShape('roundRect', { x, y: 1.6, w: cw, h: 2.5, rectRadius: 0.1, fill: { color: C.goldTint }, line: { color: C.goldLight, width: 1 } });
        sl.addText(String(st.value ?? ''), { x, y: 1.85, w: cw, h: 1.1, fontSize: 34, bold: true, color: C.gold, align: 'center' });
        sl.addText(String(st.label ?? ''), { x: x + 0.15, y: 3.0, w: cw - 0.3, h: 0.95, fontSize: 12.5, color: C.ink, align: 'center', valign: 'top' });
      });
      if (slide.bullets && slide.bullets.length) {
        sl.addText((slide.bullets || []).map(b => ({
          text: String(b), options: { bullet: { code: '2022' }, color: C.grey, fontSize: 12, breakLine: true, align },
        })), { x: 0.5, y: 4.25, w: W - 1, h: 0.8, valign: 'top' });
      }
    } else if (layout === 'quote') {
      sl.addShape('roundRect', { x: 0.7, y: 1.5, w: W - 1.4, h: 3.0, rectRadius: 0.1, fill: { color: C.light } });
      sl.addText('“', { x: rtl ? W - 2.2 : 0.85, y: 1.15, w: 1.4, h: 1.4, fontSize: 88, bold: true, color: C.gold, align });
      sl.addText(String(slide.quote || ''), {
        x: 1.3, y: 2.05, w: W - 2.6, h: 1.8, fontSize: 17, italic: true, color: C.ink, align, valign: 'top',
      });
      sl.addText(String(slide.source || ''), {
        x: 1.3, y: 3.9, w: W - 2.6, h: 0.4, fontSize: 11, bold: true, color: C.gold, align,
      });
    } else { // bullets (default)
      dotFan(sl, rtl ? 1.5 : W - 0.7, 1.55, 0.55);
      const bullets = (slide.bullets || []).map(b => ({
        text: String(b), options: { bullet: { code: '2022', color: C.gold }, color: C.ink, fontSize: 15, breakLine: true, align, paraSpaceAfter: 8 },
      }));
      if (bullets.length) sl.addText(bullets, { x: rtl ? 0.5 : 0.6, y: 1.35, w: W - 2.0, h: 3.7, valign: 'top' });
    }

    footer(sl, page, rtl);
    if (slide.notes) sl.addNotes(String(slide.notes));
  }

  // ── Closing slide ──
  const end = pptx.addSlide();
  end.background = { color: C.charcoal };
  dotFan(end, W / 2 + 1.1, 1.6, 1.0);
  end.addText(rtl ? 'شكراً' : 'Thank you', {
    x: 0.6, y: 2.2, w: W - 1.2, h: 1.0, fontSize: 34, bold: true, color: C.white, align: 'center',
  });
  end.addText('UAEICP Employee Intelligence Workspace — AI output requires human verification', {
    x: 0.6, y: 3.3, w: W - 1.2, h: 0.5, fontSize: 11, color: C.goldLight, align: 'center',
  });
  flagStrip(end, H - 0.07);

  fs.mkdirSync(config.generatedDir, { recursive: true });
  const fileName = `${fileBase}.pptx`;
  await pptx.writeFile({ fileName: path.join(config.generatedDir, fileName) });
  return fileName;
}

module.exports = { buildDeck };
