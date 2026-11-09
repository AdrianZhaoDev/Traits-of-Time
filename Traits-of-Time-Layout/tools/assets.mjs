import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));
export const repositoryRoot = resolve(projectRoot, "..");
export const publicRoot = resolve(projectRoot, "public");

const art = [
  "scenes/home.png",
  ...["antibiotic", "book", "bowl", "calculator", "corn", "flashlight", "glue", "lighter"].map((name) => `items/${name}.png`),
];
const audio = [
  ...["home", "life", "ending"].map((name) => `music/${name}.mp3`),
  ...["shanbei", "capital", "jiangnan"].map((name) => `ambience/${name}.mp3`),
  ...["tap", "reveal", "select", "error", "choice", "gain", "achievement", "ending", "death", "item", "identity"].map((name) => `cues/${name}.mp3`),
];
const fx = ["data.json", "FX_MING_CANDLE.png", "FX_COLLECT_BURST.png", "FX_COMIC_POOF.png", "FX_ACHIEVE_CONFETTI.png"];

// Explicit allowlist: no Cocos .meta, old data copies, event art, or unused scenes.
export const assetFiles = [
  ...art.map((path) => ({ source: `assets/resources/art/ming_end/${path}`, destination: `art/${path}` })),
  ...audio.map((path) => ({ source: `assets/resources/audio/ming_end/${path}`, destination: `audio/${path}` })),
  ...fx.map((path) => ({ source: `Traits-of-Time-V2/public/fx/${path}`, destination: `fx/${path}` })),
].sort((a, b) => a.destination.localeCompare(b.destination, "en"));
