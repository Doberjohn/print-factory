import { SHEETS, MARK_OFFSET, MARK_LEN } from "./config.js";

/* ---------- geometry (single source of truth) ---------- */
const r3 = v => Math.round(v * 1000) / 1000;
export const fmt = v => String(Math.round(v * 100) / 100);

function sheetSize(c) {
  return c.sheet === "custom" ? [Math.max(50, c.pageW), Math.max(50, c.pageH)] : SHEETS[c.sheet] || SHEETS.a4;
}

export function computeLayout(c) {
  const [W, H] = sheetSize(c);
  const cols = c.cols, rows = c.rows;
  const w = Math.max(10, c.cardW), h = Math.max(10, c.cardH);
  const g = Math.max(0, c.gap || 0), b = Math.max(0, c.bleed || 0);
  const gridW = cols * w + (cols - 1) * g, gridH = rows * h + (rows - 1) * g;
  const x0 = r3((W - gridW) / 2), y0 = r3((H - gridH) / 2);
  const warnings = [];
  if (x0 < 0 || y0 < 0) warnings.push(`The grid (${fmt(gridW)} × ${fmt(gridH)} mm) is bigger than the sheet. Reduce the gap or use a larger sheet.`);
  const bIn = g > 0 ? Math.min(b, g / 2) : 0;
  const bOx = Math.max(0, Math.min(b, x0)), bOy = Math.max(0, Math.min(b, y0));
  if (b > 0 && g === 0) warnings.push("With no gap, cards share a cut line, so bleed only goes on the outer edges of the grid.");
  else if (g > 0 && b > g / 2) warnings.push(`Bleed between cards is limited to half the gap (${fmt(bIn)} mm).`);
  const cards = [];
  for (let r = 0; r < rows; r++) for (let col = 0; col < cols; col++) {
    cards.push({
      x: r3(x0 + col * (w + g)), y: r3(y0 + r * (h + g)), w, h,
      bl: col === 0 ? bOx : bIn, br: col === cols - 1 ? bOx : bIn,
      bt: r === 0 ? bOy : bIn, bb: r === rows - 1 ? bOy : bIn
    });
  }
  const uniq = a => [...new Set(a.map(r3))].sort((p, q) => p - q);
  const cutsX = uniq(cards.flatMap(k => [k.x, k.x + w]));
  const cutsY = uniq(cards.flatMap(k => [k.y, k.y + h]));

  const marks = [];
  let markSides = 0;
  if (c.marks) {
    const topStart = y0 - bOy - MARK_OFFSET, botStart = y0 + gridH + bOy + MARK_OFFSET;
    const leftStart = x0 - bOx - MARK_OFFSET, rightStart = x0 + gridW + bOx + MARK_OFFSET;
    const lenTop = Math.min(MARK_LEN, topStart), lenBot = Math.min(MARK_LEN, H - botStart);
    const lenLeft = Math.min(MARK_LEN, leftStart), lenRight = Math.min(MARK_LEN, W - rightStart);
    if (lenTop >= 1) { markSides++; cutsX.forEach(x => marks.push([x, topStart, x, topStart - lenTop])); }
    if (lenBot >= 1) { markSides++; cutsX.forEach(x => marks.push([x, botStart, x, botStart + lenBot])); }
    if (lenLeft >= 1) { markSides++; cutsY.forEach(y => marks.push([leftStart, y, leftStart - lenLeft, y])); }
    if (lenRight >= 1) { markSides++; cutsY.forEach(y => marks.push([rightStart, y, rightStart + lenRight, y])); }
    if (markSides < 4 && x0 >= 0 && y0 >= 0) warnings.push("The margins are too narrow for crop marks on every side. Some marks were left out.");
  }
  const labelY = H - 2.5;
  const labelFits = c.labels && (H - (y0 + gridH + bOy + (c.marks ? MARK_OFFSET + MARK_LEN : 0))) >= 4.5;
  return { W, H, w, h, g, b, cols, rows, x0, y0, gridW, gridH, bIn, bOx, bOy, cards, cutsX, cutsY, marks, warnings, labelY, labelFits };
}
