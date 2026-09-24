import fs from "node:fs";
import { test, expect } from "@playwright/test";
import JSZip from "jszip";
import { FIX } from "./support/fixtures.js";
import { openApp, addCards, openBatch, download, buildBatch, appState, autosaved, previewPixel } from "./support/app.js";
import { pngChunks, jpegSize, sha256 } from "./support/formats.js";
import { readPdf } from "./support/pdf.js";

const EIGHTEEN = Array(18).fill(FIX.scanPng);

test("TIFFs decode exactly, uncompressed and Deflate-compressed", async ({ page }) => {
  await openApp(page);
  // The three files hold the same 600 DPI scan, six cards of each.
  await addCards(page, [...Array(6).fill(FIX.scanPng), ...Array(6).fill(FIX.scanTif), ...Array(6).fill(FIX.scanDeflateTif)]);
  await expect(page.locator("#status")).not.toContainText("Couldn't read");

  // Every card previews as the scan: dark red frame, orange art.
  for (const col of [0, 1, 2]) {
    const x = 6.75 + col * 66.5;
    const frame = await previewPixel(page, 0, x + 1.2, 13.5 + 44);
    const art = await previewPixel(page, 0, x + 10, 13.5 + 10);
    expect(frame[0]).toBeGreaterThan(90);
    expect(frame[1]).toBeLessThan(50);
    expect(art[0]).toBeGreaterThan(200);
    expect(art[1]).toBeGreaterThan(120);
  }

  // At 600 DPI the print path draws each scan 1:1, so identical decoded pixels give
  // identical JPEG image objects: one per source file, byte for byte the same.
  const pdf = readPdf((await download(page, "#pdfBtn")).bytes);
  expect(pdf.images).toHaveLength(3);
  expect(pdf.images[1].raw.equals(pdf.images[0].raw)).toBe(true);
  expect(pdf.images[2].raw.equals(pdf.images[0].raw)).toBe(true);
});

test("a landscape image is rotated automatically, clockwise", async ({ page }) => {
  await openApp(page);
  await addCards(page, [FIX.landscape]);
  await expect(page.locator(".slot.filled .tag")).toHaveText("Rotated");
  // The blue band on the image's left edge ends up along the top of the card.
  const top = await previewPixel(page, 0, 6.75 + 31.75, 13.5 + 5);
  const bottom = await previewPixel(page, 0, 6.75 + 31.75, 13.5 + 80);
  expect(top[2]).toBeGreaterThan(top[0] + 100);
  expect(bottom[0]).toBeGreaterThan(bottom[2] + 100);
});

test("a 300 px image is enhanced to about 480 DPI, and downloads wait for it", async ({ page }) => {
  test.setTimeout(300_000);
  const served = {};
  page.on("response", async res => {
    const path = new URL(res.url()).pathname;
    if (path.startsWith("/models/") || /\/assets\/tfjs-.*\.js$/.test(path)) served[path] = res.status();
    if (path.endsWith(".bin")) served.binSha = sha256(await res.body());
  });
  await openApp(page);
  await addCards(page, Array(17).fill(FIX.scanPng));
  await addCards(page, [FIX.database]);

  const card = page.locator('.slot.filled[aria-label="Card 18: database-300px.jpg"]');
  await expect(card.locator(".tag")).toHaveText("Enhancing");
  // Both pages are full, so only the running enhancement holds the downloads back.
  await expect(page.locator("#fillNote")).toHaveText("");
  await expect(page.locator("#pdfBtn")).toBeDisabled();
  await expect(page.locator("#pngBtn")).toBeDisabled();

  await expect(page.locator("#status")).toHaveText("Enhanced 1 image.", { timeout: 240_000 });
  await expect(card.locator(".tag")).toHaveText("Enhanced");
  await expect(page.locator("#pdfBtn")).toBeEnabled();
  await expect(page.locator("#pngBtn")).toBeEnabled();

  // TensorFlow.js and the model came from this site, and the weights arrived intact.
  expect(Object.entries(served).filter(([k]) => k.startsWith("/")).every(([, status]) => status === 200)).toBe(true);
  expect(Object.keys(served).some(k => /\/assets\/tfjs-/.test(k))).toBe(true);
  expect(served["/models/esrgan-medium/x4/model.json"]).toBe(200);
  expect(served.binSha).toBe(sha256(fs.readFileSync("public/models/esrgan-medium/x4/group1-shard1of1.bin")));

  // The enhanced image is 4x: 1200 px across a 63.5 mm card is 480 DPI.
  const batch = await download(page, "#saveBatch");
  const zip = await JSZip.loadAsync(batch.bytes);
  const manifest = JSON.parse(await zip.file("batch.json").async("string"));
  const source = manifest.sources.find(s => s.name === "database-300px.jpg");
  const size = jpegSize(await zip.file(source.enhFile).async("nodebuffer"));
  expect(size).toEqual({ width: 1200, height: 1676 });
  expect(size.width / (63.5 / 25.4)).toBeCloseTo(480, 6);

  // Reopened elsewhere, the batch brings its enhanced image along: nothing to redo or download.
  const fresh = await page.context().browser().newContext();
  try {
    const other = await fresh.newPage();
    const requested = [];
    other.on("request", req => requested.push(new URL(req.url()).pathname));
    await openApp(other);
    await openBatch(other, batch.bytes, batch.name);
    await expect(other.locator("#status")).toHaveText(/^Opened .*: 18 cards\.$/);
    await expect(other.locator('.slot.filled[aria-label="Card 18: database-300px.jpg"] .tag')).toHaveText("Enhanced");
    await expect(other.locator("#pdfBtn")).toBeEnabled();
    expect(requested.filter(p => /tfjs|\/models\//.test(p))).toEqual([]);
  } finally {
    await fresh.close();
  }
});

test("reload restores cards, order, batch name, page count and settings", async ({ page }) => {
  await openApp(page);
  const before = await buildBatch(page, FIX);
  await expect.poll(() => autosaved(page)).toMatchObject({
    v: 1, name: "Rhino and friends", pairCount: 2, slots: 3, cfg: { gap: 4, fit: "cover", labels: false, dpi: 300 },
  });

  await page.reload();
  await expect(page.locator("#status")).toContainText("Restored 3 cards saved on");
  expect(await appState(page)).toEqual(before);
});

test("a saved batch opens in a fresh browser profile with the same state", async ({ page, browser }) => {
  await openApp(page);
  const before = await buildBatch(page, FIX);
  const file = await download(page, "#saveBatch");
  expect(file.name).toMatch(/^Rhino-and-friends-\d{8}-\d{4}\.zip$/);

  const zip = await JSZip.loadAsync(file.bytes);
  const manifest = JSON.parse(await zip.file("batch.json").async("string"));
  expect(manifest).toMatchObject({ v: 1, name: "Rhino and friends", pairCount: 2, cfg: { gap: 4, fit: "cover" } });
  expect(manifest.sources.map(s => s.file)).toEqual(["cards/01_scan-600dpi.jpg", "cards/02_landscape.jpg", "cards/03_scan-600dpi.jpg"]);

  const fresh = await browser.newContext();
  try {
    const other = await fresh.newPage();
    await openApp(other);
    await openBatch(other, file.bytes, file.name);
    await expect(other.locator("#status")).toHaveText("Opened Rhino and friends: 3 cards.");
    expect(await appState(other)).toEqual(before);
  } finally {
    await fresh.close();
  }
});

for (const [dpi, width, height, ppm] of [[600, 4961, 7016, 23622], [300, 2480, 3508, 11811]]) {
  test(`PNG export at ${dpi} DPI: ${width} x ${height} px with a pHYs chunk after IHDR`, async ({ page }) => {
    await openApp(page);
    await addCards(page, EIGHTEEN);
    await page.check(`input[name="dpi"][value="${dpi}"]`);
    const file = await download(page, "#pngBtn");
    expect(file.name).toMatch(/^card-sheets-\d{8}-\d{4}\.zip$/);

    const zip = await JSZip.loadAsync(file.bytes);
    expect(Object.keys(zip.files).sort()).toEqual(["page-1.png", "page-2.png"]);
    for (const name of ["page-1.png", "page-2.png"]) {
      const chunks = pngChunks(await zip.file(name).async("nodebuffer"));
      expect(chunks.slice(0, 2).map(c => c.type)).toEqual(["IHDR", "pHYs"]);
      expect(chunks.filter(c => !c.crcOk).map(c => c.type)).toEqual([]);
      const [ihdr, phys] = chunks;
      expect([ihdr.data.readUInt32BE(0), ihdr.data.readUInt32BE(4)]).toEqual([width, height]);
      // Pixels per meter on both axes, unit 1 = meter.
      expect([phys.data.readUInt32BE(0), phys.data.readUInt32BE(4), phys.data[8]]).toEqual([ppm, ppm, 1]);
      expect(ppm * 0.0254).toBeCloseTo(dpi, 1);
    }
  });
}
