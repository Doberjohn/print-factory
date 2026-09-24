/* ---------- state ---------- */
// The cards on the sheets, shared by every module. Other modules replace these
// values only through the functions below.
export const sources = new Map();   // id -> {id, key, name, img, w, h, thumb, enh, enhThumb, enhState, rot:{}}
export let slots = [];              // [{uid, src}]
export let busy = false;
let uidSeq = 1, srcSeq = 1;

export function setSlots(list) { slots = list; }
export function setBusy(on) { busy = on; }
export const nextUid = () => uidSeq++;
export const nextSrcId = () => "s" + (srcSeq++);
// Restored batches bring their own source ids, so new ids start after the highest one.
export function reserveSrcId(id) {
  const num = parseInt(String(id).replace(/\D/g, ""), 10);
  if (num >= srcSeq) srcSeq = num + 1;
}
