// Helpers that drive the app the way a user does.
import fs from "node:fs/promises";
import { expect } from "@playwright/test";

export async function openApp(page, url = "/") {
  await page.goto(url);
  await expect(page.locator("#count")).toHaveText("0 of 18 cards");
}

export async function addCards(page, files) {
  const before = await page.locator(".slot.filled").count();
  await page.locator("#file").setInputFiles(files);
  const n = files.length;
  await expect(page.locator("#status")).toHaveText(`Added ${n} card${n === 1 ? "" : "s"}.`);
  await expect(page.locator(".slot.filled")).toHaveCount(before + n);
}

export async function openBatch(page, bytes, name = "batch.zip") {
  await page.locator("#batchFile").setInputFiles({ name, mimeType: "application/zip", buffer: bytes });
}

// Clicks a download button and returns the file it saves.
export async function download(page, button) {
  await expect(page.locator(button)).toBeEnabled();
  const [file] = await Promise.all([page.waitForEvent("download", { timeout: 150_000 }), page.click(button)]);
  return { name: file.suggestedFilename(), bytes: await fs.readFile(await file.path()) };
}

// A batch with three cards added one at a time (so the order is not alphabetical),
// a name, a second pair of pages and several non-default settings.
export async function buildBatch(page, fix) {
  await addCards(page, [fix.scanTif]);
  await addCards(page, [fix.landscape]);
  await addCards(page, [fix.scanPng]);
  await page.fill("#batchName", "Rhino and friends");
  await page.getByRole("button", { name: /Add two more pages/ }).click();
  await page.fill("#gap", "4");
  await page.check('input[name="fit"][value="cover"]');
  await page.uncheck("#labels");
  await page.check('input[name="dpi"][value="300"]');
  const state = await appState(page);
  expect(state.cards).toEqual(["Card 1: scan-600dpi.tif", "Card 2: landscape.png", "Card 3: scan-600dpi.png"]);
  expect(state.pages).toEqual(["Pages 1 and 2", "Pages 3 and 4"]);
  expect(state.settings).toMatchObject({ gap: "4", fit: "cover", labels: false, dpi: "300" });
  return state;
}

// Resolves once the preview has been fully rebuilt and nothing has touched it for a
// while. Renders are debounced by 60 ms and fill the sheets progressively, so a
// snapshot taken mid-render would miss pages.
export function previewSettled(page) {
  return page.evaluate(() => new Promise(resolve => {
    const sheets = document.querySelector("#sheets");
    let timer = 0;
    const observer = new MutationObserver(() => arm());
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!sheets.querySelector(".addpair")) return arm();
        observer.disconnect();
        resolve();
      }, 250);
    };
    observer.observe(sheets, { childList: true, subtree: true, attributes: true });
    arm();
  }));
}

// Everything a user can see about the batch: cards in order, name, pages and settings.
export async function appState(page) {
  await previewSettled(page);
  return page.evaluate(() => ({
    count: document.querySelector("#count").textContent,
    cards: [...document.querySelectorAll(".slot.filled")].map(el => el.getAttribute("aria-label")),
    batchName: document.querySelector("#batchName").value,
    pages: [...document.querySelectorAll(".pairhead h3")].map(h => h.textContent),
    settings: Object.fromEntries([...document.querySelectorAll("[data-k]")]
      .filter(el => el.type !== "radio" || el.checked)
      .map(el => [el.dataset.k, el.type === "checkbox" ? el.checked : el.value])),
  }));
}

// A summary of the autosaved batch in IndexedDB, or null.
export function autosaved(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open("card-sheet-builder", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("batches");
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const get = db.transaction("batches").objectStore("batches").get("current");
      get.onerror = () => reject(get.error);
      get.onsuccess = () => {
        db.close();
        const r = get.result;
        resolve(r ? { v: r.v, name: r.name, pairCount: r.pairCount, cfg: r.cfg, slots: r.slots.length, sources: r.sources.map(s => s.name) } : null);
      };
    };
  }));
}

// RGB of one pixel on a page preview, given millimeters from the sheet's top-left corner.
export function previewPixel(page, sheetIndex, xMm, yMm, sheetWidthMm = 210) {
  return page.evaluate(([i, x, y, w]) => {
    const cv = document.querySelectorAll(".sheet canvas")[i];
    const s = cv.width / w;
    return [...cv.getContext("2d").getImageData(Math.round(x * s), Math.round(y * s), 1, 1).data.slice(0, 3)];
  }, [sheetIndex, xMm, yMm, sheetWidthMm]);
}
