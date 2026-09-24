// A small reader for the PDFs jsPDF writes. Positions come back in millimeters from
// the top-left corner of the page, the same frame computeLayout() uses.
import zlib from "node:zlib";

const MM_PER_PT = 25.4 / 72;
const NUM = "(-?[\\d.]+)";

export function readPdf(bytes) {
  const buf = Buffer.from(bytes);
  const text = buf.toString("latin1");
  const objects = new Map();
  const head = /(\d+) 0 obj\n/g;
  for (let m; (m = head.exec(text));) {
    const start = head.lastIndex;
    const end = text.indexOf("endobj", start);
    const stream = text.indexOf("stream\n", start);
    if (stream !== -1 && stream < end) {
      const dict = text.slice(start, stream);
      const length = Number(/\/Length (\d+)/.exec(dict)[1]);
      const raw = buf.subarray(stream + 7, stream + 7 + length);
      const data = /\/FlateDecode/.test(dict) ? zlib.inflateSync(raw) : raw;
      objects.set(Number(m[1]), { dict, raw, data });
      head.lastIndex = stream + 7 + length; // skip binary image data
    } else {
      objects.set(Number(m[1]), { dict: text.slice(start, end) });
      head.lastIndex = end;
    }
  }
  const tree = [...objects.values()].find(o => /\/Type \/Pages\b/.test(o.dict));
  const kids = [.../\/Kids \[([^\]]*)\]/.exec(tree.dict)[1].matchAll(/(\d+) 0 R/g)].map(k => Number(k[1]));
  return {
    pages: kids.map(n => readPage(objects, objects.get(n).dict)),
    images: [...objects.values()].filter(o => /\/Subtype \/Image\b/.test(o.dict)),
    objects,
    text,
  };
}

function readPage(objects, dict) {
  const box = /\/MediaBox \[([^\]]+)\]/.exec(dict)[1].trim().split(/\s+/).map(Number);
  const H = box[3];
  const content = objects.get(Number(/\/Contents (\d+) 0 R/.exec(dict)[1])).data.toString("latin1");
  const placements = [...content.matchAll(new RegExp(`${NUM} 0 0 ${NUM} ${NUM} ${NUM} cm\\s+/(\\S+) Do`, "g"))]
    .map(([, w, h, x, y, name]) => ({
      name, x: Number(x) * MM_PER_PT, y: (H - Number(y) - Number(h)) * MM_PER_PT, w: Number(w) * MM_PER_PT, h: Number(h) * MM_PER_PT,
    }));
  const lines = [...content.matchAll(new RegExp(`${NUM} ${NUM} m\\s+${NUM} ${NUM} l\\s+S`, "g"))]
    .map(([, x1, y1, x2, y2]) => ({
      x1: Number(x1) * MM_PER_PT, y1: (H - Number(y1)) * MM_PER_PT, x2: Number(x2) * MM_PER_PT, y2: (H - Number(y2)) * MM_PER_PT,
    }));
  return { width: box[2] * MM_PER_PT, height: H * MM_PER_PT, placements, lines, content };
}

// Distinct values rounded to 0.001 mm, ascending.
export const distinct = values => [...new Set(values.map(v => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);

// Crop marks: x of the vertical ones and y of the horizontal ones.
export function cropMarks(page) {
  const vertical = page.lines.filter(l => Math.abs(l.x1 - l.x2) < 1e-9).map(l => l.x1);
  const horizontal = page.lines.filter(l => Math.abs(l.y1 - l.y2) < 1e-9).map(l => l.y1);
  return { x: distinct(vertical), y: distinct(horizontal) };
}

// The file with its two per-export values removed: the creation time and the random file ID.
export function withoutTimestamps(bytes) {
  return Buffer.from(Buffer.from(bytes).toString("latin1")
    .replace(/\/CreationDate \(D:[^)]*\)/, "/CreationDate ()")
    .replace(/\/ID \[ <[0-9A-F]+> <[0-9A-F]+> \]/, "/ID []"), "latin1");
}
