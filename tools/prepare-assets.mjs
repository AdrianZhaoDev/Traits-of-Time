import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { assetFiles, projectRoot, publicRoot } from "./assets.mjs";

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

const licensesRoot = resolve(projectRoot, "licenses");
const licenses = (await readdir(licensesRoot, { withFileTypes: true }))
  .filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
await mkdir(resolve(publicRoot, "licenses"), { recursive: true });
for (const name of licenses) {
  await copyFile(resolve(licensesRoot, name), resolve(publicRoot, "licenses", name));
}

console.info(`已校验 ${assetFiles.length} 个本地素材（${bytes} 字节）并准备 ${licenses.length} 份许可声明。`);
