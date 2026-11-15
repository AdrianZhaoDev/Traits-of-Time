import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { projectRoot } from "./assets.mjs";

const palette = {
  ".": [0, 0, 0, 0],
  I: [48, 40, 38, 255],
  P: [255, 249, 233, 255],
  R: [191, 53, 39, 255],
  Y: [255, 218, 88, 255],
  M: [103, 89, 76, 255],
};

const icons = {
  physique: [
    "................",
    "....II....II....",
    "...IRRI..IRRI...",
    "..IRRYYRIIRYYRI.",
    "..IRYYYYYYYYYRI.",
    "...IRYYYYYYYRI..",
    "....IRYYYYYRI...",
    ".....IRYYYRI....",
    "......IRYRI.....",
    ".......IRI......",
    "........I.......",
    "................",
    "................",
    "................",
    "................",
    "................",
  ],
  wealth: [
    "................",
    ".....IIIII......",
    "...IIYYYYYII....",
    "..IYYYYYYYYYI...",
    ".IYYYYYYYYYYYI..",
    ".IYYYYIIIIYYYI..",
    "IYYYYYIPPIYYYYI.",
    "IYYYYYIPPIYYYYI.",
    "IYYYYYIIIIYYYYI.",
    ".IYYYYYYYYYYYI..",
    "..IYYYYYYYYYI...",
    "...IIYYYYYII....",
    ".....IIIII......",
    "................",
    "................",
    "................",
  ],
  intelligence: [
    "................",
    "................",
    "....IIIIIIII....",
    "...IYYYYYYYYI...",
    "..IIYYYYYYYYII..",
    "..IPPPPPPPPPPI..",
    "..IPPMMMMMMPPI..",
    "..IPPPPPPPPPPI..",
    "..IPPPPPPPPPPI..",
    "..IPPMMMMMMPPI..",
    "..IPPPPPPPPPPI..",
    "...IYYYYYYYYI...",
    "....IIIIIIII....",
    "................",
    "................",
    "................",
  ],
  prestige: [
    "................",
    ".....II..II.....",
    "....IYYI.IYYI...",
    "...IYYYYYYYYI...",
    "...IYYYYYYYYI...",
    "....IYYYYYYI....",
    ".....IYYYYI.....",
    "......IIII......",
    "......IRRI......",
    ".....IRYYRI.....",
    "....IRYYYYRI....",
    "...IRYYYYYYRI...",
    "....IRYYYYRI....",
    ".....IRYYRI.....",
    "......IRRI......",
    ".......II.......",
  ],
  luck: [
    "................",
    "......II........",
    ".....IYYI.......",
    "....IYYYYI......",
    ".....IYYI...II..",
    "......II...IYYI.",
    "..II......IYYYYI",
    ".IYYI......IYYI.",
    "IYYYYI......II..",
    ".IYYI...II......",
    "..II...IYYI.....",
    ".......IYYYYI...",
    "........IYYI....",
    ".........II.....",
    ".........I......",
    "........II......",
  ],
};

const width = 16;
const height = 16;
const pixel = (name, x, y) => palette[icons[name][y][x]];

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const tag = Buffer.from(type, "ascii");
  const payload = Buffer.concat([tag, data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(payload));
  return Buffer.concat([length, payload, checksum]);
}

function encodePng(w, h, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(rows, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rows)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function raster(name) {
  const rows = icons[name];
  const invalidRows = rows.flatMap((row, index) => row.length === width ? [] : [`${index + 1}:${row.length}`]);
  if (rows.length !== height || invalidRows.length) {
    throw new Error(`${name} must be a ${width}x${height} pixel grid; invalid rows ${invalidRows.join(", ")}`);
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    rgba.set(pixel(name, x, y), (y * width + x) * 4);
  }
  return rgba;
}

function contactSheet(names, scale = 6, gap = 16) {
  const w = names.length * width * scale + (names.length + 1) * gap;
  const h = height * scale + gap * 2;
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) rgba.set(palette.P, i * 4);
  names.forEach((name, index) => {
    const src = raster(name), left = gap + index * (width * scale + gap), top = gap;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const color = src.subarray((y * width + x) * 4, (y * width + x + 1) * 4);
      if (color[3] === 0) continue;
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const d = ((top + y * scale + dy) * w + left + x * scale + dx) * 4;
        rgba.set(color, d);
      }
    }
  });
  return encodePng(w, h, rgba);
}

const names = Object.keys(icons);
for (const name of names) {
  const path = resolve(projectRoot, "public", "art", "stats", `${name}.png`);
  await mkdir(resolve(projectRoot, "public", "art", "stats"), { recursive: true });
  await writeFile(path, encodePng(width, height, raster(name)));
}
const preview = resolve(projectRoot, "tmp", "pixelfx-stat-icons-contact.png");
await mkdir(resolve(projectRoot, "tmp"), { recursive: true });
await writeFile(preview, contactSheet(names));
console.info(`Wrote ${names.length} 16x16 RGBA stat icons and ${preview}`);
