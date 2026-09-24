// Test images, drawn in the browser on first run and cached in tests/.fixtures.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".fixtures");
// Bump when the drawings change, so cached files are regenerated.
const VERSION = "2";

export const FIX = {
  // One 600 DPI card scan (1500 x 2079 px) in three encodings with identical pixels.
  // It has a 2 px light scanner fringe on all four edges.
  scanPng: path.join(DIR, "scan-600dpi.png"),
  scanTif: path.join(DIR, "scan-600dpi.tif"),
  scanDeflateTif: path.join(DIR, "scan-600dpi-deflate.tif"),
  // A 600 DPI card with clean edges, like a digital card image.
  clean: path.join(DIR, "clean-600dpi.png"),
  // A 300 px wide database download, which needs AI enhancement.
  database: path.join(DIR, "database-300px.jpg"),
  // A sideways card with a blue band on its left edge and orange elsewhere.
  landscape: path.join(DIR, "landscape.png"),
};

export async function ensureFixtures() {
  const stamp = path.join(DIR, "version.txt");
  const fresh = fs.existsSync(stamp) && fs.readFileSync(stamp, "utf8") === VERSION &&
    Object.values(FIX).every(f => fs.existsSync(f));
  if (fresh) return;
  fs.mkdirSync(DIR, { recursive: true });
  const browser = await chromium.launch({ channel: "chromium" });
  try {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><title>fixtures</title>");
    const files = await page.evaluate(drawFixtures);
    for (const [name, b64] of Object.entries(files)) fs.writeFileSync(path.join(DIR, name), Buffer.from(b64, "base64"));
    fs.writeFileSync(stamp, VERSION);
  } finally {
    await browser.close();
  }
}

// Runs in the page. Returns { filename: base64 }.
async function drawFixtures() {
  const b64 = blob => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.readAsDataURL(blob); });
  const encode = (cv, type, q) => new Promise(res => cv.toBlob(res, type, q));

  function card(w, h, { frame, sky, ground, title, fringe }) {
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const x = cv.getContext("2d");
    const s = w / 1500, m = Math.round(70 * s), artH = Math.round(h * 0.55);
    x.fillStyle = frame; x.fillRect(0, 0, w, h);
    const g = x.createLinearGradient(0, m, 0, artH);
    g.addColorStop(0, sky); g.addColorStop(1, ground);
    x.fillStyle = g; x.fillRect(m, m, w - 2 * m, artH - m);
    x.fillStyle = "rgba(255,255,255,.55)";
    x.beginPath(); x.arc(w * 0.62, artH * 0.42, w * 0.18, 0, Math.PI * 2); x.fill();
    x.fillStyle = "#F2EDE0"; x.fillRect(m, artH + m / 2, w - 2 * m, h - artH - m * 1.5);
    x.fillStyle = "#1C1C1C";
    x.font = `700 ${Math.round(96 * s)}px Arial, sans-serif`;
    x.fillText(title, m * 1.6, artH + m / 2 + 130 * s);
    x.font = `400 ${Math.round(48 * s)}px Arial, sans-serif`;
    for (let i = 0; i < 6; i++) x.fillText("Deal 2 damage to an enemy. Then draw a card.", m * 1.6, artH + m / 2 + (230 + i * 72) * s);
    if (fringe) {
      // A flatbed scanner leaves a light line along the very edge.
      x.fillStyle = "#FBFBF8";
      x.fillRect(0, 0, w, fringe); x.fillRect(0, h - fringe, w, fringe);
      x.fillRect(0, 0, fringe, h); x.fillRect(w - fringe, 0, fringe, h);
    }
    return cv;
  }

  function landscape(w, h) {
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const x = cv.getContext("2d");
    x.fillStyle = "#E8731C"; x.fillRect(0, 0, w, h);
    x.fillStyle = "#1F4FD1"; x.fillRect(0, 0, Math.round(w / 4), h);
    x.fillStyle = "#1C1C1C"; x.font = "700 110px Arial, sans-serif";
    x.fillText("MAIN SCHEME", w * 0.33, h * 0.2);
    return cv;
  }

  async function deflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // Baseline RGB TIFF, 600 DPI, in strips of 64 rows; compression 1 (none) or 8 (Adobe Deflate).
  async function tiff(cv, compress) {
    const { width: w, height: h } = cv;
    const rgba = cv.getContext("2d").getImageData(0, 0, w, h).data;
    const rowsPerStrip = 64, strips = [];
    for (let y = 0; y < h; y += rowsPerStrip) {
      const raw = new Uint8Array(w * Math.min(rowsPerStrip, h - y) * 3);
      for (let i = 0, j = y * w * 4; i < raw.length; i += 3, j += 4) { raw[i] = rgba[j]; raw[i + 1] = rgba[j + 1]; raw[i + 2] = rgba[j + 2]; }
      strips.push(compress ? await deflate(raw) : raw);
    }
    const n = strips.length;
    // [tag, type, count, value]; type 3 = SHORT, 4 = LONG, 5 = RATIONAL. String values point at data below.
    const entries = [
      [256, 4, 1, w], [257, 4, 1, h], [258, 3, 3, "bps"], [259, 3, 1, compress ? 8 : 1], [262, 3, 1, 2],
      [273, 4, n, "offsets"], [277, 3, 1, 3], [278, 4, 1, rowsPerStrip], [279, 4, n, "counts"],
      [282, 5, 1, "res"], [283, 5, 1, "res"], [284, 3, 1, 1], [296, 3, 1, 2],
    ];
    const at = {};
    let off = 8 + 2 + entries.length * 12 + 4;
    at.bps = off; off += 6;
    at.res = off; off += 8;
    at.offsets = off; off += 4 * n;
    at.counts = off; off += 4 * n;
    const buf = new Uint8Array(off + strips.reduce((a, s) => a + s.length, 0));
    const dv = new DataView(buf.buffer);
    buf.set([0x49, 0x49, 42, 0]); dv.setUint32(4, 8, true);
    dv.setUint16(8, entries.length, true);
    entries.forEach(([tag, type, count, value], i) => {
      const p = 10 + i * 12;
      dv.setUint16(p, tag, true); dv.setUint16(p + 2, type, true); dv.setUint32(p + 4, count, true);
      if (typeof value === "string") dv.setUint32(p + 8, at[value], true);
      else if (type === 3) dv.setUint16(p + 8, value, true);
      else dv.setUint32(p + 8, value, true);
    });
    [8, 8, 8].forEach((v, i) => dv.setUint16(at.bps + 2 * i, v, true));
    dv.setUint32(at.res, 600, true); dv.setUint32(at.res + 4, 1, true);
    strips.forEach((s, i) => {
      dv.setUint32(at.offsets + 4 * i, off, true); dv.setUint32(at.counts + 4 * i, s.length, true);
      buf.set(s, off); off += s.length;
    });
    return new Blob([buf], { type: "image/tiff" });
  }

  const scan = card(1500, 2079, { frame: "#7A1020", sky: "#F6B24A", ground: "#B8322A", title: "SCAN 600 DPI", fringe: 2 });
  const clean = card(1500, 2079, { frame: "#0F5132", sky: "#9BE3B5", ground: "#2F8F5B", title: "CLEAN 600 DPI" });
  const db = card(300, 419, { frame: "#123A6B", sky: "#8FD3F4", ground: "#2D6BB5", title: "DATABASE" });
  return {
    "scan-600dpi.png": await b64(await encode(scan, "image/png")),
    "clean-600dpi.png": await b64(await encode(clean, "image/png")),
    "scan-600dpi.tif": await b64(await tiff(scan, false)),
    "scan-600dpi-deflate.tif": await b64(await tiff(scan, true)),
    "database-300px.jpg": await b64(await encode(db, "image/jpeg", 0.9)),
    "landscape.png": await b64(await encode(landscape(2079, 1500), "image/png")),
  };
}
