// Geometry of the print PDF. These are the values the artifact produces, verified
// against real prints (HANDOFF.md, "Testing").
import { test, expect } from "@playwright/test";
import { FIX } from "./support/fixtures.js";
import { openApp, addCards, download } from "./support/app.js";
import { readPdf, distinct, cropMarks } from "./support/pdf.js";

const EIGHTEEN = Array(18).fill(FIX.scanPng);

test("defaults: two A4 pages of nine 63.5 x 88 mm cards on the standard grid", async ({ page }) => {
  await openApp(page);
  await addCards(page, EIGHTEEN);
  const pdf = readPdf((await download(page, "#pdfBtn")).bytes);

  expect(pdf.pages).toHaveLength(2);
  for (const p of pdf.pages) {
    expect(p.width).toBeCloseTo(210, 6);
    expect(p.height).toBeCloseTo(297, 6);
    expect(p.placements).toHaveLength(9);
    for (const card of p.placements) {
      expect(card.w).toBeCloseTo(63.5, 6);
      expect(card.h).toBeCloseTo(88.0, 6);
    }
    expect(distinct(p.placements.map(c => c.x))).toEqual([6.75, 73.25, 139.75]);
    expect(distinct(p.placements.map(c => c.y))).toEqual([13.5, 104.5, 195.5]);
    expect(cropMarks(p)).toEqual({
      x: [6.75, 70.25, 73.25, 136.75, 139.75, 203.25],
      y: [13.5, 101.5, 104.5, 192.5, 195.5, 283.5],
    });
  }
});

test("identical cards share one embedded image object", async ({ page }) => {
  await openApp(page);
  await addCards(page, EIGHTEEN);
  const pdf = readPdf((await download(page, "#pdfBtn")).bytes);

  expect(pdf.images).toHaveLength(1);
  expect(pdf.images[0].dict).toMatch(/\/Width 1500\s/);
  expect(pdf.images[0].dict).toMatch(/\/Height 2079\s/);
  expect(pdf.images[0].dict).toMatch(/\/Filter \/DCTDecode/);
  expect(new Set(pdf.pages.flatMap(p => p.placements.map(c => c.name)))).toEqual(new Set(["I0"]));
});

test("gap 4 and bleed 2: 67.5 x 92 mm placements and cut lines at the documented positions", async ({ page }) => {
  await openApp(page);
  await addCards(page, EIGHTEEN);
  await page.fill("#gap", "4");
  await page.fill("#bleed", "2");
  await expect(page.locator(".spec .cuts code").first()).toHaveText("5.75, 69.25, 73.25, 136.75, 140.75, 204.25");
  const pdf = readPdf((await download(page, "#pdfBtn")).bytes);

  expect(pdf.pages).toHaveLength(2);
  for (const p of pdf.pages) {
    expect(p.placements).toHaveLength(9);
    for (const card of p.placements) {
      expect(card.w).toBeCloseTo(67.5, 6);
      expect(card.h).toBeCloseTo(92, 6);
    }
    // Each placement starts one bleed (2 mm) before its cut line.
    expect(distinct(p.placements.map(c => c.x))).toEqual([3.75, 71.25, 138.75]);
    expect(distinct(p.placements.map(c => c.y))).toEqual([10.5, 102.5, 194.5]);
    expect(cropMarks(p)).toEqual({
      x: [5.75, 69.25, 73.25, 136.75, 140.75, 204.25],
      y: [12.5, 100.5, 104.5, 192.5, 196.5, 284.5],
    });
  }
  // Bleed is the same on every side of every card here, so dedup still holds.
  expect(pdf.images).toHaveLength(1);
});
