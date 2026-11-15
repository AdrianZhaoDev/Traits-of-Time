import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { build } from "esbuild";
import { assetFiles, projectRoot, publicRoot } from "./assets.mjs";

const outputRoot = resolve(projectRoot, process.env.WECHAT_BUILD_OUTPUT?.trim() || "dist-wechat");
const outputRelative = relative(projectRoot, outputRoot);
if (!outputRelative || outputRelative === ".." || outputRelative.startsWith(`..${sep}`) || isAbsolute(outputRelative)) {
  throw new Error("微信构建输出目录必须位于项目根目录内。");
}
const outputLabel = outputRelative.split(sep).join("/");
const privateConfigPath = resolve(outputRoot, "project.private.config.json");
const projectConfigPath = resolve(outputRoot, "project.config.json");
const packageLimit = 4 * 1024 * 1024;
const totalLimit = 30 * 1024 * 1024;
const subpackages = [
  { name: "art", root: "media/art/" },
  { name: "audio", root: "media/audio/" },
  { name: "fx", root: "media/fx/" },
];

async function filesIn(directory) {
  const files = [];
  const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, "en"));
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

let privateConfig = null;
try {
  privateConfig = await readFile(privateConfigPath);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
let existingAppId = null;
try {
  const existingConfig = JSON.parse(await readFile(projectConfigPath, "utf8"));
  if (typeof existingConfig.appid === "string" && existingConfig.appid.trim()) {
    existingAppId = existingConfig.appid.trim();
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
const appid = process.env.WECHAT_MINIGAME_APP_ID?.trim() || existingAppId || "touristappid";

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
try {
  await build({
    absWorkingDir: projectRoot,
    entryPoints: ["src/wechat.ts"],
    outfile: resolve(outputRoot, "runtime/application.js"),
    bundle: true,
    platform: "browser",
    format: "cjs",
    target: "es2020",
    minify: true,
    sourcemap: false,
    legalComments: "eof",
    define: { "import.meta.env.BASE_URL": '"./"', "process.env.NODE_ENV": '"production"' },
    logLevel: "info",
  });
  for (const asset of assetFiles) {
    const destination = resolve(outputRoot, "media", asset);
    await mkdir(dirname(destination), { recursive: true });
    await cp(resolve(publicRoot, asset), destination);
  }
  await cp(resolve(publicRoot, "licenses"), resolve(outputRoot, "licenses"), { recursive: true });

  // Directory subpackages require game.js even when they contain only resources.
  for (const entry of subpackages) {
    const path = resolve(outputRoot, entry.root, "game.js");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `"use strict";\nmodule.exports = { packageName: ${JSON.stringify(entry.name)} };\n`);
  }
  const prelude = await readFile(resolve(projectRoot, "tools/wechat-prelude.cjs"), "utf8");
  const bootstrap = `${prelude}\n
const packageNames = ${JSON.stringify(subpackages.map((entry) => entry.name))};
function reportStartupError(error) {
  wx.hideLoading();
  console.error("小游戏启动失败", error);
  wx.showModal({ title: "加载失败", content: "本地游戏分包未能加载，请关闭后重新进入。开发时请检查控制台。", showCancel: false });
}
if (typeof wx.loadSubpackage !== "function") {
  reportStartupError(new Error("需要支持 wx.loadSubpackage 的微信基础库（2.1.0 或以上）。"));
} else {
  wx.showLoading({ title: "载入时空", mask: true });
  // The mini-game ES2020 runtime does not provide Promise.withResolvers.
  Promise.all(packageNames.map(function(name) {
    return new Promise(function(resolve, reject) {
      wx.loadSubpackage({ name: name, success: resolve, fail: reject });
    });
  })).then(function() {
    wx.hideLoading();
    return require("./runtime/application.js").startWechat();
  }).catch(reportStartupError);
}
`;
  await writeFile(resolve(outputRoot, "game.js"), bootstrap);
  await writeFile(resolve(outputRoot, "game.json"), `${JSON.stringify({ deviceOrientation: "portrait", showStatusBar: false, subpackages }, null, 2)}\n`);
  await writeFile(resolve(outputRoot, "project.config.json"), `${JSON.stringify({
    description: "穿越了这次我带大喇叭逆袭 Layout 原生 Canvas 小游戏",
    projectname: "穿越了这次我带大喇叭逆袭",
    appid,
    compileType: "game",
    miniprogramRoot: "./",
    libVersion: "3.4.9",
    setting: { urlCheck: false, es6: false, enhance: false, minified: false, postcss: false },
  }, null, 2)}\n`);
  if (privateConfig) await writeFile(privateConfigPath, privateConfig);

  const sizes = new Map([["main", 0], ...subpackages.map((entry) => [entry.name, 0])]);
  let total = 0;
  for (const path of await filesIn(outputRoot)) {
    const name = relative(outputRoot, path).split("\\").join("/");
    const owner = subpackages.find((entry) => name.startsWith(entry.root))?.name ?? "main";
    const bytes = (await stat(path)).size;
    sizes.set(owner, sizes.get(owner) + bytes);
    total += bytes;
  }
  for (const [name, bytes] of sizes) {
    console.info(`${name}: ${bytes} bytes / ${packageLimit} bytes`);
    if (bytes > packageLimit) throw new Error(`${name} 包超过 4MiB：${bytes} 字节，拒绝输出超限小游戏。`);
  }
  if (total > totalLimit) throw new Error(`小游戏总包超过 30MiB：${total} 字节。`);
  console.info(`微信小游戏已生成：${outputLabel}（总计 ${total} 字节）。导入该目录；发布前替换 touristappid。`);
} catch (error) {
  await rm(outputRoot, { recursive: true, force: true });
  throw error;
}
