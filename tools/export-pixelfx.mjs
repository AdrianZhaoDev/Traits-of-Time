#!/usr/bin/env node
// The export recipe lives here; asset-manifest.json is generated, not configuration.
// Usage: node tools/export-pixelfx.mjs /absolute/pixelfx/clone
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SOURCE = {
  project: "patch-gg/pixelfx",
  url: "https://github.com/patch-gg/pixelfx",
  commit: "a84159688af3ca37a4be05a0d422b94451b2e24e",
  license: "MIT",
  notice: "licenses/pixelfx.NOTICE.md",
};
const OUTPUT = "assets/resources/pixel/ming_end";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_TEXTURE_SIZE = 2048;
const RENDER_OPTIONS = { bg: "none", margin: 0, actor: false };
const RECIPES = [
  {
    id: "FX_MING_CANDLE",
    source_id: "fire/candle",
    frame_size: [56, 76],
    fps: 20,
    seed: 2,
    options: {},
    use: "环境氛围：深夜书案微光；常驻左下角。",
  },
  {
    id: "FX_COMIC_POOF",
    source_id: "spawn/poof",
    frame_size: [112, 92],
    fps: 15,
    seed: 7,
    options: {
      palette: ["#14161d", "#3b4252", "#eceff4", "#ff0055", "#ffbe0b", "#ffffff"],
    },
    use: "荒诞退场：当场笑死、被卷走、噎死等猝死时的滑稽蓬爆白烟与星星。",
  },
  {
    id: "FX_COLLECT_BURST",
    source_id: "pickups/collect-burst",
    frame_size: [112, 108],
    fps: 20,
    seed: 8,
    options: {
      palette: ["#2d1b00", "#7a4800", "#c27803", "#ffbe0b", "#ffe380", "#ffffff"],
    },
    use: "暴富反馈：触发意外发财、捡漏、大发横财时的爆裂金光星辉。",
  },
  {
    id: "FX_ACHIEVE_CONFETTI",
    source_id: "ui/confetti",
    frame_size: [200, 140],
    fps: 15,
    seed: 9,
    options: {},
    use: "通关/成就：达成【大明第一咸鱼】【阎王都服了】等成就时的漫天彩带彩屑。",
  },
];

function gridFor(frameWidth, frameHeight, count) {
  let best;
  for (let columns = 1; columns <= Math.min(count, Math.floor(MAX_TEXTURE_SIZE / frameWidth)); columns++) {
    const rows = Math.ceil(count / columns);
    const width = columns * frameWidth;
    const height = rows * frameHeight;
    if (height > MAX_TEXTURE_SIZE) continue;
    const area = width * height;
    const skew = Math.abs(width - height);
    // Minimize unused cells, then prefer a square; ties favor landscape.
    if (!best || area < best.area || (area === best.area && skew <= best.skew)) {
      best = { columns, rows, width, height, area, skew };
    }
  }
  if (!best) throw new Error(`${count} frames of ${frameWidth}x${frameHeight} do not fit a ${MAX_TEXTURE_SIZE}px atlas`);
  return best;
}

function packFrames(rendered, frameSize, name) {
  const [w, h] = frameSize;
  const grid = gridFor(w, h, rendered.n);
  const rgba = new Uint8ClampedArray(grid.width * grid.height * 4);
  const pixels = new Uint32Array(rgba.buffer);
  const frames = [];
  for (let index = 0; index < rendered.n; index++) {
    const x = (index % grid.columns) * w;
    const y = Math.floor(index / grid.columns) * h;
    const clear = rendered.frames[index].clear;
    const source = new Uint32Array(clear.buffer, clear.byteOffset, rendered.w * rendered.h);
    for (let row = 0; row < h; row++) {
      const destination = (y + row) * grid.width + x;
      if (w === rendered.w && h === rendered.h) {
        pixels.set(source.subarray(row * w, (row + 1) * w), destination);
      } else {
        const sourceRow = Math.floor(row * rendered.h / h) * rendered.w;
        for (let column = 0; column < w; column++) {
          pixels[destination + column] = source[sourceRow + Math.floor(column * rendered.w / w)];
        }
      }
    }
    // Copy all four clear RGBA bytes unchanged, including translucent edge RGB.
    // Upstream canvas.paste/spriteSheet would multiply RGB by alpha a second time.
    frames.push({
      filename: `${name}_${String(index).padStart(3, "0")}`,
      frame: { x, y, w, h },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w, h },
      sourceSize: { w, h },
      duration: Math.round(1000 / rendered.fps),
    });
  }
  return { grid, rgba, frames };
}

function texturePackerPlist(frames, image, size) {
  const entries = frames.map(({ filename, frame: { x, y, w, h } }) => `    <key>${filename}</key>
    <dict>
      <key>aliases</key><array/>
      <key>spriteSize</key><string>{${w},${h}}</string>
      <key>spriteSourceSize</key><string>{${w},${h}}</string>
      <key>spriteOffset</key><string>{0,0}</string>
      <key>textureRect</key><string>{{${x},${y}},{${w},${h}}}</string>
      <key>textureRotated</key><false/>
    </dict>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>frames</key>
  <dict>
${entries}
  </dict>
  <key>metadata</key>
  <dict>
    <key>format</key><integer>3</integer>
    <key>textureFileName</key><string>${image}</string>
    <key>realTextureFileName</key><string>${image}</string>
    <key>size</key><string>{${size.w},${size.h}}</string>
    <key>pixelFormat</key><string>RGBA8888</string>
    <key>premultiplyAlpha</key><false/>
  </dict>
</dict>
</plist>
`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !isAbsolute(args[0])) {
    throw new Error("Usage: node tools/export-pixelfx.mjs /absolute/pixelfx/clone");
  }
  const clone = args[0];
  const commit = execFileSync("git", ["-C", clone, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (commit !== SOURCE.commit) {
    throw new Error(`Expected pixelfx commit ${SOURCE.commit}, got ${commit}; no assets were written`);
  }
  const { loadEffect, renderFrames } = await import(pathToFileURL(join(clone, "tools/lib/fxlib.mjs")).href);
  const { encodePNG } = await import(pathToFileURL(join(clone, "tools/lib/png.mjs")).href);
  const manifest = {
    source: SOURCE,
    generator: {
      script: "tools/export-pixelfx.mjs",
      command: "node tools/export-pixelfx.mjs /absolute/pixelfx/clone",
      max_texture_size: MAX_TEXTURE_SIZE,
      alpha_mode: "straight",
      packing: "row-major uniform grid; minimum area, then nearest square",
      render_options: RENDER_OPTIONS,
    },
    assets: [],
  };
  let totalPngBytes = 0;
  let totalRgbaBytes = 0;
  let totalFileBytes = 0;
  console.log(`Source: ${SOURCE.url} @ ${commit} (${SOURCE.license})`);
  for (const recipe of RECIPES) {
    const fx = await loadEffect(recipe.source_id);
    // Keep the pinned upstream loop duration and candle's complete default palette.
    const options = { ...fx.meta.options, ...recipe.options };
    delete options.seed;
    const rendered = renderFrames(fx, { ...RENDER_OPTIONS, fps: recipe.fps, seed: recipe.seed, options });
    const name = recipe.source_id.split("/").at(-1);
    const { grid, rgba, frames } = packFrames(rendered, recipe.frame_size, name);
    const size = { w: grid.width, h: grid.height };
    const pivot = fx.meta.origin.map((value, axis) => value * recipe.frame_size[axis] / fx.meta.size[axis]);
    const resampling = recipe.frame_size.every((value, axis) => value === fx.meta.size[axis]) ? "none" : "nearest";
    const metadata = {
      frames,
      meta: {
        app: SOURCE.url,
        version: "1",
        image: `${name}.png`,
        format: "RGBA8888",
        size,
        scale: "1",
        frameTags: [{ name, from: 0, to: rendered.n - 1, direction: "forward" }],
        pixelfx: {
          id: recipe.source_id,
          name: fx.meta.name,
          fps: rendered.fps,
          loop: fx.meta.loop,
          frames: rendered.n,
          frameSize: recipe.frame_size,
          sourceFrameSize: fx.meta.size,
          pivot,
          columns: grid.columns,
          rows: grid.rows,
          duration: fx.meta.duration,
          durationUnit: "seconds",
          seed: recipe.seed,
          options,
          resampling,
          alphaMode: "straight",
        },
      },
    };
    const base = `fx/${recipe.source_id}/${name}`;
    const pngPath = `${base}.png`;
    const jsonPath = `${base}.json`;
    const plistPath = `${base}.plist`;
    const png = encodePNG(grid.width, grid.height, rgba);
    const json = JSON.stringify(metadata, null, 2) + "\n";
    const plist = texturePackerPlist(frames, metadata.meta.image, size);
    mkdirSync(dirname(join(ROOT, OUTPUT, pngPath)), { recursive: true });
    writeFileSync(join(ROOT, OUTPUT, pngPath), png);
    writeFileSync(join(ROOT, OUTPUT, jsonPath), json);
    writeFileSync(join(ROOT, OUTPUT, plistPath), plist);
    manifest.assets.push({
      id: recipe.id,
      source_id: recipe.source_id,
      png: pngPath,
      metadata: jsonPath,
      atlas: plistPath,
      frame_size: recipe.frame_size,
      source_frame_size: fx.meta.size,
      fps: rendered.fps,
      loop: fx.meta.loop,
      frame_count: rendered.n,
      duration_seconds: fx.meta.duration,
      texture_size: [grid.width, grid.height],
      rgba_bytes: rgba.byteLength,
      png_bytes: png.byteLength,
      columns: grid.columns,
      rows: grid.rows,
      pivot,
      seed: recipe.seed,
      options,
      resampling,
      use: recipe.use,
    });
    totalPngBytes += png.byteLength;
    totalRgbaBytes += rgba.byteLength;
    totalFileBytes += png.byteLength + Buffer.byteLength(json) + Buffer.byteLength(plist);
    console.log(`${recipe.id}: ${recipe.frame_size.join("x")} x ${rendered.n} frames @ ${rendered.fps} fps, ${fx.meta.duration}s loop; atlas ${grid.width}x${grid.height} (${grid.columns}x${grid.rows}); PNG ${png.byteLength} bytes; RGBA ${rgba.byteLength} bytes`);
    console.log(`  ${OUTPUT}/${pngPath}\n  ${OUTPUT}/${jsonPath} (${Buffer.byteLength(json)} bytes)\n  ${OUTPUT}/${plistPath} (${Buffer.byteLength(plist)} bytes)`);
  }
  const manifestJson = JSON.stringify(manifest, null, 2) + "\n";
  writeFileSync(join(ROOT, OUTPUT, "asset-manifest.json"), manifestJson);
  totalFileBytes += Buffer.byteLength(manifestJson);
  console.log(`${OUTPUT}/asset-manifest.json (${Buffer.byteLength(manifestJson)} bytes)`);
  console.log(`Total: PNG ${totalPngBytes} bytes; RGBA ${totalRgbaBytes} bytes; generated files ${totalFileBytes} bytes`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
