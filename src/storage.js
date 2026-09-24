import JSZip from "jszip";
import { cfg, saveCfg } from "./config.js";
import { sources, slots, setSlots, nextUid, reserveSrcId } from "./state.js";
import { makeThumb } from "./images.js";
import { pairCount, setPairCount } from "./render.js";
import { SR } from "./enhance.js";
import { saveFile, toBlob, stamp } from "./exports.js";
import { $, setStatus, schedule, applyCfgToInputs } from "./ui.js";

/* ---------- batches: autosave and batch files ---------- */
const DB_NAME = "card-sheet-builder", DB_STORE = "batches", DB_KEY = "current";
export let batchName = "Batch 1";
export function setBatchName(name) { batchName = name; }
let autosaveOk = true, saveTimer = 0, dbPromise = null;

function idb() {
  if (!dbPromise) dbPromise = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains(DB_STORE)) d.createObjectStore(DB_STORE); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error("blocked"));
  });
  return dbPromise;
}
async function idbPut(key, val) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(val, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
}
async function idbGet(key) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(DB_STORE, "readonly");
    const q = tx.objectStore(DB_STORE).get(key);
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}

function setSaveNote(t) { $("#saveNote").textContent = t; }
function autosaveOff(msg) { autosaveOk = false; setSaveNote(msg); }
function clockNow() { const d = new Date(); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; }
function safeName(t) { return (t || "batch").replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "batch"; }

// Images are kept as JPEG at the same quality the print PDF uses.
function whiteCanvas(img) {
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  const x = c.getContext("2d");
  x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(img, 0, 0);
  return c;
}
async function srcBlob(src) { if (!src.blob) src.blob = await toBlob(whiteCanvas(src.img), "image/jpeg", 0.95); return src.blob; }
async function srcEnhBlob(src) {
  if (!src.enh) return null;
  if (!src.enhBlob) src.enhBlob = await toBlob(whiteCanvas(src.enh), "image/jpeg", 0.95);
  return src.enhBlob;
}
function jpegBlob(data) { return new Blob([data], { type: "image/jpeg" }); }

export function scheduleSave() {
  if (!autosaveOk) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 1200);
}
async function saveNow() {
  if (!autosaveOk) return;
  try {
    const list = [];
    for (const s of sources.values()) list.push({ id: s.id, key: s.key, name: s.name, blob: await srcBlob(s), enhBlob: await srcEnhBlob(s) });
    await idbPut(DB_KEY, { v: 1, name: batchName, savedAt: Date.now(), cfg, pairCount, slots: slots.map(x => ({ src: x.src })), sources: list });
    setSaveNote(slots.length ? `Saved in this browser at ${clockNow()}` : "Your work is saved in this browser as you go.");
  } catch (e) {
    console.error(e);
    autosaveOff(e && e.name === "QuotaExceededError"
      ? "This browser's storage is full, so autosave stopped. Use Save batch to keep a copy."
      : "Autosave isn't available in this browser. Use Save batch to keep a copy.");
  }
}

async function loadRecord(rec) {
  sources.clear(); setSlots([]); SR.queue = []; SR.failed = false;
  Object.assign(cfg, rec.cfg || {});
  saveCfg();
  applyCfgToInputs();
  setPairCount(Math.max(1, rec.pairCount || 1));
  batchName = rec.name || batchName;
  $("#batchName").value = batchName;
  for (const s of rec.sources) {
    const img = await createImageBitmap(s.blob);
    const enh = s.enhBlob ? await createImageBitmap(s.enhBlob) : null;
    sources.set(s.id, { id: s.id, key: s.key, name: s.name, img, w: img.width, h: img.height, thumb: makeThumb(img),
      enh, enhThumb: enh ? makeThumb(enh) : null, enhState: enh ? "done" : null, rot: {}, blob: s.blob, enhBlob: s.enhBlob || null });
    reserveSrcId(s.id);
  }
  setSlots((rec.slots || []).filter(x => sources.has(x.src)).map(x => ({ uid: nextUid(), src: x.src })));
  schedule();
}

export async function restoreSaved() {
  let rec;
  try { rec = await idbGet(DB_KEY); }
  catch (e) { autosaveOff("Autosave isn't available in this browser. Use Save batch to keep a copy."); return; }
  if (!rec || !rec.sources || !rec.sources.length) return;
  setStatus("Restoring your last batch");
  try {
    await loadRecord(rec);
    const when = new Date(rec.savedAt);
    setStatus(`Restored ${slots.length} card${slots.length === 1 ? "" : "s"} saved on ${when.toLocaleDateString()} at ${when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`);
    setSaveNote(`Saved in this browser at ${clockNow()}`);
  } catch (e) { console.error(e); setStatus("Your saved batch couldn't be restored.", true); }
}

export async function saveBatchFile() {
  if (!slots.length) { setStatus("There are no cards to save yet."); return; }
  setStatus("Packing the batch");
  const zip = new JSZip();
  const man = { v: 1, name: batchName, savedAt: Date.now(), cfg, pairCount, slots: slots.map(x => ({ src: x.src })), sources: [] };
  let i = 0;
  for (const s of sources.values()) {
    i++;
    const base = `${String(i).padStart(2, "0")}_${safeName(s.name.replace(/\.[^.]+$/, ""))}`;
    zip.file(`cards/${base}.jpg`, await srcBlob(s));
    const e = await srcEnhBlob(s);
    if (e) zip.file(`enhanced/${base}.jpg`, e);
    man.sources.push({ id: s.id, key: s.key, name: s.name, file: `cards/${base}.jpg`, enhFile: e ? `enhanced/${base}.jpg` : null });
  }
  zip.file("batch.json", JSON.stringify(man, null, 1));
  zip.file("README.txt", "Saved batch from the card sheet builder.\nOpen it with the Open batch button to carry on where you left off.\nThe cards folder holds every card image at print quality, usable on their own.\nThe enhanced folder holds AI-enhanced versions of small images.\n");
  const ok = await saveFile(`${safeName(batchName)}-${stamp()}.zip`, await zip.generateAsync({ type: "blob", compression: "STORE" }));
  if (ok) setStatus(`Batch saved: ${sources.size} image${sources.size === 1 ? "" : "s"}, ${slots.length} card${slots.length === 1 ? "" : "s"}.`);
}

export async function openBatchFile(file) {
  setStatus(`Opening ${file.name}`);
  try {
    const zip = await JSZip.loadAsync(file);
    const entry = zip.file("batch.json");
    if (!entry) { setStatus("That zip isn't a saved batch.", true); return; }
    const man = JSON.parse(await entry.async("string"));
    const rec = { name: man.name, savedAt: man.savedAt, cfg: man.cfg, pairCount: man.pairCount, slots: man.slots, sources: [] };
    for (const s of man.sources || []) {
      const f = zip.file(s.file);
      if (!f) continue;
      const ef = s.enhFile ? zip.file(s.enhFile) : null;
      rec.sources.push({ id: s.id, key: s.key, name: s.name,
        blob: jpegBlob(await f.async("arraybuffer")),
        enhBlob: ef ? jpegBlob(await ef.async("arraybuffer")) : null });
    }
    await loadRecord(rec);
    setStatus(`Opened ${batchName}: ${slots.length} card${slots.length === 1 ? "" : "s"}.`);
    scheduleSave();
  } catch (e) { console.error(e); setStatus("That file couldn't be opened as a batch.", true); }
}
