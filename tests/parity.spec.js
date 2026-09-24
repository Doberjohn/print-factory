// The port against the original single-file artifact (tests/reference/artifact.html,
// unchanged from the handoff), running with exactly the libraries it loads from CDNs.
import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import JSZip from "jszip";
import { FIX } from "./support/fixtures.js";
import { openApp, addCards, openBatch, download, buildBatch, appState } from "./support/app.js";
import { comparable } from "./support/pdf.js";
import { sha256 } from "./support/formats.js";

// Chrome resamples a 2D canvas on either the GPU or the CPU, choosing at run time, and
// the two give slightly different pixels. Wherever cards are scaled (300 DPI output,
// keep proportions), two runs of the same code could then embed different image bytes.
// Rendering on the CPU makes both apps deterministic, so they compare byte for byte.
test.use({ launchOptions: { args: ["--disable-accelerated-2d-canvas"] } });

const ARTIFACT = "https://artifact.test/";
// Served locally, byte-identical to the CDN files. The app moved on to jsPDF 4.x, so the
// artifact's jsPDF 2.5.1 is kept in tests/reference/; the other libraries still match
// the app's own versions in node_modules.
const CDN = {
  "https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js": { file: "node_modules/pako/dist/pako.min.js", pkg: "pako", version: "2.1.0" },
  "https://cdn.jsdelivr.net/npm/utif@3.1.0/UTIF.js": { file: "node_modules/utif/UTIF.js", pkg: "utif", version: "3.1.0" },
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js": {
    file: "tests/reference/jspdf-2.5.1.umd.min.js",
    sha256: "98ccf17aa10c20bb1301762618fcc9b6ab3a4e7f26b6071d64d0b41154df3875",
  },
  "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js": { file: "node_modules/jszip/dist/jszip.min.js", pkg: "jszip", version: "3.10.1" },
  "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js": { file: "node_modules/@tensorflow/tfjs/dist/tf.min.js", pkg: "@tensorflow/tfjs", version: "4.22.0" },
};

// The reference must stay the artifact as it shipped: fail loudly if a library drifts.
function checkReferenceLibraries() {
  for (const [url, lib] of Object.entries(CDN)) {
    if (lib.pkg) {
      const { version } = JSON.parse(fs.readFileSync(`node_modules/${lib.pkg}/package.json`, "utf8"));
      if (version !== lib.version) throw new Error(`The artifact loads ${lib.pkg} ${lib.version}, but node_modules has ${version}. Keep a ${lib.version} copy in tests/reference/ for ${url}.`);
    } else if (sha256(fs.readFileSync(lib.file)) !== lib.sha256) {
      throw new Error(`${lib.file} is not the file the artifact loads from ${url}.`);
    }
  }
}

async function openArtifact(browser) {
  checkReferenceLibraries();
  const context = await browser.newContext();
  await context.route(ARTIFACT, route => route.fulfill({ path: path.resolve("tests/reference/artifact.html"), contentType: "text/html; charset=utf-8" }));
  for (const [url, { file }] of Object.entries(CDN)) {
    await context.route(url, route => route.fulfill({ path: path.resolve(file), contentType: "text/javascript; charset=utf-8" }));
  }
  await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.fulfill({ contentType: "text/css", body: "" }));
  const page = await context.newPage();
  await openApp(page, ARTIFACT);
  return page;
}

// Where two files first differ, with some text around it, or null when they're identical.
function firstDifference(artifact, port) {
  const n = Math.min(artifact.length, port.length);
  for (let i = 0; i < n; i++) {
    if (artifact[i] !== port[i]) {
      const around = b => b.subarray(Math.max(0, i - 60), i + 60).toString("latin1");
      return { offset: i, artifact: around(artifact), port: around(port) };
    }
  }
  return artifact.length === port.length ? null : { lengths: { artifact: artifact.length, port: port.length } };
}

// A TIFF, a landscape card and 16 PNGs: TIFF decoding, rotation and dedup all show up in the output.
const MIX = [FIX.scanTif, FIX.landscape, ...Array(16).fill(FIX.scanPng)];

const SETTINGS = {
  "defaults": async () => {},
  "Letter, gap 4, bleed 2, keep proportions, 300 DPI": async page => {
    await page.check('input[name="sheet"][value="letter"]');
    await page.fill("#gap", "4");
    await page.fill("#bleed", "2");
    await page.check('input[name="fit"][value="cover"]');
    await page.check('input[name="dpi"][value="300"]');
  },
  "custom 330 x 480 mm sheet, no gap, bleed 1.5, no marks, label or rotation": async page => {
    await page.check('input[name="sheet"][value="custom"]');
    await page.fill("#pageW", "330");
    await page.fill("#pageH", "480");
    await page.fill("#gap", "0");
    await page.fill("#bleed", "1.5");
    await page.uncheck("#marks");
    await page.uncheck("#labels");
    await page.uncheck("#rotate");
  },
};

for (const [name, configure] of Object.entries(SETTINGS)) {
  test(`print PDF and cut spec are identical to the artifact's: ${name}`, async ({ page, browser }) => {
    const artifact = await openArtifact(browser);
    await openApp(page);
    for (const app of [artifact, page]) {
      await addCards(app, MIX);
      await configure(app);
    }
    expect(await appState(page)).toEqual(await appState(artifact));
    for (const button of ["#pdfBtn", "#specBtn"]) {
      const expected = comparable((await download(artifact, button)).bytes);
      const actual = comparable((await download(page, button)).bytes);
      expect(firstDifference(expected, actual), button).toBeNull();
    }
    await artifact.context().close();
  });
}

test("PNG pages are identical to the artifact's", async ({ page, browser }) => {
  const artifact = await openArtifact(browser);
  await openApp(page);
  for (const app of [artifact, page]) {
    await addCards(app, MIX);
    await SETTINGS["Letter, gap 4, bleed 2, keep proportions, 300 DPI"](app);
  }
  const expected = await JSZip.loadAsync((await download(artifact, "#pngBtn")).bytes);
  const actual = await JSZip.loadAsync((await download(page, "#pngBtn")).bytes);
  expect(Object.keys(actual.files)).toEqual(Object.keys(expected.files));
  for (const file of Object.keys(expected.files)) {
    const diff = firstDifference(await expected.file(file).async("nodebuffer"), await actual.file(file).async("nodebuffer"));
    expect(diff, file).toBeNull();
  }
  await artifact.context().close();
});

test("a batch saved by the artifact opens in the port with the same state", async ({ page, browser }) => {
  const artifact = await openArtifact(browser);
  const before = await buildBatch(artifact, FIX);
  const file = await download(artifact, "#saveBatch");
  await artifact.context().close();

  await openApp(page);
  await openBatch(page, file.bytes, file.name);
  await expect(page.locator("#status")).toHaveText("Opened Rhino and friends: 3 cards.");
  expect(await appState(page)).toEqual(before);
});

test("a batch saved by the port opens in the artifact with the same state", async ({ page, browser }) => {
  await openApp(page);
  const before = await buildBatch(page, FIX);
  const file = await download(page, "#saveBatch");

  const artifact = await openArtifact(browser);
  await openBatch(artifact, file.bytes, file.name);
  await expect(artifact.locator("#status")).toHaveText("Opened Rhino and friends: 3 cards.");
  expect(await appState(artifact)).toEqual(before);
  await artifact.context().close();
});
