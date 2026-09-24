import fs from "node:fs";
import { test, expect } from "@playwright/test";
import { FIX } from "./support/fixtures.js";
import { openApp, addCards, download, autosaved } from "./support/app.js";
import { sha256 } from "./support/formats.js";

test("a session with only full-resolution scans never downloads TensorFlow.js or the model", async ({ page }) => {
  const requested = [];
  page.on("request", req => requested.push(new URL(req.url()).pathname));
  await openApp(page);
  const scriptsAtStart = requested.filter(p => p.endsWith(".js"));

  await addCards(page, [FIX.scanTif, FIX.scanDeflateTif, ...Array(16).fill(FIX.scanPng)]);
  await expect(page.locator("#enhance")).toBeChecked(); // enhancement is on, just never needed
  await download(page, "#pdfBtn");
  await download(page, "#specBtn");
  await download(page, "#saveBatch");
  await expect.poll(async () => (await autosaved(page))?.slots).toBe(18);

  expect(requested.filter(p => /tfjs|\/models\//.test(p))).toEqual([]);
  expect(requested.filter(p => p.endsWith(".js"))).toEqual(scriptsAtStart);
});

test("the model files are served byte-identical to public/", async ({ request }) => {
  for (const file of ["x4/model.json", "x4/group1-shard1of1.bin", "LICENSE.txt"]) {
    const res = await request.get(`/models/esrgan-medium/${file}`);
    expect(res.status(), file).toBe(200);
    expect(sha256(await res.body()), file).toBe(sha256(fs.readFileSync(`public/models/esrgan-medium/${file}`)));
  }
});
