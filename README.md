# Card sheet builder

Lays out trading card images into print-ready sheets: 3 x 3 cards per A4 or Letter page at
exact millimeter positions, with optional bleed, crop marks and a cut specification for the
print shop. Exports a print PDF and PNG pages, upscales low-resolution images with an ESRGAN
model in the browser, and autosaves to IndexedDB. Static site, no server code.

`docs/HANDOFF.md` describes the app and the invariants that must not change: geometry,
pixel mapping, bleed, export quality, PNG physical size, the batch format and the defaults.

## Commands

```sh
npm install
npm run dev       # dev server on http://localhost:5173
npm run build     # production build in dist/
npm run preview   # serve dist/ on http://localhost:4173
npm test          # Playwright suite against a fresh production build
```

Before the first test run, install the browser once with `npx playwright install chromium`.

## Layout

The code is the original single-file artifact split along its section comments. Function
names are unchanged, so `docs/HANDOFF.md` still applies.

| File | Contents |
| --- | --- |
| `src/config.js` | Defaults, the `cfg` object and its localStorage persistence |
| `src/geometry.js` | `computeLayout()`, the single source of truth for positions |
| `src/state.js` | The cards: `sources`, `slots` and id counters |
| `src/images.js` | Loading and decoding files, TIFF included |
| `src/render.js` | `renderCard()`, `cardPixels()`, page rendering and page counts |
| `src/enhance.js` | AI upscaling; TensorFlow.js and the model load on first use |
| `src/storage.js` | Autosave to IndexedDB, batch zip files |
| `src/exports.js` | Saving files, print PDF, PNG pages with pHYs, cut spec |
| `src/ui.js` | Settings form, preview, spec panel, status line, event wiring |
| `src/main.js` | Entry point: fonts, styles, start-up |
| `public/models/` | ESRGAN medium x4 from UpscalerJS (MIT), served as-is |

## Notes

- **TensorFlow.js is lazy.** It is built into its own `assets/tfjs-*.js` chunk and fetched,
  together with the model, only when an image actually needs enhancing. Sessions with only
  full-resolution scans never download either.
- **Library versions are pinned** to the ones the artifact was tested with, except jsPDF.
  `utif` declares its own pako 1.x; an npm override makes it use the same pako 2.1.0 the
  artifact loaded.
- **jsPDF is 4.2.1**, up from the artifact's 2.5.1, which had security advisories. Its
  PDFs are byte-identical to 2.5.1's apart from the version in `/Producer`; the parity
  tests check this on every run.
- **Autosave is per site.** Work autosaved in the old artifact stays there. Use Save batch in
  the artifact and Open batch here to move it.

## Tests

`npm test` builds the site, serves it and runs Playwright in Chromium. Test images are drawn
on the first run and cached in `tests/.fixtures/`.

- `geometry.spec.js`: page size, placements, cut lines and image dedup in the print PDF.
- `behavior.spec.js`: TIFF decoding (uncompressed and Deflate), rotation, AI enhancement,
  reload, batch files in a fresh profile, PNG pHYs and pixel size.
- `bleed.spec.js`: pixel checks on exported pages that bleed covers every gap.
- `lazy-load.spec.js`: TensorFlow.js and the model are never requested when not needed;
  model files arrive byte-identical.
- `parity.spec.js`: runs the original artifact (`tests/reference/artifact.html`) side by
  side with this build and requires byte-identical PDFs, cut specs and PNG pages, apart
  from the PDF creation time, file ID and jsPDF version, plus batch files opening in both
  directions. The artifact's CDN libraries are served locally and are identical to the
  CDN files: its jsPDF 2.5.1 from `tests/reference/`, the rest from `node_modules`.

The enhancement test runs ESRGAN on WebGL. It uses Chromium's new headless mode, which
gets a hardware GPU where one exists; on a machine without one it falls back to software
rendering and takes longer.

## Deploying

Vercel, as a static Vite site. `vercel.json` sets the framework, build command and output
directory, and serves `/models/*` and the hashed `/assets/*` with a one-year immutable
cache. There are no environment variables.
