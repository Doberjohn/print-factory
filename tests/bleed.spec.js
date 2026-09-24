// Visual checks of bleed on the exported page, with gap 4 mm and bleed 2 mm. Cut lines
// fall at x 5.75, 69.25, 73.25, 136.75, 140.75, 204.25 and y 12.5, 100.5, 104.5,
// 192.5, 196.5, 284.5. Each gap's midpoint is where two cards' bleeds meet.
import { test, expect } from "@playwright/test";
import JSZip from "jszip";
import { FIX } from "./support/fixtures.js";
import { openApp, addCards, download } from "./support/app.js";

// Exports 18 copies of `file` as PNG pages, then decodes page 1 in a blank tab into
// `window.sheet`, a canvas the checks read from.
async function exportedPage(page, file, dpi) {
  await openApp(page);
  await addCards(page, Array(18).fill(file));
  await page.fill("#gap", "4");
  await page.fill("#bleed", "2");
  await page.check(`input[name="dpi"][value="${dpi}"]`);
  const zip = await JSZip.loadAsync((await download(page, "#pngBtn")).bytes);
  const png = await zip.file("page-1.png").async("base64");
  const viewer = await page.context().newPage();
  await viewer.evaluate(async png => {
    const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const cv = document.createElement("canvas");
    cv.width = bmp.width; cv.height = bmp.height;
    cv.getContext("2d").drawImage(bmp, 0, 0);
    window.sheet = cv;
  }, png);
  return viewer;
}

// Attaches the area around the first gap crossing to the report, for a human look.
async function attachCrossing(viewer, dpi, testInfo, name) {
  const png = await viewer.evaluate(dpi => {
    const P = mm => Math.round(mm / 25.4 * dpi);
    const crop = document.createElement("canvas");
    crop.width = P(84) - P(58); crop.height = P(112) - P(90);
    crop.getContext("2d").drawImage(window.sheet, P(58), P(90), crop.width, crop.height, 0, 0, crop.width, crop.height);
    return crop.toDataURL("image/png").split(",")[1];
  }, dpi);
  await testInfo.attach(name, { body: Buffer.from(png, "base64"), contentType: "image/png" });
}

for (const dpi of [600, 300]) {
  test(`bleed covers every gap with no white line at the midpoint, ${dpi} DPI`, async ({ page }, testInfo) => {
    const viewer = await exportedPage(page, FIX.clean, dpi);
    await attachCrossing(viewer, dpi, testInfo, `gap-crossing-${dpi}dpi.png`);
    const white = await viewer.evaluate(dpi => {
      const P = mm => Math.round(mm / 25.4 * dpi);
      const ctx = window.sheet.getContext("2d");
      const count = (x0, y0, x1, y1) => {
        const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] > 230 && d[i + 1] > 230 && d[i + 2] > 230) n++;
        return n;
      };
      // The grid including its outer bleed spans x 3.75 to 206.25 and y 10.5 to 286.5.
      const top = P(10.5), bottom = P(286.5), left = P(3.75), right = P(206.25);
      return {
        // The two pixel columns either side of each vertical gap's midpoint.
        midpoints: [71.25, 138.75].map(x => count(P(x) - 1, top, P(x) + 1, bottom)),
        verticalGaps: [[69.25, 73.25], [136.75, 140.75]].map(([a, b]) => count(P(a), top, P(b), bottom)),
        horizontalGaps: [[100.5, 104.5], [192.5, 196.5]].map(([a, b]) => count(left, P(a), right, P(b))),
      };
    }, dpi);
    expect(white).toEqual({ midpoints: [0, 0], verticalGaps: [0, 0], horizontalGaps: [0, 0] });
  });
}

// The scan fixture has a 2 px light fringe on its very edge. Bleed must extend the card
// from slightly inside the edge, so the gaps get the card's frame color, not the fringe.
test("bleed extends each card from slightly inside its edge, skipping the scanner fringe", async ({ page }, testInfo) => {
  const viewer = await exportedPage(page, FIX.scanPng, 600);
  await attachCrossing(viewer, 600, testInfo, "gap-crossing-fringe-600dpi.png");
  const px = await viewer.evaluate(() => {
    const P = mm => Math.round(mm / 25.4 * 600);
    const ctx = window.sheet.getContext("2d");
    const at = (x, y) => [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)];
    const rows = [56.5, 148.5, 240.5]; // mid-height of each row of cards
    return {
      // The card's own last pixel column before the first vertical cut.
      edge: rows.map(y => at(P(69.25) - 1, P(y))),
      // Either side of each seam where two cards' bleeds meet.
      seams: [71.25, 138.75].flatMap(x => rows.flatMap(y => [at(P(x) - 1, P(y)), at(P(x), P(y))])),
      // Outer bleed, left of the grid and above it.
      outer: [at(P(4.75), P(56.5)), at(P(37.5), P(11.5))],
    };
  });
  for (const rgb of px.edge) expect(Math.min(...rgb)).toBeGreaterThan(240);
  for (const rgb of [...px.seams, ...px.outer]) expect(rgb).toEqual([122, 16, 32]); // the frame, #7A1020
});
