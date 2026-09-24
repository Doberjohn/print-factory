import { cfg, saveCfg, PREVIEW_DPI, PRICE_PER_PAGE } from "./config.js";
import { computeLayout, fmt } from "./geometry.js";
import { sources, slots, setSlots, nextUid } from "./state.js";
import { byName, addFiles } from "./images.js";
import { usesEnhanced, pageSlots, PAGES_PER_PRINT, pairCount, setPairCount, pageCount, renderPageCanvas } from "./render.js";
import { SR, imageDpi, queueEnhancements, updateExportButtons } from "./enhance.js";
import { batchName, setBatchName, scheduleSave, saveBatchFile, openBatchFile } from "./storage.js";
import { withBusy, exportPdf, exportPng, exportSpec } from "./exports.js";

// Other modules call back into this one (schedule, setStatus, $) only at run
// time, never while loading, so the import loop between them is safe.
export const $ = (s, r = document) => r.querySelector(s);
export function setStatus(t, err) { const s = $("#status"); s.textContent = t; s.classList.toggle("err", !!err); }

/* ---------- settings form ---------- */
export function applyCfgToInputs() {
  document.querySelectorAll("[data-k]").forEach(el => {
    const k = el.dataset.k;
    if (el.type === "checkbox") el.checked = !!cfg[k];
    else if (el.type === "radio") el.checked = String(cfg[k]) === el.value;
    else el.value = cfg[k];
  });
}
export function bindSettings() {
  applyCfgToInputs();
  document.querySelectorAll("[data-k]").forEach(el => {
    const k = el.dataset.k;
    el.addEventListener(el.type === "number" ? "input" : "change", () => {
      if (el.type === "checkbox") cfg[k] = el.checked;
      else if (el.type === "radio") { if (!el.checked) return; cfg[k] = k === "dpi" ? Number(el.value) : el.value; }
      else {
        const v = parseFloat(el.value);
        if (!isFinite(v)) return;
        cfg[k] = v;
      }
      saveCfg();
      if (k === "rotate" || k === "enhance") sources.forEach(s => s.rot = {});
      schedule();
    });
  });
}

/* ---------- preview ---------- */
let timer = 0;
export function schedule() { clearTimeout(timer); timer = setTimeout(renderAll, 60); scheduleSave(); }

const ICON_DUP = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M11 3.5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h.5"/></svg>';
const ICON_DEL = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';

let dragFrom = -1;
const euros = v => "€" + fmt(v);

export async function renderAll() {
  const L = computeLayout(cfg);
  const n = pageCount(L);
  const per = L.cols * L.rows;
  $("#customFields").style.display = cfg.sheet === "custom" ? "" : "none";
  $("#count").textContent = `${slots.length} of ${n * per} cards`;
  // Every page is printed, empty slots and all, so the price follows the page count.
  $("#price").style.display = slots.length ? "" : "none";
  $("#priceNote").textContent = `${n} pages to print at ${euros(PRICE_PER_PAGE)} each`;
  $("#priceAmount").textContent = euros(n * PRICE_PER_PAGE);
  queueEnhancements();
  updateExportButtons();
  renderSpec(L, n);

  const wrap = $("#sheets");
  wrap.textContent = "";
  const showCuts = $("#showCuts").checked;
  let rowEl = null;
  for (let p = 0; p < n; p++) {
    if (p % PAGES_PER_PRINT === 0) {
      const pair = document.createElement("div");
      pair.className = "pair";
      const head = document.createElement("div");
      head.className = "pairhead";
      const h = document.createElement("h3");
      const first = p + 1, last = p + PAGES_PER_PRINT;
      h.textContent = `Pages ${first} and ${last}`;
      head.appendChild(h);
      if (pairCount > 1) {
        const start = p * per, inRow = Math.max(0, Math.min(slots.length, start + per * PAGES_PER_PRINT) - start);
        const rm = document.createElement("button");
        rm.type = "button"; rm.className = "matbtn";
        rm.textContent = inRow ? `Remove these pages and their ${inRow} card${inRow === 1 ? "" : "s"}` : "Remove these pages";
        rm.addEventListener("click", () => {
          slots.splice(start, per * PAGES_PER_PRINT);
          setPairCount(Math.max(1, pairCount - 1));
          pruneSources();
          setStatus(`Removed pages ${first} and ${last}.`);
          schedule();
        });
        head.appendChild(rm);
      }
      rowEl = document.createElement("div");
      rowEl.className = "pairrow";
      pair.append(head, rowEl);
      wrap.appendChild(pair);
    }
    const fig = document.createElement("figure");
    const sheet = document.createElement("div");
    sheet.className = "sheet";
    sheet.style.aspectRatio = `${L.W} / ${L.H}`;
    const cv = await renderPageCanvas(L, p, n, PREVIEW_DPI, true);
    sheet.appendChild(cv);

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", `0 0 ${L.W} ${L.H}`);
    svg.setAttribute("preserveAspectRatio", "none");
    if (showCuts) {
      const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#B8005F";
      L.cutsX.forEach(x => svg.appendChild(line(svgNS, x, 0, x, L.H, accent)));
      L.cutsY.forEach(y => svg.appendChild(line(svgNS, 0, y, L.W, y, accent)));
    }
    sheet.appendChild(svg);

    const items = pageSlots(p, L);
    L.cards.forEach((k, i) => {
      const idx = p * per + i;
      const item = items[i];
      const pct = (v, t) => (v / t * 100) + "%";
      let el;
      if (item) {
        const src = sources.get(item.src);
        el = document.createElement("div");
        el.className = "slot filled";
        el.draggable = true;
        el.title = src.name;
        el.setAttribute("aria-label", `Card ${idx + 1}: ${src.name}`);
        const tools = document.createElement("div");
        tools.className = "tools";
        tools.appendChild(toolBtn(ICON_DUP, `Duplicate ${src.name}`, () => { slots.splice(idx + 1, 0, { uid: nextUid(), src: item.src }); schedule(); }));
        tools.appendChild(toolBtn(ICON_DEL, `Remove ${src.name}`, () => { slots.splice(idx, 1); pruneSources(); schedule(); }));
        el.appendChild(tools);
        const rotated = cfg.rotate && src.w > src.h;
        const enh = usesEnhanced(src);
        const srcDpi = enh ? imageDpi(src.enh.width, src.enh.height) : imageDpi(src.w, src.h);
        if (cfg.enhance && (src.enhState === "queued" || src.enhState === "working")) addTag(el, src.enhState === "working" ? "Enhancing" : "Waiting to enhance", false);
        else if (srcDpi < cfg.dpi * 0.75) addTag(el, enh ? `Enhanced, still ${Math.round(srcDpi)} DPI` : `Low res, ${Math.round(srcDpi)} DPI`, true);
        else if (enh) addTag(el, rotated ? "Enhanced, rotated" : "Enhanced", false);
        else if (rotated) addTag(el, "Rotated", false);
        el.addEventListener("dragstart", e => { dragFrom = idx; el.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(idx)); });
        el.addEventListener("dragend", () => { dragFrom = -1; el.classList.remove("dragging"); });
      } else {
        el = document.createElement("button");
        el.type = "button";
        el.className = "slot empty";
        el.textContent = "Add";
        el.setAttribute("aria-label", `Add card to position ${idx + 1}`);
        el.addEventListener("click", () => $("#file").click());
      }
      el.style.left = pct(k.x, L.W); el.style.top = pct(k.y, L.H);
      el.style.width = pct(k.w, L.W); el.style.height = pct(k.h, L.H);
      el.addEventListener("dragover", e => { if (dragFrom >= 0) { e.preventDefault(); el.classList.add("target"); } });
      el.addEventListener("dragleave", () => el.classList.remove("target"));
      el.addEventListener("drop", e => {
        el.classList.remove("target");
        if (dragFrom < 0) return;
        e.preventDefault(); e.stopPropagation();
        const from = dragFrom; dragFrom = -1;
        const [moved] = slots.splice(from, 1);
        slots.splice(Math.min(idx, slots.length), 0, moved);
        schedule();
      });
      sheet.appendChild(el);
    });

    fig.appendChild(sheet);
    const cap = document.createElement("figcaption");
    const a = document.createElement("span"); a.textContent = `Page ${p + 1}`;
    const b = document.createElement("span"); b.textContent = `${fmt(L.W)} × ${fmt(L.H)} mm`;
    cap.append(a, b);
    fig.appendChild(cap);
    rowEl.appendChild(fig);
  }
  const add = document.createElement("button");
  add.type = "button"; add.className = "addpair";
  add.innerHTML = `<span>Add two more pages</span><small>Pages ${n + 1} and ${n + 2}, another ${per * PAGES_PER_PRINT} cards · +${euros(PAGES_PER_PRINT * PRICE_PER_PAGE)}</small>`;
  add.addEventListener("click", () => { setPairCount(pairCount + 1); setStatus(`Added pages ${n + 1} and ${n + 2}.`); schedule(); });
  wrap.appendChild(add);
}
function line(ns, x1, y1, x2, y2, color) {
  const l = document.createElementNS(ns, "line");
  l.setAttribute("x1", x1); l.setAttribute("y1", y1); l.setAttribute("x2", x2); l.setAttribute("y2", y2);
  l.setAttribute("stroke", color); l.setAttribute("stroke-width", "1"); l.setAttribute("vector-effect", "non-scaling-stroke");
  l.setAttribute("stroke-dasharray", "4 3"); l.setAttribute("opacity", ".75");
  return l;
}
function toolBtn(icon, label, fn) {
  const b = document.createElement("button");
  b.type = "button"; b.className = "tool"; b.innerHTML = icon; b.setAttribute("aria-label", label); b.title = label;
  b.addEventListener("click", e => { e.stopPropagation(); fn(); });
  b.addEventListener("mousedown", e => e.stopPropagation());
  return b;
}
function addTag(el, text, warn) {
  const t = document.createElement("span");
  t.className = "tag" + (warn ? " w" : ""); t.textContent = text;
  el.appendChild(t);
}
function pruneSources() {
  const used = new Set(slots.map(s => s.src));
  for (const id of [...sources.keys()]) if (!used.has(id)) sources.delete(id);
}

/* ---------- spec ---------- */
export function specLines(L, n) {
  return [
    ["Sheet", `${fmt(L.W)} × ${fmt(L.H)} mm`],
    ["Pages", `${n}, all with the same positions`],
    ["Card size (trim)", `${fmt(L.w)} × ${fmt(L.h)} mm`],
    ["Cards per page", `${L.cols} × ${L.rows}`],
    ["Gap between cards", L.g > 0 ? `${fmt(L.g)} mm (cut on both sides)` : "None (shared cut lines)"],
    ["Bleed", L.b > 0 ? `${fmt(Math.max(L.bIn, L.bOx))} mm` : "None"],
    ["Grid starts at", `${fmt(L.x0)} mm from left, ${fmt(L.y0)} mm from top`],
    ["Crop marks", cfg.marks ? "Yes" : "No"],
  ];
}
function renderSpec(L, n) {
  const box = $("#spec");
  box.textContent = "";
  const dl = document.createElement("dl");
  for (const [k, v] of specLines(L, n)) {
    const dt = document.createElement("dt"); dt.textContent = k;
    const dd = document.createElement("dd"); dd.textContent = v;
    dl.append(dt, dd);
  }
  box.appendChild(dl);
  const cuts = document.createElement("div");
  cuts.className = "cuts";
  cuts.innerHTML = `<b>Vertical cuts, from the left edge (mm)</b><code></code><b style="margin-top:8px">Horizontal cuts, from the top edge (mm)</b><code></code>`;
  const codes = cuts.querySelectorAll("code");
  codes[0].textContent = L.cutsX.map(fmt).join(", ");
  codes[1].textContent = L.cutsY.map(fmt).join(", ");
  box.appendChild(cuts);

  const w = $("#warns");
  w.textContent = "";
  L.warnings.forEach(t => { const li = document.createElement("li"); li.textContent = t; w.appendChild(li); });
}

/* ---------- wiring ---------- */
export function setupDrops() {
  const drop = $("#drop"), mat = $("#mat");
  const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes("Files");
  [drop, mat].forEach(zone => {
    zone.addEventListener("dragover", e => { if (hasFiles(e)) { e.preventDefault(); zone.classList.add("over"); } });
    zone.addEventListener("dragleave", e => { if (!zone.contains(e.relatedTarget)) zone.classList.remove("over"); });
    zone.addEventListener("drop", e => {
      zone.classList.remove("over");
      if (!hasFiles(e)) return;
      e.preventDefault();
      addFiles(e.dataTransfer.files);
    });
  });
  $("#pick").addEventListener("click", () => $("#file").click());
  $("#file").addEventListener("change", e => { addFiles(e.target.files); e.target.value = ""; });
  $("#sort").addEventListener("click", () => {
    slots.sort((a, b) => byName(sources.get(a.src), sources.get(b.src)) || a.uid - b.uid);
    schedule();
  });
  $("#clear").addEventListener("click", () => { setSlots([]); sources.clear(); SR.queue = []; setPairCount(1); setStatus("Removed all cards."); schedule(); });
  $("#showCuts").addEventListener("change", schedule);
  $("#batchName").value = batchName;
  $("#batchName").addEventListener("input", e => { setBatchName(e.target.value.trim() || "Batch 1"); scheduleSave(); });
  $("#saveBatch").addEventListener("click", () => withBusy(saveBatchFile));
  $("#openBatch").addEventListener("click", () => $("#batchFile").click());
  $("#batchFile").addEventListener("change", e => { if (e.target.files[0]) openBatchFile(e.target.files[0]); e.target.value = ""; });
  let confirmNew = false, confirmTimer = 0;
  $("#newBatch").addEventListener("click", () => {
    const btn = $("#newBatch");
    if (slots.length && !confirmNew) {
      confirmNew = true;
      btn.textContent = "Click again to start fresh";
      setStatus("Starting a new batch clears the current one. Use Save batch first if you want to keep it.");
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => { confirmNew = false; btn.textContent = "New batch"; }, 5000);
      return;
    }
    confirmNew = false; btn.textContent = "New batch";
    setSlots([]); sources.clear(); SR.queue = []; setPairCount(1);
    setBatchName(`Batch ${new Date().toLocaleDateString()}`);
    $("#batchName").value = batchName;
    setStatus("Started a new batch.");
    schedule();
  });
  $("#pdfBtn").addEventListener("click", () => withBusy(exportPdf, true));
  $("#pngBtn").addEventListener("click", () => withBusy(exportPng, true));
  $("#specBtn").addEventListener("click", () => withBusy(exportSpec));
}
