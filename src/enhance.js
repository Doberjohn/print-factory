import { cfg } from "./config.js";
import { sources, slots, busy } from "./state.js";
import { makeThumb } from "./images.js";
import { cardsMissing, pageCount } from "./render.js";
import { $, setStatus, schedule } from "./ui.js";

/* ---------- AI enhancement for low-res images ---------- */
const SR_SCALE = 4, SR_TILE = 96, SR_PAD = 12;
export const SR = { model: null, loading: null, queue: [], running: false, failed: false, done: 0 };

// Resolution of an image when stretched across the card (short side vs card width).
export function imageDpi(w, h) { return Math.min(w, h) / (Math.max(10, cfg.cardW) / 25.4); }
function needsEnhance(src) { return imageDpi(src.w, src.h) < cfg.dpi * 0.75; }
export function enhancing() { return SR.running || SR.queue.length > 0; }

async function srModel() {
  if (SR.model) return SR.model;
  if (!SR.loading) SR.loading = (async () => {
    // Loaded on first use, so sessions with only full-resolution scans never download it.
    const tf = await import("@tensorflow/tfjs");
    await tf.ready();
    const model = await tf.loadLayersModel("/models/esrgan-medium/x4/model.json");
    SR.model = model;
    return model;
  })();
  try { return await SR.loading; } catch (e) { SR.loading = null; throw e; }
}

async function upscaleImage(model, img, onProgress) {
  const tf = await import("@tensorflow/tfjs");
  const W = img.width, H = img.height;
  // Flatten onto white so transparent corners don't turn black.
  const flat = document.createElement("canvas");
  flat.width = W; flat.height = H;
  const fx = flat.getContext("2d");
  fx.fillStyle = "#fff"; fx.fillRect(0, 0, W, H); fx.drawImage(img, 0, 0);
  const out = document.createElement("canvas");
  out.width = W * SR_SCALE; out.height = H * SR_SCALE;
  const octx = out.getContext("2d");
  const tile = document.createElement("canvas");
  const src = tf.tidy(() => tf.browser.fromPixels(flat, 3).toFloat());
  const total = Math.ceil(W / SR_TILE) * Math.ceil(H / SR_TILE);
  let n = 0;
  try {
    for (let y = 0; y < H; y += SR_TILE) {
      for (let x = 0; x < W; x += SR_TILE) {
        const x0 = Math.max(0, x - SR_PAD), y0 = Math.max(0, y - SR_PAD);
        const x1 = Math.min(W, x + SR_TILE + SR_PAD), y1 = Math.min(H, y + SR_TILE + SR_PAD);
        const res = tf.tidy(() => model.predict(src.slice([y0, x0, 0], [y1 - y0, x1 - x0, 3]).expandDims(0)).squeeze().clipByValue(0, 255).round().toInt());
        await tf.browser.toPixels(res, tile);
        res.dispose();
        const cw = Math.min(SR_TILE, W - x), ch = Math.min(SR_TILE, H - y);
        octx.drawImage(tile, (x - x0) * SR_SCALE, (y - y0) * SR_SCALE, cw * SR_SCALE, ch * SR_SCALE, x * SR_SCALE, y * SR_SCALE, cw * SR_SCALE, ch * SR_SCALE);
        n++;
        if (onProgress) onProgress(n / total);
        await tf.nextFrame();
      }
    }
  } finally {
    src.dispose();
  }
  return out;
}

export function queueEnhancements() {
  if (!cfg.enhance || SR.failed) return;
  const used = new Set(slots.map(s => s.src));
  let added = false;
  for (const s of sources.values()) {
    if (!used.has(s.id) || s.enh || s.enhState || !needsEnhance(s)) continue;
    s.enhState = "queued"; SR.queue.push(s.id); added = true;
  }
  if (added) runQueue();
}

async function runQueue() {
  if (SR.running) return;
  SR.running = true;
  updateExportButtons();
  let count = 0;
  try {
    while (SR.queue.length) {
      const id = SR.queue.shift();
      const s = sources.get(id);
      if (!s) continue;
      if (!cfg.enhance) { s.enhState = null; continue; }
      s.enhState = "working";
      schedule();
      try {
        setStatus(`Loading the enhancer`);
        const model = await srModel();
        const left = SR.queue.length;
        s.enh = await upscaleImage(model, s.img, f => setStatus(`Enhancing ${s.name}: ${Math.round(f * 100)}%${left ? `, ${left} more after this` : ""}`));
        s.enhThumb = makeThumb(s.enh);
        s.rot = {};
        s.enhState = "done";
        count++;
      } catch (e) {
        console.error(e);
        SR.failed = true;
        s.enhState = null;
        SR.queue.forEach(q => { const o = sources.get(q); if (o) o.enhState = null; });
        SR.queue = [];
        setStatus("AI enhancement isn't available in this browser, so small images are scaled up normally.", true);
      }
      schedule();
    }
  } finally {
    SR.running = false;
    updateExportButtons();
    if (count && !SR.failed) setStatus(`Enhanced ${count} image${count === 1 ? "" : "s"}.`);
    schedule();
  }
}

export function updateExportButtons() {
  const missing = cardsMissing();
  const note = $("#fillNote");
  if (missing) {
    const n = pageCount();
    note.textContent = `Add ${missing} more card${missing === 1 ? "" : "s"} to fill ${n === 2 ? "both pages" : `all ${n} pages`}. Downloads unlock when every page is full.`;
  } else note.textContent = "";
  const off = !slots.length || missing > 0 || busy || enhancing();
  $("#pdfBtn").disabled = $("#pngBtn").disabled = off;
}
