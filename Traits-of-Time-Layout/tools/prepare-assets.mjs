import { access, copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { assetFiles, projectRoot, publicRoot, repositoryRoot } from "./assets.mjs";

try {
  await access(resolve(repositoryRoot, "node_modules/ajv/package.json"));
} catch {
  throw new Error("原引擎需要仓库根目录的 ajv。请先在仓库根目录执行 npm ci；不要在 Layout 内复制引擎或内容。");
}

// Keep existing paths stable: deleting public/ invalidates a running Vite server's
// public-file index on filesystems that cannot report directory recreation.
await mkdir(publicRoot, { recursive: true });
let bytes = 0;
const expected = new Set(assetFiles.map(entry => entry.destination));
for (const entry of assetFiles) {
  const source = resolve(repositoryRoot, entry.source);
  const destination = resolve(publicRoot, entry.destination);
  const information = await stat(source);
  if (!information.isFile()) throw new Error(`素材不是文件：${entry.source}`);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
  bytes += information.size;
}

const licensesRoot = resolve(projectRoot, "licenses");
const licenses = (await readdir(licensesRoot, { withFileTypes: true }))
  .filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
await mkdir(resolve(publicRoot, "licenses"), { recursive: true });
for (const name of licenses) {
  await copyFile(resolve(licensesRoot, name), resolve(publicRoot, "licenses", name));
  expected.add(`licenses/${name}`);
}

async function removeStaleFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await removeStaleFiles(path);
    else if (!expected.has(relative(publicRoot, path).replace(/\\/g, "/"))) await rm(path);
  }
}
await removeStaleFiles(publicRoot);
console.info(`已准备 ${assetFiles.length} 个本地素材（${bytes} 字节）与 ${licenses.length} 份许可声明；未复制引擎或生产数据。`);
