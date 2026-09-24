import UTIF from "utif";
import { sources, slots, nextUid, nextSrcId } from "./state.js";
import { openBatchFile } from "./storage.js";
import { setStatus, schedule } from "./ui.js";

/* ---------- loading ---------- */
function isTiff(u8) {
  return (u8[0] === 0x49 && u8[1] === 0x49 && u8[2] === 42 && u8[3] === 0) ||
         (u8[0] === 0x4D && u8[1] === 0x4D && u8[2] === 0 && u8[3] === 42);
}
async function decodeFile(file) {
  const buf = await file.arrayBuffer();
  if (isTiff(new Uint8Array(buf, 0, Math.min(4, buf.byteLength)))) {
    const ifds = UTIF.decode(buf);
    const ifd = ifds.find(d => d.t256 && d.t257) || ifds[0];
    UTIF.decodeImage(buf, ifd, ifds);
    const rgba = UTIF.toRGBA8(ifd);
    const cv = document.createElement("canvas");
    cv.width = ifd.width; cv.height = ifd.height;
    cv.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, ifd.width * ifd.height * 4), ifd.width, ifd.height), 0, 0);
    return cv;
  }
  return await createImageBitmap(new Blob([buf], { type: file.type || "image/png" }));
}
export function makeThumb(img) {
  const H = 520, s = Math.min(1, H / img.height);
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(img.width * s)); cv.height = Math.max(1, Math.round(img.height * s));
  const x = cv.getContext("2d");
  x.imageSmoothingQuality = "high";
  x.drawImage(img, 0, 0, cv.width, cv.height);
  return cv;
}
export const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

export async function addFiles(fileList) {
  const all = [...fileList];
  const zips = all.filter(f => /\.zip$/i.test(f.name) || f.type === "application/zip");
  if (zips.length) { await openBatchFile(zips[0]); return; }
  const files = all.filter(f => /\.(tiff?|png|jpe?g|webp)$/i.test(f.name) || /^image\//.test(f.type)).sort(byName);
  if (!files.length) { setStatus("Those files aren't images. Use TIFF, PNG or JPG images, or a saved batch zip.", true); return; }
  const failed = [];
  for (let i = 0; i < files.length; i++) {
    setStatus(`Reading ${files[i].name} (${i + 1} of ${files.length})`);
    try {
      const key = `${files[i].name}|${files[i].size}|${files[i].lastModified}`;
      const existing = [...sources.values()].find(s => s.key === key);
      if (existing) { slots.push({ uid: nextUid(), src: existing.id }); continue; }
      const img = await decodeFile(files[i]);
      const id = nextSrcId();
      sources.set(id, { id, key, name: files[i].name, img, w: img.width, h: img.height, thumb: makeThumb(img), enh: null, enhThumb: null, enhState: null, rot: {} });
      slots.push({ uid: nextUid(), src: id });
    } catch (e) {
      failed.push(files[i].name);
    }
  }
  setStatus(failed.length ? `Couldn't read ${failed.join(", ")}. Try saving them as PNG.` : `Added ${files.length - failed.length} card${files.length - failed.length === 1 ? "" : "s"}.`, failed.length > 0);
  schedule();
}
