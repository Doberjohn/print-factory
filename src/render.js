import { cfg, MARK_WIDTH } from "./config.js";
import { fmt } from "./geometry.js";
import { sources, slots } from "./state.js";

/* ---------- rendering ---------- */
export function usesEnhanced(src) { return !!(cfg.enhance && src.enh); }
export function oriented(src, useThumb) {
  const enh = usesEnhanced(src);
  const base = enh ? (useThumb ? src.enhThumb : src.enh) : (useThumb ? src.thumb : src.img);
  if (!(cfg.rotate && src.w > src.h)) return base;
  const key = (useThumb ? "t" : "f") + (enh ? "e" : "o");
  if (!src.rot[key]) {
    const cv = document.createElement("canvas");
    cv.width = base.height; cv.height = base.width;
    const x = cv.getContext("2d");
    x.translate(cv.width, 0); x.rotate(Math.PI / 2);
    x.drawImage(base, 0, 0);
    src.rot[key] = cv;
  }
  return src.rot[key];
}

// Renders one card with bleed. Sizes in whole pixels.
export function renderCard(img, trimW, trimH, pl, pr, pt, pb, fit) {
  const t = document.createElement("canvas");
  t.width = trimW; t.height = trimH;
  const tx = t.getContext("2d");
  tx.imageSmoothingEnabled = true; tx.imageSmoothingQuality = "high";
  tx.fillStyle = "#fff"; tx.fillRect(0, 0, trimW, trimH);
  const sw = img.width, sh = img.height;
  if (fit === "cover") {
    const s = Math.max(trimW / sw, trimH / sh);
    const cw = trimW / s, ch = trimH / s;
    tx.drawImage(img, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, trimW, trimH);
  } else {
    tx.drawImage(img, 0, 0, sw, sh, 0, 0, trimW, trimH);
  }
  if (!pl && !pr && !pt && !pb) return t;
  const out = document.createElement("canvas");
  out.width = trimW + pl + pr; out.height = trimH + pt + pb;
  const o = out.getContext("2d");
  o.imageSmoothingEnabled = false;
  // Sample a pixel line slightly inside the edge, away from scanner fringe.
  const kx = Math.min(Math.max(1, Math.round(trimW * 0.004)), trimW - 1);
  const ky = Math.min(Math.max(1, Math.round(trimH * 0.004)), trimH - 1);
  if (pl) o.drawImage(t, kx, 0, 1, trimH, 0, pt, pl, trimH);
  if (pr) o.drawImage(t, trimW - 1 - kx, 0, 1, trimH, pl + trimW, pt, pr, trimH);
  if (pt) o.drawImage(t, 0, ky, trimW, 1, pl, 0, trimW, pt);
  if (pb) o.drawImage(t, 0, trimH - 1 - ky, trimW, 1, pl, pt + trimH, trimW, pb);
  if (pl && pt) o.drawImage(t, kx, ky, 1, 1, 0, 0, pl, pt);
  if (pr && pt) o.drawImage(t, trimW - 1 - kx, ky, 1, 1, pl + trimW, 0, pr, pt);
  if (pl && pb) o.drawImage(t, kx, trimH - 1 - ky, 1, 1, 0, pt + trimH, pl, pb);
  if (pr && pb) o.drawImage(t, trimW - 1 - kx, trimH - 1 - ky, 1, 1, pl + trimW, pt + trimH, pr, pb);
  o.drawImage(t, pl, pt);
  return out;
}

function cardPixels(k, dpi) {
  const P = mm => Math.round(mm / 25.4 * dpi);
  const L = P(k.x), R = P(k.x + k.w), T = P(k.y), B = P(k.y + k.h);
  const BL = P(k.x - k.bl), BR = P(k.x + k.w + k.br), BT = P(k.y - k.bt), BB = P(k.y + k.h + k.bb);
  return { L, R, T, B, BL, BR, BT, BB, trimW: R - L, trimH: B - T, pl: L - BL, pr: BR - R, pt: T - BT, pb: BB - B };
}

export function pageSlots(p, L) { const n = L.cols * L.rows; return slots.slice(p * n, p * n + n); }
export const PAGES_PER_PRINT = 2;
export let pairCount = 1;
export function setPairCount(n) { pairCount = n; }
function cardsPerPrint() { return cfg.cols * cfg.rows * PAGES_PER_PRINT; }
function syncPairs() { pairCount = Math.max(1, pairCount, Math.ceil(slots.length / cardsPerPrint())); }
export function pageCount() { syncPairs(); return pairCount * PAGES_PER_PRINT; }
function capacity() { return pageCount() * cfg.cols * cfg.rows; }
export function cardsMissing() { return Math.max(0, capacity() - slots.length); }
export function labelText(L, p, n) {
  return `Page ${p + 1} of ${n}. Cards ${fmt(L.w)} x ${fmt(L.h)} mm, gap ${fmt(L.g)} mm, bleed ${fmt(L.b)} mm.`;
}

export async function renderPageCanvas(L, p, n, dpi, useThumb, onCard) {
  const P = mm => Math.round(mm / 25.4 * dpi);
  const cv = document.createElement("canvas");
  cv.width = P(L.W); cv.height = P(L.H);
  const ctx = cv.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
  const items = pageSlots(p, L);
  for (let i = 0; i < items.length; i++) {
    const src = sources.get(items[i].src);
    if (!src) continue;
    const k = L.cards[i], px = cardPixels(k, dpi);
    const card = renderCard(oriented(src, useThumb), px.trimW, px.trimH, px.pl, px.pr, px.pt, px.pb, cfg.fit);
    ctx.drawImage(card, px.BL, px.BT);
    if (onCard) await onCard(i, items.length);
  }
  if (L.marks.length) {
    ctx.strokeStyle = "#000"; ctx.lineWidth = Math.max(1, MARK_WIDTH / 25.4 * dpi);
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of L.marks) {
      const off = ctx.lineWidth % 2 === 1 ? 0.5 : 0;
      ctx.moveTo(P(x1) + off, P(y1) + off); ctx.lineTo(P(x2) + off, P(y2) + off);
    }
    ctx.stroke();
  }
  if (L.labelFits) {
    ctx.fillStyle = "#555";
    ctx.font = `${Math.max(6, Math.round(6 / 72 * dpi))}px Helvetica, Arial, sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    ctx.fillText(labelText(L, p, n), P(L.W / 2), P(L.labelY));
  }
  return cv;
}
