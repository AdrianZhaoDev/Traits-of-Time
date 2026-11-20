import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { assetFiles, publicRoot } from "./asset-manifest.mjs";

let bytes = 0;
for (const asset of assetFiles) {
  const path = resolve(publicRoot, asset);
  const information = await stat(path).catch((error) => {
    if (error.code === "ENOENT") throw new Error(`缺少必需的本地素材：${path}`, { cause: error });
    throw error;
  });
  if (!information.isFile()) throw new Error(`本地素材不是文件：${path}`);
  bytes += information.size;
}

console.info(`已校验 ${assetFiles.length} 个本地素材（${bytes} 字节）。`);
