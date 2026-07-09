// PPTX renderer — generic theme engine driven entirely by the AI's design spec.
// The model invents palette, decor style and fonts; this renders whatever it designs.
const path = require('path');
const fs = require('fs');
const config = require('../config');

const W = 10, H = 5.63; // 16:9 inches
const HEX = /^[0-9A-Fa-f]{6}$/;
const FONTS = ['Calibri', 'Arial', 'Georgia', 'Verdana', 'Trebuchet MS', 'Times New Roman'];

const hx = (v, d) => { const c = String(v || '').replace('#', '').trim(); return HEX.test(c) ? c.toUpperCase() : d; };

function normTheme(t) {
  t = t || {};
  const dark = t.dark !== false;
  const th = {
    name: String(t.name || ''),
    bg: hx(t.bg, dark ? '1A2238' : 'FAF8F4'),
    panel: hx(t.panel, dark ? '243154' : 'FFFFFF'),
    accent: hx(t.accent, 'FF6B4A'),
    accent2: hx(t.accent2, '3AA6B9'),
    text: hx(t.text, dark ? 'F5F5F0' : '20222A'),
    muted: hx(t.muted, dark ? '9AA5B8' : '77716A'),
    font: FONTS.includes(t.font) ? t.font : 'Calibri',
    style: ['geometric', 'circles', 'dots', 'bars', 'waves', 'minimal'].includes(t.style) ? t.style : 'circles',
    dark,
  };
  return th;
}

// deterministic pseudo-random per slide so decor varies across the deck
const rnd = (i, k) => (((i + 2) * (k + 3) * 2654435761) % 1000) / 1000;

function decor(sl, th, i, strong) {
  const tp = strong ? 55 : 82; // transparency
  const side = rnd(i, 1) > 0.5;
  if (th.style === 'circles') {
    sl.addShape('ellipse', { x: side ? W - 2.6 : -1.4, y: rnd(i, 2) * 3 - 1.2, w: 3.6, h: 3.6, fill: { color: th.accent, transparency: tp } });
    sl.addShape('ellipse', { x: side ? W - 1.2 : -0.6, y: rnd(i, 3) * 3, w: 1.6, h: 1.6, fill: { color: th.accent2, transparency: tp - 8 } });
  } else if (th.style === 'geometric') {
    sl.addShape('rect', { x: side ? W - 2.2 : -0.9, y: rnd(i, 2) * 2 - 0.8, w: 2.6, h: 2.6, rotate: 30 + rnd(i, 4) * 40, fill: { color: th.accent, transparency: tp } });
    sl.addShape('rect', { x: side ? W - 1.1 : -0.4, y: 2.4 + rnd(i, 3) * 2, w: 1.4, h: 1.4, rotate: 10 + rnd(i, 5) * 50, fill: { color: th.accent2, transparency: tp - 8 } });
  } else if (th.style === 'dots') {
    const bx = side ? W - 1.9 : 0.35, by = rnd(i, 2) > 0.5 ? 0.3 : H - 1.8;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++)
      sl.addShape('ellipse', { x: bx + c * 0.32, y: by + r * 0.32, w: 0.09, h: 0.09, fill: { color: (r + c) % 2 ? th.accent : th.accent2, transparency: strong ? 25 : 55 } });
  } else if (th.style === 'bars') {
    const bx = side ? W - 0.55 : 0;
    sl.addShape('rect', { x: bx, y: 0, w: 0.18, h: H, fill: { color: th.accent, transparency: strong ? 0 : 30 } });
    sl.addShape('rect', { x: side ? bx + 0.22 : 0.22, y: 0, w: 0.09, h: H, fill: { color: th.accent2, transparency: strong ? 10 : 45 } });
  } else if (th.style === 'waves') {
    for (let k = 0; k < 3; k++)
      sl.addShape('roundRect', { x: -1 - k * 0.4, y: H - 0.9 + k * 0.28, w: W + 2 + k, h: 1.6, rectRadius: 0.8, fill: { color: k % 2 ? th.accent : th.accent2, transparency: tp + k * 5 } });
  } else if (th.style === 'minimal' && strong) {
    sl.addShape('rect', { x: 0.6, y: H - 0.7, w: 1.6, h: 0.06, fill: { color: th.accent } });
  }
}

function header(sl, th, title, page, rtl) {
  const align = rtl ? 'right' : 'left';
  if (th.style === 'minimal') {
    sl.addText(title || '', { x: 0.6, y: 0.3, w: W - 1.2, h: 0.7, fontSize: 24, bold: true, color: th.text, align, fontFace: th.font });
    sl.addShape('rect', { x: rtl ? W - 2.1 : 0.62, y: 1.02, w: 1.5, h: 0.05, fill: { color: th.accent } });
  } else {
    sl.addShape('rect', { x: 0, y: 0, w: W, h: 0.92, fill: { color: th.panel } });
    sl.addShape('rect', { x: 0, y: 0.92, w: W, h: 0.05, fill: { color: th.accent } });
    sl.addShape('rect', { x: rtl ? W - 0.75 : 0.4, y: 0.3, w: 0.32, h: 0.32, rotate: 45, fill: { color: th.accent } });
    sl.addText(title || '', { x: rtl ? 0.5 : 0.95, y: 0.1, w: W - 1.6, h: 0.72, fontSize: 21, bold: true, color: th.text, align, valign: 'middle', fontFace: th.font });
  }
  sl.addText(String(page), { x: rtl ? 0.25 : W - 0.65, y: H - 0.42, w: 0.4, h: 0.3, fontSize: 10, bold: true, color: th.accent, align: 'center', fontFace: th.font });
}

const bulletOpts = (th, align, size = 15) => b => ({
  text: String(b), options: { bullet: { code: '2022', color: th.accent }, color: th.text, fontSize: size, breakLine: true, align, paraSpaceAfter: 8, fontFace: th.font },
});

async function buildDeck(spec, fileBase, rtl) {
  const PptxGenJS = require('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = 'UAEICP Employee Intelligence Workspace';
  if (rtl) pptx.rtlMode = true;
  const th = normTheme(spec.theme);
  const align = rtl ? 'right' : 'left';
  const F = th.font;
  let page = 1;

  // ── Title slide ──
  let s = pptx.addSlide();
  s.background = { color: th.bg };
  decor(s, th, 0, true);
  if (th.name) s.addText(th.name.toUpperCase(), { x: 0.62, y: 0.5, w: 5, h: 0.35, fontSize: 11, bold: true, color: th.accent2, charSpacing: 3, align, fontFace: F });
  s.addShape('rect', { x: rtl ? W - 2.3 : 0.65, y: 1.35, w: 1.6, h: 0.1, fill: { color: th.accent } });
  s.addText(spec.title || 'Briefing', { x: 0.6, y: 1.6, w: W - 2.6, h: 1.7, fontSize: 36, bold: true, color: th.text, align, valign: 'top', fontFace: F });
  s.addText(spec.subtitle || '', { x: 0.6, y: 3.45, w: W - 2.8, h: 0.9, fontSize: 15, color: th.muted, align, fontFace: F });
  s.addText('UAEICP • Internal — requires human verification', { x: 0.6, y: H - 0.55, w: W - 1.2, h: 0.35, fontSize: 10, color: th.muted, align, fontFace: F });

  let sectionNo = 0;
  for (const slide of spec.slides || []) {
    const layout = slide.layout || 'bullets';
    const sl = pptx.addSlide();
    sl.background = { color: th.bg };
    page += 1;

    if (layout === 'section') {
      sectionNo += 1;
      sl.background = { color: th.panel };
      decor(sl, th, page, true);
      sl.addText(String(sectionNo).padStart(2, '0'), { x: rtl ? W - 3.4 : 0.55, y: 0.6, w: 2.8, h: 1.8, fontSize: 72, bold: true, color: th.accent, align, fontFace: F });
      sl.addShape('rect', { x: rtl ? W - 3.3 : 0.62, y: 2.6, w: 1.2, h: 0.08, fill: { color: th.accent2 } });
      sl.addText(slide.title || '', { x: 0.6, y: 2.85, w: W - 1.2, h: 1.6, fontSize: 30, bold: true, color: th.text, align, fontFace: F });
      if (slide.notes) sl.addNotes(String(slide.notes));
      continue;
    }

    decor(sl, th, page, false);
    header(sl, th, slide.title, page, rtl);
    const top = th.style === 'minimal' ? 1.35 : 1.25;

    if (layout === 'agenda') {
      (slide.bullets || []).slice(0, 8).forEach((b, i2) => {
        const y = top + i2 * 0.52;
        sl.addShape('ellipse', { x: rtl ? W - 1.05 : 0.6, y: y + 0.03, w: 0.36, h: 0.36, fill: { color: i2 % 2 ? th.accent2 : th.accent } });
        sl.addText(String(i2 + 1), { x: rtl ? W - 1.05 : 0.6, y: y + 0.03, w: 0.36, h: 0.36, fontSize: 12, bold: true, color: th.dark ? th.bg : 'FFFFFF', align: 'center', valign: 'middle', fontFace: F });
        sl.addText(String(b), { x: rtl ? 0.6 : 1.12, y, w: W - 1.9, h: 0.45, fontSize: 14.5, color: th.text, align, valign: 'middle', fontFace: F });
      });
    } else if (layout === 'two_column') {
      const cols = [
        { title: slide.left_title, bullets: slide.left_bullets, x: 0.5, ac: th.accent },
        { title: slide.right_title, bullets: slide.right_bullets, x: W / 2 + 0.1, ac: th.accent2 },
      ];
      for (const col of cols) {
        sl.addShape('roundRect', { x: col.x, y: top, w: W / 2 - 0.6, h: H - top - 0.55, rectRadius: 0.08, fill: { color: th.panel } });
        sl.addShape('rect', { x: col.x, y: top, w: W / 2 - 0.6, h: 0.09, fill: { color: col.ac } });
        sl.addText(col.title || '', { x: col.x + 0.2, y: top + 0.18, w: W / 2 - 1.0, h: 0.45, fontSize: 15, bold: true, color: col.ac, align, fontFace: F });
        const bl = (col.bullets || []).map(bulletOpts(th, align, 13));
        if (bl.length) sl.addText(bl, { x: col.x + 0.2, y: top + 0.7, w: W / 2 - 1.0, h: H - top - 1.35, valign: 'top' });
      }
    } else if (layout === 'stats') {
      const stats = (slide.stats || []).slice(0, 4);
      const cw = (W - 1.0 - (stats.length - 1) * 0.3) / Math.max(stats.length, 1);
      stats.forEach((st, i2) => {
        const x = 0.5 + i2 * (cw + 0.3);
        sl.addShape('roundRect', { x, y: top + 0.3, w: cw, h: 2.5, rectRadius: 0.1, fill: { color: th.panel } });
        sl.addShape('rect', { x: x + cw / 2 - 0.35, y: top + 0.3, w: 0.7, h: 0.07, fill: { color: i2 % 2 ? th.accent2 : th.accent } });
        sl.addText(String(st.value ?? ''), { x, y: top + 0.55, w: cw, h: 1.1, fontSize: 34, bold: true, color: i2 % 2 ? th.accent2 : th.accent, align: 'center', fontFace: F });
        sl.addText(String(st.label ?? ''), { x: x + 0.12, y: top + 1.7, w: cw - 0.24, h: 0.95, fontSize: 12.5, color: th.text, align: 'center', valign: 'top', fontFace: F });
      });
    } else if (layout === 'big_number') {
      sl.addText(String(slide.value ?? ''), { x: 0.5, y: top + 0.2, w: W - 1, h: 2.1, fontSize: 84, bold: true, color: th.accent, align: 'center', fontFace: F });
      sl.addText(String(slide.caption ?? ''), { x: 1.2, y: top + 2.45, w: W - 2.4, h: 1.0, fontSize: 16, color: th.text, align: 'center', valign: 'top', fontFace: F });
    } else if (layout === 'timeline') {
      const steps = (slide.steps || []).slice(0, 5);
      const y = top + 1.5;
      sl.addShape('line', { x: 0.8, y: y + 0.18, w: W - 1.6, h: 0, line: { color: th.muted, width: 1.5 } });
      steps.forEach((st, i2) => {
        const x = 0.8 + (steps.length === 1 ? 0 : i2 * ((W - 1.6) / (steps.length - 1)));
        sl.addShape('ellipse', { x: x - 0.18, y, w: 0.36, h: 0.36, fill: { color: i2 % 2 ? th.accent2 : th.accent } });
        sl.addText(String(st.label ?? ''), { x: x - 0.9, y: y - 0.6, w: 1.8, h: 0.4, fontSize: 13, bold: true, color: i2 % 2 ? th.accent2 : th.accent, align: 'center', fontFace: F });
        sl.addText(String(st.text ?? ''), { x: x - 0.95, y: y + 0.5, w: 1.9, h: 1.5, fontSize: 11, color: th.text, align: 'center', valign: 'top', fontFace: F });
      });
    } else if (layout === 'quote') {
      sl.addShape('roundRect', { x: 0.7, y: top + 0.15, w: W - 1.4, h: 3.0, rectRadius: 0.1, fill: { color: th.panel } });
      sl.addText('“', { x: rtl ? W - 2.2 : 0.85, y: top - 0.25, w: 1.4, h: 1.4, fontSize: 90, bold: true, color: th.accent, align, fontFace: 'Georgia' });
      sl.addText(String(slide.quote || ''), { x: 1.3, y: top + 0.75, w: W - 2.6, h: 1.7, fontSize: 17, italic: true, color: th.text, align, valign: 'top', fontFace: F });
      sl.addText(String(slide.source || ''), { x: 1.3, y: top + 2.55, w: W - 2.6, h: 0.4, fontSize: 11, bold: true, color: th.accent2, align, fontFace: F });
    } else { // bullets
      const bullets = (slide.bullets || []).map(bulletOpts(th, align));
      if (bullets.length) sl.addText(bullets, { x: rtl ? 0.9 : 0.6, y: top + 0.1, w: W - 1.9, h: H - top - 0.7, valign: 'top' });
    }

    if (slide.notes) sl.addNotes(String(slide.notes));
  }

  // ── Closing slide ──
  const end = pptx.addSlide();
  end.background = { color: th.bg };
  decor(end, th, 99, true);
  end.addText(rtl ? 'شكراً' : 'Thank you', { x: 0.6, y: 2.0, w: W - 1.2, h: 1.1, fontSize: 40, bold: true, color: th.text, align: 'center', fontFace: F });
  end.addShape('rect', { x: W / 2 - 0.8, y: 3.2, w: 1.6, h: 0.08, fill: { color: th.accent } });
  end.addText('UAEICP Employee Intelligence Workspace — AI output requires human verification', {
    x: 0.6, y: 3.5, w: W - 1.2, h: 0.5, fontSize: 11, color: th.muted, align: 'center', fontFace: F,
  });

  fs.mkdirSync(config.generatedDir, { recursive: true });
  const fileName = `${fileBase}.pptx`;
  await pptx.writeFile({ fileName: path.join(config.generatedDir, fileName) });
  return fileName;
}

module.exports = { buildDeck };
