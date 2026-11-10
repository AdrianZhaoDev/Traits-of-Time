import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));
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

// Required source assets live in public/ and are never regenerated or removed.
export const assetFiles = [
  ...art.map((path) => `art/${path}`),
  ...audio.map((path) => `audio/${path}`),
  ...fx.map((path) => `fx/${path}`),
].sort((a, b) => a.localeCompare(b, "en"));
