import { jsPDF } from "jspdf";
import JSZip from "jszip";
import { cfg, MARK_WIDTH } from "./config.js";
import { computeLayout, fmt } from "./geometry.js";
import { sources, busy, setBusy } from "./state.js";
import { usesEnhanced, oriented, renderCard, pageSlots, pageCount, cardsMissing, labelText, renderPageCanvas } from "./render.js";
import { enhancing, updateExportButtons } from "./enhance.js";
import { $, setStatus, specLines } from "./ui.js";

/* ---------- saving files ---------- */
export async function saveFile(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return true;
}
const tick = () => new Promise(r => setTimeout(r, 0));
export const toBlob = (cv, type, q) => new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error("encode")), type, q));
export function stamp() { const d = new Date(); const p = v => String(v).padStart(2, "0"); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; }

export async function withBusy(fn, needsFull) {
  if (busy || enhancing() || (needsFull && cardsMissing())) return;
  setBusy(true);
  document.querySelectorAll(".exports .btn").forEach(b => b.disabled = true);
  try { await fn(); }
  catch (e) { console.error(e); setStatus("Something went wrong while building the file. Try 300 DPI if the pages are very large.", true); }
  finally {
    setBusy(false);
    $("#specBtn").disabled = false;
    updateExportButtons();
  }
}

export async function exportPdf() {
  const L = computeLayout(cfg), n = pageCount(L), dpi = cfg.dpi;
  const doc = new jsPDF({ unit: "mm", format: [L.W, L.H], orientation: L.W > L.H ? "landscape" : "portrait", compress: true });
  doc.setProperties({ title: "Card sheets", creator: "Card sheet builder" });
  const cache = new Map();
  for (let p = 0; p < n; p++) {
    if (p > 0) doc.addPage([L.W, L.H], L.W > L.H ? "landscape" : "portrait");
    const items = pageSlots(p, L);
    for (let i = 0; i < items.length; i++) {
      setStatus(`Building PDF: page ${p + 1} of ${n}, card ${i + 1} of ${items.length}`);
      await tick();
      const src = sources.get(items[i].src);
      if (!src) continue;
      const k = L.cards[i];
      const pw = Math.round((k.w + k.bl + k.br) / 25.4 * dpi);
      const ph = Math.round((k.h + k.bt + k.bb) / 25.4 * dpi);
      const pl = Math.round(k.bl / 25.4 * dpi), pt = Math.round(k.bt / 25.4 * dpi);
      const pr = Math.round(k.br / 25.4 * dpi), pb = Math.round(k.bb / 25.4 * dpi);
      const tw = pw - pl - pr, th = ph - pt - pb;
      const key = [src.id, usesEnhanced(src) ? "e" : "o", cfg.rotate && src.w > src.h, cfg.fit, tw, th, pl, pr, pt, pb].join("|");
      let data = cache.get(key);
      if (!data) {
        const card = renderCard(oriented(src, false), tw, th, pl, pr, pt, pb, cfg.fit);
        const blob = await toBlob(card, "image/jpeg", 0.95);
        data = new Uint8Array(await blob.arrayBuffer());
        cache.set(key, data);
      }
      doc.addImage(data, "JPEG", k.x - k.bl, k.y - k.bt, k.w + k.bl + k.br, k.h + k.bt + k.bb, key, "NONE");
    }
    if (L.marks.length) {
      doc.setDrawColor(0); doc.setLineWidth(MARK_WIDTH);
      for (const [x1, y1, x2, y2] of L.marks) doc.line(x1, y1, x2, y2);
    }
    if (L.labelFits) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(6); doc.setTextColor(85);
      doc.text(labelText(L, p, n), L.W / 2, L.labelY, { align: "center" });
    }
  }
  setStatus("Saving PDF");
  const ok = await saveFile(`card-sheets-${stamp()}.pdf`, doc.output("blob"));
  if (ok) setStatus(`PDF ready: ${n} page${n === 1 ? "" : "s"} at ${dpi} DPI.`);
}

// PNG with physical size (pHYs chunk) so other apps print it at the right size.
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
async function withDpi(blob, dpi) {
  const src = new Uint8Array(await blob.arrayBuffer());
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21), dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9); chunk.set([0x70, 0x48, 0x59, 0x73], 4);
  dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1;
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));
  const out = new Uint8Array(src.length + 21);
  out.set(src.subarray(0, 33), 0); out.set(chunk, 33); out.set(src.subarray(33), 54);
  return new Blob([out], { type: "image/png" });
}
export async function exportPng() {
  const L = computeLayout(cfg), n = pageCount(L), dpi = cfg.dpi;
  const files = [];
  for (let p = 0; p < n; p++) {
    let cv;
    try {
      cv = await renderPageCanvas(L, p, n, dpi, false, async (i, total) => { setStatus(`Building PNG: page ${p + 1} of ${n}, card ${i + 1} of ${total}`); await tick(); });
    } catch (e) { setStatus("This browser can't make a page that large. Switch to 300 DPI.", true); return; }
    setStatus(`Encoding page ${p + 1} of ${n}`); await tick();
    files.push({ name: `page-${p + 1}.png`, blob: await withDpi(await toBlob(cv, "image/png"), dpi) });
    cv.width = cv.height = 1;
  }
  let ok;
  if (files.length === 1) ok = await saveFile(`card-sheet-${stamp()}.png`, files[0].blob);
  else {
    setStatus("Packing pages into a zip");
    const zip = new JSZip();
    files.forEach(f => zip.file(f.name, f.blob));
    ok = await saveFile(`card-sheets-${stamp()}.zip`, await zip.generateAsync({ type: "blob", compression: "STORE" }));
  }
  if (ok) setStatus(`PNG ready: ${n} page${n === 1 ? "" : "s"} at ${dpi} DPI.`);
}

export async function exportSpec() {
  const L = computeLayout(cfg), n = pageCount(L);
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const M = 18;
  doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.setTextColor(20);
  doc.text("Cut specification", M, 24);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(90);
  doc.text("All measurements in millimeters, from the top-left corner of the printed sheet.", M, 31);

  let y = 42;
  doc.setFontSize(10.5);
  for (const [k, v] of specLines(L, n)) {
    doc.setTextColor(90); doc.text(k, M, y);
    doc.setTextColor(20); doc.text(v, M + 45, y);
    y += 6.2;
  }
  y += 4;
  doc.setFont("helvetica", "bold"); doc.setTextColor(20); doc.text("Vertical cuts, from the left edge", M, y); y += 5.5;
  doc.setFont("helvetica", "normal");
  doc.text(doc.splitTextToSize(L.cutsX.map((v, i) => `V${i + 1}: ${fmt(v)}`).join("     "), 174), M, y); y += 11;
  doc.setFont("helvetica", "bold"); doc.text("Horizontal cuts, from the top edge", M, y); y += 5.5;
  doc.setFont("helvetica", "normal");
  doc.text(doc.splitTextToSize(L.cutsY.map((v, i) => `H${i + 1}: ${fmt(v)}`).join("     "), 174), M, y); y += 12;

  // Diagram
  const maxW = 110, maxH = 297 - y - 22;
  const s = Math.min(maxW / L.W, maxH / L.H);
  const ox = (210 - L.W * s) / 2, oy = y + 6;
  doc.setDrawColor(60); doc.setLineWidth(0.3);
  doc.rect(ox, oy, L.W * s, L.H * s);
  doc.setFillColor(225, 229, 226);
  L.cards.forEach(k => doc.rect(ox + k.x * s, oy + k.y * s, k.w * s, k.h * s, "F"));
  doc.setDrawColor(184, 0, 95); doc.setLineWidth(0.2);
  doc.setFontSize(6.5); doc.setTextColor(184, 0, 95);
  const near = (arr, i, d) => i + d >= 0 && i + d < arr.length && Math.abs(arr[i + d] - arr[i]) * s < 5;
  L.cutsX.forEach((x, i, a) => {
    const X = ox + x * s;
    doc.line(X, oy - 2, X, oy + L.H * s + 2);
    if (near(a, i, 1)) doc.text(`V${i + 1}`, X - 0.7, oy - 3, { align: "right" });
    else if (near(a, i, -1)) doc.text(`V${i + 1}`, X + 0.7, oy - 3, { align: "left" });
    else doc.text(`V${i + 1}`, X, oy - 3, { align: "center" });
  });
  L.cutsY.forEach((yy, i, a) => {
    const Y = oy + yy * s;
    doc.line(ox - 2, Y, ox + L.W * s + 2, Y);
    const dy = near(a, i, 1) ? -0.8 : near(a, i, -1) ? 3 : 1;
    doc.text(`H${i + 1}`, ox - 3, Y + dy, { align: "right" });
  });
  doc.setFontSize(8.5); doc.setTextColor(90);
  doc.text(L.g > 0 ? "Each card is cut on all four sides. The strips between cards are waste." : "Cards touch, so neighboring cards share one cut line.", 105, oy + L.H * s + 9, { align: "center" });
  const ok = await saveFile(`cut-spec-${stamp()}.pdf`, doc.output("blob"));
  if (ok) setStatus("Cut spec ready.");
}
