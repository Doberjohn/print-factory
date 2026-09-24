/* ---------- settings ---------- */
export const SHEETS = { a4: [210, 297], letter: [215.9, 279.4] };
export const DEFAULTS = { cardW: 63.5, cardH: 88, gap: 3, bleed: 0, sheet: "a4", pageW: 210, pageH: 297,
  dpi: 600, marks: true, labels: true, rotate: true, enhance: true, fit: "stretch", cols: 3, rows: 3 };
export const STORE_KEY = "card-sheet-builder:settings:v2";
export const PREVIEW_DPI = 110;
export const MARK_OFFSET = 1, MARK_LEN = 5, MARK_WIDTH = 0.1;

export const cfg = loadCfg();

function loadCfg() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {}; } catch (e) { saved = {}; }
  return Object.assign({}, DEFAULTS, saved);
}
export function saveCfg() { try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch (e) {} }
