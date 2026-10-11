// Character-cell chart primitives plus the Kitty graphics escape for terminals that draw pixels.

const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

/** The last `width` values scaled to eight block levels; flat series sit at the middle level. */
export function sparkline(values: number[], width: number): string {
  const vals = values.slice(-width);
  if (vals.length === 0) return " ".repeat(width);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const out = vals.map((v) => (max === min ? BLOCKS[3] : BLOCKS[Math.round(((v - min) / (max - min)) * 7)]));
  return out.join("");
}

const BRAILLE_BITS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
];

/** Points with x, y in 0..1 (y up) drawn on a width x height grid of braille cells. */
export function braillePlot(points: { x: number; y: number }[], width: number, height: number): string[] {
  const cols = width * 2;
  const rows = height * 4;
  const cells = Array.from({ length: height }, () => Array.from({ length: width }, () => 0));
  for (const p of points) {
    const cx = Math.min(cols - 1, Math.max(0, Math.round(p.x * (cols - 1))));
    const cy = Math.min(rows - 1, Math.max(0, Math.round((1 - p.y) * (rows - 1))));
    cells[Math.floor(cy / 4)]![Math.floor(cx / 2)]! |= BRAILLE_BITS[cy % 4]![cx % 2]!;
  }
  return cells.map((row) => row.map((bits) => String.fromCharCode(0x2800 + bits)).join(""));
}

/** A `width`-cell bar: `█` at the point estimate, `▒` across [lo, hi], `·` elsewhere. */
export function bar(value: number, lo: number, hi: number, width = 20): string {
  return Array.from({ length: width }, (_, i) => {
    const x = i / (width - 1);
    if (Math.abs(x - value) <= 0.5 / (width - 1)) return "█";
    return x >= lo && x <= hi ? "▒" : "·";
  }).join("");
}

export type Graphics = "cells" | "kitty";

export function detectGraphics(env: Record<string, string | undefined> = process.env): Graphics {
  if (env.HONE_GRAPHICS === "cells" || env.HONE_GRAPHICS === "kitty") return env.HONE_GRAPHICS;
  if (env.KITTY_WINDOW_ID) return "kitty";
  if (/kitty/i.test(env.TERM ?? "")) return "kitty";
  if (/^(ghostty|wezterm)$/i.test(env.TERM_PROGRAM ?? "")) return "kitty";
  return "cells";
}

/** Kitty graphics protocol: transmit a PNG and display it over `cols` x `rows` cells, chunked at 4096 bytes. */
export function kittyImageEscape(png: Uint8Array, cols: number, rows: number): string {
  const b64 = Buffer.from(png).toString("base64");
  const chunks: string[] = [];
  for (let i = 0; i < b64.length; i += 4096) chunks.push(b64.slice(i, i + 4096));
  return chunks
    .map((chunk, i) => {
      const control = i === 0 ? `f=100,a=T,c=${cols},r=${rows},m=${chunks.length > 1 ? 1 : 0}` : `m=${i === chunks.length - 1 ? 0 : 1}`;
      return `\u001b_G${control};${chunk}\u001b\\`;
    })
    .join("");
}

// --- minimal PNG encoder (RGBA, no dependency) for the kitty path ------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);
  const crcInput = new Uint8Array(typeBytes.length + data.length);
  crcInput.set(typeBytes);
  crcInput.set(data, typeBytes.length);
  view.setUint32(8 + data.length, crc32(crcInput));
  return out;
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  const idat = new Uint8Array(Bun.deflateSync(raw, { library: "zlib" }));
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Scatter plot rasterised to RGBA: dark background, axes, 3px points. */
export function rasterScatter(points: { x: number; y: number }[], width = 320, height = 160): Uint8Array {
  const px = new Uint8Array(width * height * 4);
  const put = (x: number, y: number, r: number, g: number, b: number): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = 255;
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) put(x, y, 15, 18, 22);
  for (let x = 0; x < width; x++) put(x, height - 1, 90, 97, 110);
  for (let y = 0; y < height; y++) put(0, y, 90, 97, 110);
  for (const p of points) {
    const cx = Math.round(p.x * (width - 4)) + 2;
    const cy = Math.round((1 - p.y) * (height - 4)) + 1;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) put(cx + dx, cy + dy, 111, 177, 220);
  }
  return px;
}
