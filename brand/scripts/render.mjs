// Utter brand renderer.
// Builds every SVG in brand/logo (lettering is converted to outlines, so no font is needed at
// view time) and renders PNGs with @resvg/resvg-js. Run:  cd brand && npm ci && npm run render
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { Resvg } from "@resvg/resvg-js";
import opentype from "opentype.js";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const P = JSON.parse(readFileSync(join(root, "palette.json"), "utf8")).core;
const C = {
  ink: P.ink,
  paper: P.paper,
  ember: P.ember,
  emberDark: P.emberDark,
  lilac: P.lilac,
  grey: "#8A8794",
};

const out = (rel, data) => {
  const f = join(root, rel);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, data);
};
const loadFont = (pkg, file) => {
  const buf = readFileSync(require.resolve(`@fontsource/${pkg}/files/${file}`));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
};
const serif = loadFont("instrument-serif", "instrument-serif-latin-400-normal.woff");
const serifItalic = loadFont("instrument-serif", "instrument-serif-latin-400-italic.woff");
const sans = loadFont("inter", "inter-latin-500-normal.woff");
const sansSemi = loadFont("inter", "inter-latin-600-normal.woff");

const r2 = (n) => Math.round(n * 100) / 100;

/** Text -> SVG path element. anchor: start | middle | end. Returns {svg, width}. */
function text(font, str, x, y, size, fill, { anchor = "start", spacing = 0, opacity = 1 } = {}) {
  const width = font.getAdvanceWidth(str, size, { letterSpacing: spacing });
  const x0 = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
  const d = font.getPath(str, x0, y, size, { letterSpacing: spacing }).toPathData(2);
  const op = opacity < 1 ? ` fill-opacity="${opacity}"` : "";
  return { svg: `<path d="${d}" fill="${fill}"${op}/>`, width };
}

// ---------------------------------------------------------------- the mark
// Pill 128x72. Three sound bars (Paper) on the left, a text caret (Ink) on the right:
// voice becoming text. Bars grow toward the caret; the caret is the tallest, thinnest piece.
const BARS = [
  { x: 29, h: 20 },
  { x: 47, h: 38 },
  { x: 65, h: 26 },
]; // x = left edge, width 9
const CARET = { x: 92, w: 7, h: 40 };
const bar = (x, h, w = 9) => `<rect x="${x}" y="${r2(36 - h / 2)}" width="${w}" height="${h}" rx="${w / 2}"/>`;
const barsSvg = () => BARS.map((b) => bar(b.x, b.h)).join("");
const caretSvg = () => bar(CARET.x, CARET.h, CARET.w);

const markBody = ({ pill = C.ember, bars = C.paper, caret = C.ink } = {}) =>
  `<rect width="128" height="72" rx="36" fill="${pill}"/>` +
  `<g fill="${bars}">${barsSvg()}</g><g fill="${caret}">${caretSvg()}</g>`;

const markSvg = (opts) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 72" width="128" height="72" role="img" aria-label="Utter">${markBody(opts)}</svg>\n`;

// Mono: solid pill with bars and caret knocked out, painted with one colour.
const markMonoSvg = (fill = C.ink) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 72" width="128" height="72" role="img" aria-label="Utter">` +
  `<defs><mask id="k"><rect width="128" height="72" fill="#fff"/><g fill="#000">${barsSvg()}${caretSvg()}</g></mask></defs>` +
  `<rect width="128" height="72" rx="36" fill="${fill}" mask="url(#k)"/></svg>\n`;

// ---------------------------------------------------------------- wordmark + lockup
function wordmarkParts(fill, size = 200) {
  const t = text(serif, "utter", 0, 0, size, fill);
  const bb = serif.getPath("utter", 0, 0, size).getBoundingBox();
  return { t, bb };
}
function wordmarkSvg(fill) {
  const { t, bb } = wordmarkParts(fill);
  const pad = 8;
  const w = r2(bb.x2 - bb.x1 + pad * 2);
  const h = r2(bb.y2 - bb.y1 + pad * 2);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r2(bb.x1 - pad)} ${r2(bb.y1 - pad)} ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="utter">` +
    `${t.svg}</svg>\n`
  );
}
// Lockup: mark left, wordmark right, optical centring on the x-height.
function lockupBody(fill, scaleMark = 1) {
  const size = 200;
  const bb = serif.getPath("utter", 0, 0, size).getBoundingBox();
  const xh = serif.getPath("x", 0, 0, size).getBoundingBox();
  const markW = 128 * scaleMark * 1.35;
  const k = markW / 128;
  const markH = 72 * k;
  const midY = (xh.y1 + xh.y2) / 2; // x-height centre, negative (above baseline)
  const my = midY - markH / 2;
  const gap = 36;
  const tx = markW + gap - bb.x1;
  const t = text(serif, "utter", tx, 0, size, fill);
  const top = Math.min(my, bb.y1);
  const bottom = Math.max(my + markH, bb.y2);
  return {
    svg: `<g transform="translate(0 ${r2(my)}) scale(${r2(k)})">${markBody()}</g>${t.svg}`,
    box: { x: 0, y: top, w: tx + bb.x2, h: bottom - top },
  };
}
function lockupSvg(fill) {
  const { svg, box } = lockupBody(fill);
  const pad = 10;
  const w = r2(box.w + pad * 2);
  const h = r2(box.h + pad * 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${r2(box.y - pad)} ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Utter">${svg}</svg>\n`;
}

// ---------------------------------------------------------------- app icon
const iconSvg = (size = 1024) => {
  const k = 6.6; // pill 845 wide
  const w = 128 * k;
  const h = 72 * k;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="${size}" height="${size}">` +
    `<rect width="1024" height="1024" rx="232" fill="${C.ink}"/>` +
    `<g transform="translate(${r2((1024 - w) / 2)} ${r2((1024 - h) / 2)}) scale(${k})">${markBody()}</g></svg>\n`
  );
};

// ---------------------------------------------------------------- tray glyphs (16 px grid)
// No pill at 16 px: bars + caret only, aligned to whole pixels. Recording swaps the caret for a dot.
function trayGlyph(state, theme) {
  const idle = theme === "light" ? C.ink : C.paper; // "light" = for light taskbars
  const paused = theme === "light" ? "#7A7785" : "#A19EAD";
  const fill = state === "idle" ? idle : state === "paused" ? paused : C.ember;
  const b = (x, h) => `<rect x="${x}" y="${8 - h / 2}" width="2" height="${h}" rx="1"/>`;
  const tail =
    state === "recording"
      ? `<circle cx="13" cy="8" r="2.5"/>`
      : `<rect x="12" y="2" width="2" height="12" rx="1"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16"><g fill="${fill}">${b(2, 4)}${b(5, 10)}${b(8, 6)}${tail}</g></svg>`;
}

// ---------------------------------------------------------------- social images
function socialSvg() {
  const W = 1280, H = 640;
  const head1 = text(serif, "Speak anywhere.", 80, 372, 96, C.paper);
  const head2 = text(serif, "Utter writes it.", 80, 478, 96, C.ember);
  const sub = text(sans, "Free, open source dictation for Windows.", 82, 546, 30, C.paper, { opacity: 0.72 });
  const sub2 = text(sans, "Local Whisper. Claude Haiku cleanup. Audio stays on your PC.", 82, 590, 24, C.paper, { opacity: 0.5 });
  const lock = lockupBody(C.paper, 0.5);
  const lk = 0.62;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    `<rect width="${W}" height="${H}" fill="${C.ink}"/>` +
    // oversized pill bleeding off the right edge
    `<g transform="translate(672 112) scale(4.4)" opacity="1">${markBody()}</g>` +
    `<g transform="translate(80 120) scale(${lk})">${lock.svg}</g>` +
    `${head1.svg}${head2.svg}${sub.svg}${sub2.svg}</svg>\n`
  );
}
function bannerSvg() {
  const W = 1600, H = 480;
  const lock = lockupBody(C.ink, 1);
  const tag = text(serif, "Speak anywhere. Utter writes it.", 120, 322, 52, C.ink);
  const sub = text(sans, "Free, open source dictation for Windows. Powered by Claude Haiku.", 122, 374, 24, C.ink, { opacity: 0.62 });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    `<rect width="${W}" height="${H}" fill="${C.paper}"/>` +
    `<g transform="translate(1000 89) scale(4.2)">${markBody()}</g>` +
    `<g transform="translate(120 180) scale(0.55)">${lock.svg}</g>` +
    `${tag.svg}${sub.svg}</svg>\n`
  );
}

// ---------------------------------------------------------------- write + render
function png(svg, width, rel, bg) {
  const r = new Resvg(svg, { fitTo: { mode: "width", value: width }, background: bg });
  out(rel, r.render().asPng());
}

out("logo/mark.svg", markSvg());
out("logo/mark-mono.svg", markMonoSvg(C.ink));
out("logo/wordmark.svg", wordmarkSvg(C.ink));
out("logo/wordmark-dark.svg", wordmarkSvg(C.paper));
out("logo/lockup.svg", lockupSvg(C.ink));
out("logo/lockup-dark.svg", lockupSvg(C.paper));

const icon = iconSvg();
out("icon/icon.svg", icon);
png(icon, 1024, "icon/icon-1024.png");
for (const s of [512, 256, 128, 64, 32, 16]) png(icon, s, `icon/icon-${s}.png`);

for (const state of ["idle", "recording", "paused"]) {
  for (const theme of ["light", "dark"]) {
    if (state === "recording" && theme === "dark") continue; // Ember reads on both
    const suffix = state === "recording" ? "" : theme === "dark" ? "-dark" : "";
    for (const s of [16, 24, 32]) {
      const svg = trayGlyph(state, theme);
      png(svg, s, `tray/tray-${state}${suffix}-${s}.png`);
      png(svg, s * 2, `tray/tray-${state}${suffix}-${s}@2x.png`);
    }
  }
}
out("tray/tray-idle.svg", trayGlyph("idle", "light"));
out("tray/tray-recording.svg", trayGlyph("recording", "light"));
out("tray/tray-paused.svg", trayGlyph("paused", "light"));

out("social/social-preview.svg", socialSvg());
png(socialSvg(), 1280, "social/social-preview.png");
out("social/readme-banner.svg", bannerSvg());
png(bannerSvg(), 1600, "social/readme-banner.png");

// Preview sheet used in BRAND.md and for visual QA.
const sheet = (() => {
  const cells = [];
  let y = 0;
  const row = (bg, fg) => {
    cells.push(`<rect x="0" y="${y}" width="900" height="200" fill="${bg}"/>`);
    let x = 40;
    for (const s of [16, 24, 32, 48]) {
      cells.push(`<g transform="translate(${x} ${y + 40}) scale(${s / 16})">${trayGlyph("idle", bg === C.paper ? "light" : "dark").replace(/<\/?svg[^>]*>/g, "")}</g>`);
      x += s + 36;
    }
    for (const s of [16, 32, 64]) {
      cells.push(`<g transform="translate(${x} ${y + 40}) scale(${s / 128})">${markBody()}</g>`);
      x += s + 40;
    }
    cells.push(`<g transform="translate(${x} ${y + 100 - lockupBody(fg).box.y * 0.28 - lockupBody(fg).box.h * 0.14}) scale(0.28)">${lockupBody(fg).svg}</g>`);
    y += 200;
  };
  row(C.paper, C.ink);
  row(C.ink, C.paper);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 ${y}" width="900" height="${y}">${cells.join("")}</svg>`;
})();
out("social/_preview-sheet.svg", sheet);
png(sheet, 1800, "social/_preview-sheet.png");

console.log("brand assets rendered");
