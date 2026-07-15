// PPTX renderer v3 — a design engine fully driven by the AI's spec.
// The model controls palette, fonts, decor, per-slide backgrounds, free-form
// color blocks (percent coordinates), title treatment and full-bleed imagery.
const path = require('path');
const fs = require('fs');
const config = require('../config');

const W = 10, H = 5.63; // 16:9 inches
const HEX = /^[0-9A-Fa-f]{6}$/;
const FONTS = ['Calibri', 'Arial', 'Georgia', 'Verdana', 'Trebuchet MS', 'Times New Roman',
  'Segoe UI', 'Tahoma', 'Garamond', 'Book Antiqua', 'Century Gothic', 'Impact'];

const hx = (v, d) => { const c = String(v || '').replace('#', '').trim(); return HEX.test(c) ? c.toUpperCase() : d; };
const clamp = (n, a, b) => Math.max(a, Math.min(b, Number(n) || 0));

function normTheme(t, rtl = false) {
  t = t || {};
  const dark = t.dark !== false;
  const fallbackFont = rtl ? 'Arial' : 'Calibri';
  const font = FONTS.includes(t.font) ? t.font : fallbackFont;
  const headingFallback = rtl ? 'Arial' : font;
  return {
    name: String(t.name || ''),
    bg: hx(t.bg, dark ? '1A2238' : 'FAF8F4'),
    panel: hx(t.panel, dark ? '243154' : 'FFFFFF'),
    accent: hx(t.accent, 'FF6B4A'),
    accent2: hx(t.accent2, '3AA6B9'),
    text: hx(t.text, dark ? 'F5F5F0' : '20222A'),
    muted: hx(t.muted, dark ? '9AA5B8' : '77716A'),
    font,
    headingFont: FONTS.includes(t.heading_font) ? t.heading_font : headingFallback,
    style: ['geometric', 'circles', 'dots', 'bars', 'waves', 'minimal'].includes(t.style) ? t.style : 'circles',
    dark,
  };
}

// Named colors let the AI say "accent" / "panel" instead of repeating hex codes.
function resolve(v, th, d) {
  if (v === undefined || v === null || v === '') return d;
  const map = { accent: th.accent, accent2: th.accent2, panel: th.panel, bg: th.bg, text: th.text, muted: th.muted, white: 'FFFFFF', black: '111111' };
  const key = String(v).toLowerCase();
  if (map[key]) return map[key];
  return hx(v, d);
}

// deterministic pseudo-random per slide so decor varies across the deck
const rnd = (i, k) => (((i + 2) * (k + 3) * 2654435761) % 1000) / 1000;

function decor(sl, th, i, strong) {
  const tp = strong ? 55 : 82;
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

// AI free-form composition: blocks in percent coordinates, drawn behind content.
function drawBlocks(sl, D, th) {
  const list = Array.isArray(D.blocks) ? D.blocks.slice(0, 8) : [];
  for (const b of list) {
    const shape = ['rect', 'ellipse', 'roundRect'].includes(b.shape) ? b.shape : 'rect';
    const opt = {
      x: W * clamp(b.x, -20, 100) / 100, y: H * clamp(b.y, -20, 100) / 100,
      w: W * clamp(b.w, 1, 140) / 100, h: H * clamp(b.h, 1, 140) / 100,
      fill: { color: resolve(b.color, th, th.accent) },
    };
    if (b.transparency) opt.fill.transparency = clamp(b.transparency, 0, 95);
    if (b.rotate) opt.rotate = clamp(b.rotate, -180, 180);
    if (shape === 'roundRect') opt.rectRadius = 0.12;
    sl.addShape(shape, opt);
  }
  return list.length > 0;
}

function header(sl, th, slide, page, rtl) {
  const D = slide.design || {};
  const align = rtl ? 'right' : 'left';
  const tColor = resolve(D.title_color, th, th.text);
  const custom = (D.blocks && D.blocks.length) || D.image_full; // AI composed the canvas — keep chrome light
  const tSize = D.title_size ? clamp(D.title_size, 14, 44) : (th.style === 'minimal' || custom ? 24 : 21);
  if (th.style === 'minimal' || custom || D.no_band) {
    sl.addText(slide.title || '', { x: 0.6, y: 0.3, w: W - 1.2, h: 0.75, fontSize: tSize, bold: true, color: tColor, align, fontFace: th.headingFont });
    sl.addShape('rect', { x: rtl ? W - 2.1 : 0.62, y: 1.06, w: 1.5, h: 0.05, fill: { color: resolve(D.rule_color, th, th.accent) } });
  } else {
    sl.addShape('rect', { x: 0, y: 0, w: W, h: 0.92, fill: { color: th.panel } });
    sl.addShape('rect', { x: 0, y: 0.92, w: W, h: 0.05, fill: { color: th.accent } });
    sl.addShape('rect', { x: rtl ? W - 0.75 : 0.4, y: 0.3, w: 0.32, h: 0.32, rotate: 45, fill: { color: th.accent } });
    sl.addText(slide.title || '', { x: rtl ? 0.5 : 0.95, y: 0.1, w: W - 1.6, h: 0.72, fontSize: tSize, bold: true, color: tColor, align, valign: 'middle', fontFace: th.headingFont });
  }
  sl.addText(String(page), { x: rtl ? 0.25 : W - 0.65, y: H - 0.42, w: 0.4, h: 0.3, fontSize: 10, bold: true, color: th.accent, align: 'center', fontFace: th.font });
}

const bulletOpts = (th, align, size, color) => b => ({
  text: String(b), options: { bullet: { code: '2022', color: th.accent }, color: color || th.text, fontSize: size || 15, breakLine: true, align, paraSpaceAfter: 8, fontFace: th.font },
});

const imgData = buf => 'image/png;base64,' + buf.toString('base64');

async function buildDeck(spec, fileBase, rtl, images = {}) {
  const PptxGenJS = require('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = 'UAEICP Employee Intelligence Workspace';
  if (rtl) pptx.rtlMode = true;
  const th = normTheme(spec.theme, rtl);
  const align = rtl ? 'right' : 'left';
  const F = th.font, HF = th.headingFont;
  let page = 1;

  // ── Title slide (AI may compose it too via spec.design) ──
  let s = pptx.addSlide();
  const TD = spec.design || {};
  s.background = { color: resolve(TD.bg, th, th.bg) };
  const cover = images.cover;
  const tw = cover ? W * 0.55 : W;
  if (cover && TD.image_full) {
    s.addImage({ data: imgData(cover), x: 0, y: 0, w: W, h: H, sizing: { type: 'cover', w: W, h: H } });
    s.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: resolve(TD.bg, th, th.bg), transparency: 35 } });
  } else if (cover) {
    s.addImage({ data: imgData(cover), x: rtl ? 0 : tw, y: 0, w: W - tw, h: H, sizing: { type: 'cover', w: W - tw, h: H } });
    s.addShape('rect', { x: rtl ? W - tw - 0.06 : tw - 0.06, y: 0, w: 0.12, h: H, fill: { color: th.accent } });
  }
  const hadBlocks = drawBlocks(s, TD, th);
  if (!cover && !hadBlocks) decor(s, th, 0, true);
  const fullTitle = (cover && TD.image_full) || !cover;
  const ttw = fullTitle ? W : tw;
  const tx = rtl && cover && !TD.image_full ? W - tw + 0.4 : 0.6;
  if (th.name) s.addText(th.name.toUpperCase(), { x: tx + 0.02, y: 0.5, w: ttw - 1.2, h: 0.35, fontSize: 11, bold: true, color: th.accent2, charSpacing: 3, align, fontFace: F });
  s.addShape('rect', { x: rtl ? W - 2.3 : tx + 0.05, y: 1.35, w: 1.6, h: 0.1, fill: { color: th.accent } });
  s.addText(spec.title || 'Briefing', { x: tx, y: 1.6, w: ttw - 1.1, h: 1.7, fontSize: TD.title_size ? clamp(TD.title_size, 20, 48) : (cover ? 32 : 36), bold: true, color: resolve(TD.title_color, th, th.text), align, valign: 'top', fontFace: HF });
  s.addText(spec.subtitle || '', { x: tx, y: 3.45, w: ttw - 1.2, h: 0.9, fontSize: 14, color: resolve(TD.text_color, th, th.muted), align, fontFace: F });
  s.addText(rtl ? 'مساحة عمل UAEICP الداخلية - يتطلب مراجعة بشرية' : 'UAEICP • Internal — requires human verification', { x: tx, y: H - 0.55, w: ttw - 1.2, h: 0.35, fontSize: 10, color: th.muted, align, fontFace: F });

  let sectionNo = 0;
  let slideIdx = -1;
  for (const slide of spec.slides || []) {
    slideIdx += 1;
    const imgBuf = images['s' + slideIdx] || null;
    const D = slide.design || {};
    let layout = slide.layout || 'bullets';
    if (layout === 'image_side' && !imgBuf) layout = 'bullets';
    const sl = pptx.addSlide();
    const slideBg = resolve(D.bg, th, layout === 'section' ? th.panel : th.bg);
    sl.background = { color: slideBg };
    page += 1;
    const bColor = resolve(D.text_color, th, th.text);

    if (layout === 'section') {
      const hb = drawBlocks(sl, D, th);
      if (!hb) decor(sl, th, page, true);
      sl.addText(String(++sectionNo).padStart(2, '0'), { x: rtl ? W - 3.4 : 0.55, y: 0.6, w: 2.8, h: 1.8, fontSize: 72, bold: true, color: resolve(D.title_color, th, th.accent), align, fontFace: HF });
      sl.addShape('rect', { x: rtl ? W - 3.3 : 0.62, y: 2.6, w: 1.2, h: 0.08, fill: { color: th.accent2 } });
      sl.addText(slide.title || '', { x: 0.6, y: 2.85, w: W - 1.2, h: 1.6, fontSize: 30, bold: true, color: bColor, align, fontFace: HF });
      if (slide.notes) sl.addNotes(String(slide.notes));
      continue;
    }

    // Full-bleed imagery with a readability overlay, when the AI asks for it.
    if (imgBuf && D.image_full) {
      sl.addImage({ data: imgData(imgBuf), x: 0, y: 0, w: W, h: H, sizing: { type: 'cover', w: W, h: H } });
      sl.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: slideBg, transparency: clamp(D.overlay ?? 35, 10, 80) } });
    }
    const hasBlocks = drawBlocks(sl, D, th);
    if (!hasBlocks && !(imgBuf && D.image_full)) decor(sl, th, page, false);
    header(sl, th, slide, page, rtl);
    const top = (th.style === 'minimal' || hasBlocks || D.image_full || D.no_band) ? 1.35 : 1.25;

    if (layout === 'agenda') {
      (slide.bullets || []).slice(0, 8).forEach((b, i2) => {
        const y = top + i2 * 0.52;
        sl.addShape('ellipse', { x: rtl ? W - 1.05 : 0.6, y: y + 0.03, w: 0.36, h: 0.36, fill: { color: i2 % 2 ? th.accent2 : th.accent } });
        sl.addText(String(i2 + 1), { x: rtl ? W - 1.05 : 0.6, y: y + 0.03, w: 0.36, h: 0.36, fontSize: 12, bold: true, color: th.dark ? th.bg : 'FFFFFF', align: 'center', valign: 'middle', fontFace: F });
        sl.addText(String(b), { x: rtl ? 0.6 : 1.12, y, w: W - 1.9, h: 0.45, fontSize: 14.5, color: bColor, align, valign: 'middle', fontFace: F });
      });
    } else if (layout === 'two_column') {
      const cols = [
        { title: slide.left_title, bullets: slide.left_bullets, x: 0.5, ac: th.accent },
        { title: slide.right_title, bullets: slide.right_bullets, x: W / 2 + 0.1, ac: th.accent2 },
      ];
      for (const col of cols) {
        sl.addShape('roundRect', { x: col.x, y: top, w: W / 2 - 0.6, h: H - top - 0.55, rectRadius: 0.08, fill: { color: th.panel } });
        sl.addShape('rect', { x: col.x, y: top, w: W / 2 - 0.6, h: 0.09, fill: { color: col.ac } });
        sl.addText(col.title || '', { x: col.x + 0.2, y: top + 0.18, w: W / 2 - 1.0, h: 0.45, fontSize: 15, bold: true, color: col.ac, align, fontFace: HF });
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
        sl.addText(String(st.value ?? ''), { x, y: top + 0.55, w: cw, h: 1.1, fontSize: 34, bold: true, color: i2 % 2 ? th.accent2 : th.accent, align: 'center', fontFace: HF });
        sl.addText(String(st.label ?? ''), { x: x + 0.12, y: top + 1.7, w: cw - 0.24, h: 0.95, fontSize: 12.5, color: th.text, align: 'center', valign: 'top', fontFace: F });
      });
    } else if (layout === 'big_number') {
      sl.addText(String(slide.value ?? ''), { x: 0.5, y: top + 0.2, w: W - 1, h: 2.1, fontSize: 84, bold: true, color: resolve(D.title_color, th, th.accent), align: 'center', fontFace: HF });
      sl.addText(String(slide.caption ?? ''), { x: 1.2, y: top + 2.45, w: W - 2.4, h: 1.0, fontSize: 16, color: bColor, align: 'center', valign: 'top', fontFace: F });
    } else if (layout === 'timeline') {
      const steps = (slide.steps || []).slice(0, 5);
      const y = top + 1.5;
      sl.addShape('line', { x: 0.8, y: y + 0.18, w: W - 1.6, h: 0, line: { color: th.muted, width: 1.5 } });
      steps.forEach((st, i2) => {
        const x = 0.8 + (steps.length === 1 ? 0 : i2 * ((W - 1.6) / (steps.length - 1)));
        sl.addShape('ellipse', { x: x - 0.18, y, w: 0.36, h: 0.36, fill: { color: i2 % 2 ? th.accent2 : th.accent } });
        sl.addText(String(st.label ?? ''), { x: x - 0.9, y: y - 0.6, w: 1.8, h: 0.4, fontSize: 13, bold: true, color: i2 % 2 ? th.accent2 : th.accent, align: 'center', fontFace: HF });
        sl.addText(String(st.text ?? ''), { x: x - 0.95, y: y + 0.5, w: 1.9, h: 1.5, fontSize: 11, color: bColor, align: 'center', valign: 'top', fontFace: F });
      });
    } else if (layout === 'quote') {
      sl.addShape('roundRect', { x: 0.7, y: top + 0.15, w: W - 1.4, h: 3.0, rectRadius: 0.1, fill: { color: th.panel } });
      sl.addText('“', { x: rtl ? W - 2.2 : 0.85, y: top - 0.25, w: 1.4, h: 1.4, fontSize: 90, bold: true, color: th.accent, align, fontFace: 'Georgia' });
      sl.addText(String(slide.quote || ''), { x: 1.3, y: top + 0.75, w: W - 2.6, h: 1.7, fontSize: 17, italic: true, color: th.text, align, valign: 'top', fontFace: F });
      sl.addText(String(slide.source || ''), { x: 1.3, y: top + 2.55, w: W - 2.6, h: 0.4, fontSize: 11, bold: true, color: th.accent2, align, fontFace: F });
    } else if (layout === 'image_side' && !D.image_full) {
      const iw = 3.9;
      const ix = rtl ? 0 : W - iw;
      const iy = (th.style === 'minimal' || hasBlocks || D.no_band) ? 0 : 0.97;
      sl.addImage({ data: imgData(imgBuf), x: ix, y: iy, w: iw, h: H - iy, sizing: { type: 'cover', w: iw, h: H - iy } });
      sl.addShape('rect', { x: rtl ? iw - 0.05 : ix - 0.05, y: iy, w: 0.1, h: H, fill: { color: th.accent } });
      const bullets = (slide.bullets || []).map(bulletOpts(th, align, 14, bColor));
      if (bullets.length) sl.addText(bullets, { x: rtl ? iw + 0.4 : 0.6, y: top + 0.15, w: W - iw - 1.1, h: H - top - 0.7, valign: 'top' });
    } else { // bullets (with optional side image)
      if (imgBuf && !D.image_full) {
        const iw = 3.4;
        sl.addImage({ data: imgData(imgBuf), x: rtl ? 0.5 : W - iw - 0.5, y: top + 0.15, w: iw, h: H - top - 0.85, sizing: { type: 'cover', w: iw, h: H - top - 0.85 } });
        const bullets = (slide.bullets || []).map(bulletOpts(th, align, 14, bColor));
        if (bullets.length) sl.addText(bullets, { x: rtl ? iw + 1.1 : 0.6, y: top + 0.1, w: W - iw - 1.8, h: H - top - 0.7, valign: 'top' });
      } else {
        const bullets = (slide.bullets || []).map(bulletOpts(th, align, 15, bColor));
        if (bullets.length) sl.addText(bullets, { x: rtl ? 0.9 : 0.6, y: top + 0.1, w: W - 1.9, h: H - top - 0.7, valign: 'top' });
      }
    }

    if (slide.notes) sl.addNotes(String(slide.notes));
  }

  // ── Closing slide ──
  const end = pptx.addSlide();
  end.background = { color: th.bg };
  decor(end, th, 99, true);
  end.addText(rtl ? 'شكرا' : 'Thank you', { x: 0.6, y: 2.0, w: W - 1.2, h: 1.1, fontSize: 40, bold: true, color: th.text, align: 'center', fontFace: HF });
  end.addShape('rect', { x: W / 2 - 0.8, y: 3.2, w: 1.6, h: 0.08, fill: { color: th.accent } });
  end.addText(rtl ? 'مساحة عمل الذكاء المؤسسي لموظفي UAEICP - مخرجات الذكاء الاصطناعي تتطلب مراجعة بشرية' : 'UAEICP Employee Intelligence Workspace — AI output requires human verification', {
    x: 0.6, y: 3.5, w: W - 1.2, h: 0.5, fontSize: 11, color: th.muted, align: 'center', fontFace: F,
  });

  fs.mkdirSync(config.generatedDir, { recursive: true });
  const fileName = `${fileBase}.pptx`;
  await pptx.writeFile({ fileName: path.join(config.generatedDir, fileName) });
  return fileName;
}

module.exports = { buildDeck };
