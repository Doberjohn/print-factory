# Handoff: Card sheet builder as a standalone site

## What this is

A browser tool that lays out trading card images into print-ready sheets. The user
prints proxy cards for Marvel Champions and sends the pages to a print shop that cuts
them, so exact millimeter geometry is the whole point of the app.

It currently exists as a single self-contained HTML file that ran inside a sandboxed
artifact host. The job is to turn it into a normal static website deployed on Vercel,
with no loss of behavior.

**The app is already complete and tested. This is a port, not a rewrite.** Keep the
behavior identical unless a task below says otherwise.

## What's in this package

```
HANDOFF.md                                  this file
app/index.html                              the complete working app (single file, ~62 KB)
public/models/esrgan-medium/x4/model.json   AI upscaler model (TensorFlow.js layers format)
public/models/esrgan-medium/x4/group1-shard1of1.bin   model weights (2.8 MB)
public/models/esrgan-medium/LICENSE.txt     MIT license for the model (UpscalerJS)
```

`app/index.html` is the source of truth for all behavior. Read it before changing
anything. It has one `<style>` block and one `<script>` block, organized in labeled
sections: settings, geometry, loading, rendering, AI enhancement, preview, spec,
batches, saving files, exports, wiring.

## What the app does

- Accepts card images (TIFF, PNG, JPG). TIFF is decoded in the browser with UTIF.
- Lays them out 3 x 3 per A4 page, always in pairs of pages, at exact millimeter
  positions computed from card size, gap, and bleed.
- Optionally extends each card's edge pixels outward to create bleed for the cutter.
- Upscales low-resolution images 4x with an ESRGAN model running on WebGL.
- Exports a print PDF (each card placed in millimeters), PNG pages at 300 or 600 DPI
  with a pHYs chunk for physical size, and a cut specification PDF for the print shop.
- Autosaves everything to IndexedDB and can save or open a batch as a zip.

## Tasks

### 1. Project setup

Create a Vite vanilla-JS project (no framework, the app is plain DOM code).

- Move the `<script>` contents from `app/index.html` into ES modules under `src/`.
  A reasonable split, following the existing section comments: `config.js`,
  `geometry.js`, `images.js`, `enhance.js`, `render.js`, `exports.js`, `storage.js`,
  `ui.js`, `main.js`. Keep function names as they are so this document stays useful.
- Move the `<style>` block to `src/style.css` unchanged.
- Copy `public/` from this package into the project root as-is.
- Replace the CDN script tags with npm dependencies:
  `pako@2.1.0`, `utif@3.1.0`, `jspdf@2.5.1`, `jszip@3.10.1`, `@tensorflow/tfjs@4.22.0`.

**UTIF quirk:** `utif` expects a global `pako` at import time. Set
`globalThis.pako = pako` before importing UTIF, or verify that `import UTIF from "utif"`
resolves deflate correctly against the bundled pako. The app only uses
`UTIF.decode`, `UTIF.decodeImage`, and `UTIF.toRGBA8`. The user's real scans are
uncompressed TIFFs, but do not assume that; test a deflate-compressed TIFF too.

Everything the code accesses as a global (`window.jspdf.jsPDF`, `window.JSZip`,
`window.UTIF`, `window.tf`) must be updated to imported bindings, or those globals
assigned at startup. Do not leave a mix of both.

### 2. Load the AI model from files instead of from the page

The sandbox blocked network requests, so the model was embedded as base64 JSON in the
page. On a real site, use the standard TensorFlow.js loading path.

In `srModel()`, replace the inline-JSON branch with:

```js
const model = await tf.loadLayersModel("/models/esrgan-medium/x4/model.json");
```

Keep everything else about enhancement unchanged, in particular:

- Input is RGB float in the **0 to 255** range, not 0 to 1. See `upscaleImage()`.
- Output is 0 to 255 and is clipped, rounded, and converted to int before
  `tf.browser.toPixels`.
- The image is flattened onto white first, so transparent corners do not go black.
- Tiling is 96 px tiles with 12 px of overlap context, which prevents seams. Do not
  change these numbers without re-testing on a real card image.
- `await tf.nextFrame()` between tiles keeps the UI responsive.

**Lazy-load TensorFlow.js.** It is by far the largest dependency and most sessions
never need it (full-resolution scans are not enhanced). Convert `srModel()` to use
`const tf = await import("@tensorflow/tfjs")` and make sure nothing else imports tf at
module top level. Verify with the network tab that a session using only 600 DPI scans
never downloads tf or the model.

### 3. Replace the artifact download bridge

`saveFile()` has a `window.claude.use("downloads")` branch for the sandbox host, then an
anchor-element fallback. Delete the `window.claude` branch and its error-code handling
(`declined`, `too_large`, `rate_limited`) and keep the anchor path. Keep the
`URL.revokeObjectURL` cleanup and keep returning a boolean, since callers use it to
decide whether to report success.

### 4. Fonts

The page loads Barlow and Barlow Condensed from Google Fonts. Either keep that or
self-host with `@fontsource/barlow` and `@fontsource/barlow-condensed`. Self-hosting is
preferred: it removes a third-party request and avoids a flash of fallback text. Keep
the existing fallback stacks.

### 5. Deploy to Vercel

Static site, no server code, no environment variables.

- Framework preset: Vite. Build command `vite build`, output directory `dist`.
- Add `vercel.json` with long-lived caching for the model, which is immutable:

```json
{
  "headers": [
    {
      "source": "/models/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
    }
  ]
}
```

- Confirm `group1-shard1of1.bin` is served as a static asset and is not mangled by the
  build. It must arrive byte-identical, so keep it in `public/`, not in `src/`.
- No COOP or COEP headers are needed. The app does not use SharedArrayBuffer.

## Invariants: do not change these

The output goes to a commercial cutter. These details were tested against real prints.

1. **Geometry.** `computeLayout()` is the single source of truth for positions. The grid
   is centered on the page; positions are rounded to 0.001 mm. Bleed between cards is
   capped at half the gap; outer bleed is capped by the margin. Preview, PDF, PNG, and
   the cut spec all read from this one function. Never compute a position anywhere else.
2. **Pixel mapping.** `cardPixels()` derives whole-pixel bounds from millimeters via
   `Math.round(mm / 25.4 * dpi)` for both the trim box and the bleed box, so adjacent
   cards tile exactly with no seam or overlap. Keep this rounding.
3. **Bleed generation.** `renderCard()` builds bleed by sampling a line of pixels
   slightly inside each edge (0.4% of the card, minimum 1 px) and stretching it outward,
   with the four corners filled from corner pixels. This avoids the scanner fringe at the
   very edge. Smoothing is deliberately off for that step.
4. **Export quality.** Cards go into the PDF as JPEG at quality 0.95. Identical cards are
   deduplicated through the jsPDF `alias` parameter, which is what keeps a 14-page file
   at about 60 MB instead of several hundred. The alias key includes enhancement state,
   rotation, fit mode, and pixel dimensions.
5. **PNG physical size.** `withDpi()` injects a pHYs chunk after the IHDR so other
   programs print the page at the right size. The CRC32 implementation must stay correct.
6. **Batch format.** Images are stored as JPEG at quality 0.95, matching print output.
   `batch.json` holds settings, page count, slot order, and source list. Keep the format
   backward compatible, or bump `v` and handle old files, because the user already has
   saved batches.
7. **Defaults.** Card 63.5 x 88 mm, gap 3 mm, bleed 0 mm, A4, 600 DPI, crop marks on,
   page label on, stretch to fit, rotate landscape on, enhancement on. Settings persist
   in localStorage under `card-sheet-builder:settings:v2`.
8. **Pairs of pages.** Pages always come in twos. Downloads are disabled unless every
   visible page is full. This matches how the print shop imposes the sheets.

## Testing

Use Playwright. Fixtures: one 600 DPI card scan, one 300 px database image, one
landscape image, one TIFF.

Geometry assertions on a generated PDF, with defaults and 18 cards (these are the
values the current build produces and are verified against real prints):

- Page size 210 x 297 mm, 2 pages, 9 image placements per page.
- Every card placed at width 63.5 mm and height 88.0 mm.
- Column x positions 6.75, 73.25, 139.75 mm. Row y positions 13.5, 104.5, 195.5 mm.
- Identical cards produce one embedded image object, not several.
- With gap 4 and bleed 2, placements become 67.5 x 92 mm and cut lines fall at
  5.75, 69.25, 73.25, 136.75, 140.75, 204.25 mm from the left.

Behavior tests:

- A TIFF decodes and renders.
- A landscape image is rotated automatically.
- A 300 px image is enhanced, the card shows an "Enhancing" tag, downloads stay disabled
  until it finishes, and the enhanced image is about 480 DPI afterwards.
- Reload restores cards, order, batch name, page count, and settings from IndexedDB.
- Save batch then open that zip in a fresh browser profile restores the same state.
- PNG export carries the right pHYs DPI and pixel dimensions (4961 x 7016 at 600 DPI).

Add a visual check for bleed: render a page with gap 4 and bleed 2 and confirm the
gap between two cards is fully covered with no white line at the midpoint.

## Acceptance criteria

- The deployed site produces a PDF that is byte-for-byte equivalent in geometry to the
  current artifact's output for the same inputs and settings.
- A session with only full-resolution scans never downloads TensorFlow.js.
- Autosave and batch files work, and batches saved by the artifact version still open.
- Lighthouse performance is reasonable on a cold load, with the model excluded since it
  is lazy.

## Optional, only after the port is verified

- Multiple named batches in IndexedDB with a switcher, instead of one autosave slot.
- Import cards back from a previously generated PDF. Each card is already stored as its
  own image object, so this is mostly plumbing with pdf.js.
- Offline support with a service worker, including caching the model.
- Keyboard reordering of cards for accessibility. Drag and drop is currently mouse only.
- Card backs and duplex printing.
