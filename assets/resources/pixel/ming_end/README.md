# 明末像素氛围素材

来源：[patch-gg/pixelfx](https://github.com/patch-gg/pixelfx)，固定提交 `a84159688af3ca37a4be05a0d422b94451b2e24e`（0.3.0）。这是程序化像素特效库，不是角色、场景原画或物件插画库。

本目录只保留从 pixelfx 生成的透明 RGBA sprite sheet，不复制 Gallery 预览 GIF、Patch Pixel 专有字体或 Patch 品牌图形。素材清单见 `asset-manifest.json`；许可证与第三方声明见 `licenses/`。

| ID | 文件基名（PNG / JSON / plist） | 单帧 | 帧数 / 帧率 / 周期 | 候选用途 |
| --- | --- | --- | --- | --- |
| `FX_MING_CANDLE` | `fx/fire/candle/candle` | 56×76 | 80 / 20 fps / 4s | 案头烛火、小范围氛围 |
| `FX_MING_FOG` | `fx/weather/fog/fog` | 160×90 | 120 / 10 fps / 12s | 背景窄条薄雾，不覆盖正文 |
| `FX_MING_COIN_SPIN` | `fx/pickups/coin-spin/coin-spin` | 56×56 | 32 / 20 fps / 1.6s | 通用金币奖励反馈，不是明代方孔铜钱 |

## 动态摆放预览

项目根目录运行 `node tools/preview-pixelfx.mjs`，然后双击 `output/pixelfx/preview.html`。该文件内嵌真实 PNG、帧数据和许可文本，无需启动服务器或联网，可单独复制给他人查看。

左侧为建议摆放示意（不是 Cocos 实机画面）：烛火在案头左下角，薄雾在正文下方背景留白，金币在财富旁一次性播放。右侧切换三个素材放大查看，支持暂停、深浅底、烛火/薄雾开关和「演示财富增加」。示例不加载游戏引擎、不修改存档或剧情；系统降低动态时默认静帧，页面切后台暂停。

预览已以 `file://` 实际打开，验证素材切换、暂停、开关、金币播完隐藏及 320/375/414/768 宽度布局；浏览器控制台无页面错误。

## Cocos 导入

1. [Cocos Creator 3.8 图集文档](https://docs.cocos.com/creator/3.8/manual/zh/asset/atlas.html) 支持成对的 PNG + cocos2d-x plist。本包使用 TexturePacker format 3；导入后展开 `.plist` 可获得逐帧 `SpriteFrame`，无须手动切图。`.meta` 由编辑器生成，不手填 UUID。
2. 纹理 min/mag filter 均使用 `NEAREST`，关闭 mipmap、保持 RGBA 透明度；使用整数倍缩放，不采用破坏细小像素的有损压缩。本包为 straight alpha，不要预乘第二次；合成使用与 straight alpha 对应的默认透明混合。
3. 帧名为 `candle_000`、`fog_000`、`coin-spin_000` 等，按三位编号递增。`.plist` 只描述帧矩形，不含动画时序；创建 Cocos AnimationClip 时按本表帧率设置循环。JSON 的每帧 duration 单位为毫秒，分别为 50 / 100 / 50。
4. JSON 是 Aseprite 风格元数据，`meta.pixelfx.pivot` 为左上角像素坐标。需要使用该绘制原点时，Cocos 归一化 anchor 为 `(pivotX / width, 1 - pivotY / height)`。不要将素材清单并入 `data/ming_end/manifest.json`，它不是剧情内容包。

## 项目适配与限制

- 雾效改为暖灰水墨色盘，从 320×180 nearest 降至 160×90，以 10 fps 保留完整 12 秒循环。原始 4800×4320 图集解码约 79.10 MiB，现为 1280×1350、约 6.59 MiB。仅适合背景横向区域，不拉伸填满 750×1334 竖屏。
- 烛火保留原配色；金币改用低饱和铜金色。金币仍是星形纹样，不作为历史货币考据素材。
- 三张 PNG 合计 556,406 bytes，RGBA 解码合计 8,675,328 bytes（约 8.27 MiB），不含引擎对象、驱动对齐或平台纹理副本。PNG 压缩体积不等于显存；所有图集边长不超过 2048。
- 像素风与当前水墨文字 UI 并不完全相同；仅作为小范围氛围或奖励候选，不自动替换现有界面。播放应不阻塞阅读/输入，切后台暂停，降低动态时显示静帧；透明度控制沿用 `UIOpacity`。
- 本次没有引入 pixelfx 运行时依赖，没有修改剧情 JSON、Schema 或已有内容 ID；尚未绑定游戏 UI。

## 可复现生成

在项目根目录运行，参数为上游仓库绝对路径。脚本校验固定提交；该 clone 应保持源码未修改。配方在 `tools/export-pixelfx.mjs`，清单和图集都是生成输出，不手工改生成文件。

```sh
git clone https://github.com/patch-gg/pixelfx /tmp/pixelfx-source
git -C /tmp/pixelfx-source checkout a84159688af3ca37a4be05a0d422b94451b2e24e
node tools/export-pixelfx.mjs /tmp/pixelfx-source
```

只使用 Node 内置功能与上游离线渲染工具，不需要 `npm install pixelfx`。直接复制渲染器的 RGBA 像素，避免上游图集 paste 过程再次乘 alpha 导致半透明边缘变暗。

## 授权

[上游 LICENSE](https://github.com/patch-gg/pixelfx/blob/a84159688af3ca37a4be05a0d422b94451b2e24e/LICENSE) 与 [NOTICE](https://github.com/patch-gg/pixelfx/blob/a84159688af3ca37a4be05a0d422b94451b2e24e/NOTICE.md) 允许代码和效果按 MIT 使用、修改和商用，分发时保留本目录 `licenses/` 中的版权及许可文本。Patch Pixel 字体不在 MIT 许可内，本包未包含；也未包含品牌 Logo、灰色角色或草人。

## 已执行验证

- 实际运行导出命令；三套 PNG 解码成功，PNG/JSON/plist 的尺寸、全部帧矩形、数量、循环总时长和来源路径一致。
- Chromium Canvas 以真实 PNG 和 JSON 播放：观察到烛火、雾和金币分别跨过 12 / 4 / 30 次循环；暗底与浅纸底合成检查，透明和半透明通道保留。
- 原生内容校验通过，指纹仍为 `d2dcaf8c827d6520e1a51f0f09f223ec8e76341a31d2d0e6e051de55843c9044`。此前 `npm test` 在 180 秒超时，不能标记全套通过；本次仅素材与离线导出工具变更，未重跑全套。
- 尚未执行 Cocos Creator 编辑器导入、AnimationClip 播放或目标平台真机验证；浏览器素材验证不等同于这些验收。
