# 《穿越了这次我带大喇叭逆袭》 · Layout 独立客户端

本仓库是独立的 Web / 微信小游戏客户端。界面使用 npm 发布版 **minigame-canvas-engine 1.0.29** 的 XML、Flex 布局与 Canvas 元素；不是 DOM 游戏界面，也不是微信 WebView。游戏核心、生产内容、媒体和构建工具均位于当前仓库内，不依赖上级目录、已删除的 Cocos 工程或 V2 工程。

## 环境与安装

需要 Node.js **22.22.1 或以上**。本工程锁定 TypeScript 5.9.3、Vite 7.3.1、esbuild 0.28.2；使用提交的 `package-lock.json` 安装：

```bash
# 在当前仓库根目录执行
npm ci
npm run dev
```

只需安装这一个 `package.json` 的依赖。原游戏内容校验器需要的 `ajv` 已作为本项目运行依赖声明；不需要到上级目录安装依赖，也不需要恢复旧工程目录。

## 开发与 Web 发布

以下命令都在当前仓库根目录执行：

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 校验本地媒体、同步许可证，然后启动 Vite 开发服务器 |
| `npm run build` | 校验媒体并生成 `dist-web/` |
| `npm run preview` | 预览已经生成的 `dist-web/`，需先运行 build |
| `npm run typecheck` | 校验媒体并执行 TypeScript 检查，不生成 JS |
| `npm run build:wechat` | 校验媒体并生成原生 Canvas 小游戏 `dist-wechat/` |
| `npm run prepare:assets` | 校验 `public/` 必需媒体并同步许可证，不删除或重建媒体源 |

Web 入口为 `index.html` / `src/main.ts`。将 `dist-web/` 作为静态站点目录托管；`base: "./"` 支持部署在子目录。请通过 HTTP(S) 访问，不要直接用 `file://` 打开源码或产物。所有图像、音频与特效都是包内相对资源，不依赖媒体 CDN。

## 微信开发者工具导入

1. 运行 `npm run build:wechat`。
2. 在微信开发者工具选择 **小游戏**，导入当前仓库的 **`dist-wechat/`**，不是仓库根目录或 `dist-web/`。
3. 生成的 `project.config.json` 默认使用 `touristappid` 供本地导入；体验、上传及发布前，必须替换为自己的真实小游戏 AppID。每次重新构建都会重新生成该配置，请在新产物中再次设置真实 AppID。
4. 使用支持 `wx.loadSubpackage` 的基础库。工程配置为 3.4.9；正式上线应在目标基础库与真实设备上验证。

产物包含真实 `game.js`、`game.json`、`project.config.json` 和 CommonJS 游戏程序，不包含 WebView。`src/wechat.ts` 只导出 `startWechat()`；主包先安装微信环境缺失时所需的**纯数据 `structuredClone` shim**，再加载分包，最后调用该入口，因此共享引擎不会先于 shim 执行。Web 不安装或覆盖 `structuredClone`。

### 包大小与资源分包

主包只保留启动代码、配置和许可声明；以下四个普通分包通过 `wx.loadSubpackage` 加载成功后才启动游戏：

- `runtime/`：`application.js`，由共享引擎、原始内容导入和 Layout 客户端一起打包。
- `media/art/`：保留的旧首页图与八件实际使用的原始物品图；A 首页品牌图形由程序绘制。
- `media/audio/`：音乐、环境音、提示音三个通道所用的原始 MP3。
- `media/fx/`：四张原始像素特效图集与 `data.json`。

每个分包目录都有小游戏协议要求的 `game.js`。构建会输出主包、各分包及总包的实际字节数；主包及每个生成分包均采用 **4 MiB** 保守上限，总包上限为 **30 MiB**。超限立即报错并删除本次不合格输出，不会把超限目录当作可发布结果。普通分包的微信官方限制可见[分包加载文档](https://developers.weixin.qq.com/minigame/dev/guide/base-ability/subPackage/useSubPackage.html)；本工程对每个分包额外使用同样的 4 MiB 门槛。

## 源码与目录约定

`src/` 使用本项目内的 `./game/...` 模块：

- `src/game/application/GameSession.ts`：人生推进与所有待选决策的权威入口。
- `src/game/application/NativeContentLoader.ts`：直接导入 `assets/resources/data/ming_end/` 的生产 JSON。
- `src/game/core/`：游戏规则、检定、事件、事业、存档数据与内容校验。
- `src/game/presentation/`：保留纯 TypeScript 的枚举翻译、日志解释与完成记录，不含 Cocos 组件。

这些模块来自原游戏的实际运行源码，只调整本地导入路径，不修改内容 ID、玩法数据或内容指纹。当前项目不导入 `cc`，也不在启动或构建时从 Git、旧目录或旧构建包恢复依赖。珍宝与成就仍只来自真实生产内容和游戏日志。

### 玩家功能

- 首页、随机身份揭晓、真实候选家当三选一；严格只提交一件开局家当。
- 纪年与身份 HUD、五维属性、完整折页历史、五槽博古架及持有物详情。
- 重大选择的可用状态、消耗、风险与概率；自动检定和当年剩余事件仍由原 `GameSession` 处理。
- 点击推进一年，按住连续推进；自动检定后继续，遇到玩家选择、终局、后台或取消触摸时停止。
- 事业、现代词条、家当、生涯成就四页管理；选中并确认退出事业，返回后保留未完成的选择。
- 完整终局报告、最高身份、最终属性、事业与成就汇总；返回历程、重启或返回首页。
- 音乐、音效、环境声独立调节和静音；完成记录与音量在本机保留。
- Web 具有同步的无障碍控件、键盘操作与模态焦点约束；原生微信界面不依赖这些 DOM 控件。


本目录的职责划分：

- `src/controller.ts`、`src/presenters.ts`：无 DOM 的会话编排、遮罩栈、真实日志与选择说明。
- `src/view.ts`、`src/ui.ts`：使用 Layout XML / Flex 构建全部屏幕，不复制 HTML 游戏界面。
- `src/home.ts`：A 首页三段标题、四个真实入口与进度警告；缓存绘制简化红色喇叭，不再加载旧夜景或播放轻尘。
- `src/renderer.ts`：两棵 Layout 树、顶层输入路由、滚动、长按、键盘及特效合成。
- `src/platform.ts`：Web / 微信主 Canvas、离屏 Canvas、图像工厂、视口、安全区、存储与前后台事件。
- `src/audio.ts`：三通道音量、手势解锁、Web Audio 元素 / 微信 `InnerAudioContext` 适配。
- `src/effects.ts`：原图集逐帧回放，由宿主每帧合成，没有额外动画循环。
- `tools/assets.mjs`、`tools/prepare-assets.mjs`：必需媒体清单、本地文件校验及许可证同步；`public/` 是必须保留并纳入版本管理的素材源目录，不是可删除的缓存。
- `tools/build-wechat.mjs`：原生小游戏打包、分包配置和包大小门槛。
- `licenses/`：引擎 MIT、pixelfx MIT / 原声明及媒体来源说明。

本地媒体与内容目录：

```text
public/art/                       # 首页与物品图片
public/audio/                     # 音乐、环境声、提示音
public/fx/                        # 原始像素图集及 data.json
assets/resources/data/ming_end/    # 生产剧情与规则 JSON
assets/resources/data/content.schema.json
```

运行时统一调用 `platform.asset("art/..." | "audio/..." | "fx/...")`。Web 直接使用 `public/` 中的本地资源；微信构建将这些资源复制到 `media/` 分包。FX 元数据直接导入本项目的 `public/fx/data.json`。资源预检缺少文件时会报具体本地路径，不会跳过检查、删除媒体、从已删除的工程复制，或用旧 `dist-*` 产物回退。

## 存储边界

**当前这一局人生仅暂存在本次运行的内存中。** 当前属性、待选卡牌 / 选项、未结束流程不承诺跨刷新或进程重启恢复。刷新浏览器、关闭页面、微信进程被回收后，不能继续这局人生；这不是跨次存档功能。

已完成的人生记录经原 `LifetimeRecords` 使用平台存储持久化；音量沿用原键 `time-travel.audio-settings.v1`。Web 使用同源 `localStorage`，微信使用同步平台存储。两端存储不互通；清站点数据、换域名或清小游戏数据会移除相应记录。平台不伪造可写存储：音量写入失败时仅在本次运行生效，并在控制台如实提示。

## 音频与像素动态

- `GameAudio.unlock()` 必须在真实点击 / 按键回调中同步调用。未解锁前不会播放音乐或提示音。
- 复用原 MP3：3 首音乐、3 路地区环境音、11 种提示音。两路循环播放器与 4 个复用提示音声部限制并发；滑块值保存在原 0–1 范围，并在播放器边界采用平方增益。
- 切到后台会暂停循环并停止提示音；返回前台仅恢复当前音乐 / 环境音，不补播过时提示音。微信遵循设备静音开关；文件不可用时保持静音，不生成替代声。
- `PixelEffects.draw(context, width, height, now, active)` 由宿主在基本界面和顶层弹窗之间调用，`now` 使用毫秒时间戳、尺寸使用逻辑 Canvas 单位（标准宽 750），DPR 缩放由宿主负责。
- 烛火位于左下、202 逻辑单位高的底栏上方；金币中心位于逻辑坐标 `(263, 212)` 的家资附近，poof / confetti 位于中央。四张图像只加载一次，逐帧从原图集中裁切，无每帧创建图像或像素缓冲。
- 非活动界面与后台停止推进特效时钟；可用的 `prefers-reduced-motion` 系统偏好会保留静态烛火并关闭一次性动画。

## 已确认的全项目风格：A 爆笑开播

用户已选择 **A「爆笑开播」**，全项目目标以[整体 UI 风格方案](Doc/UI整体风格方案.md)为唯一权威视觉规范，以[动效与微交互制作规范](Doc/动效与微交互制作规范.md)为配套标准。可参考[已选 A 的 HTML 样板](local/outgame-ai/02-style/bright-options/a-comic.html)及既有 [390×844 / DPR 2](local/outgame-ai/02-style/bright-options/previews/a-comic-390x844-dpr2.png)、[360×640 / DPR 3](local/outgame-ai/02-style/bright-options/previews/a-comic-360x640-dpr3.png)截图；这些是 HTML 风格参考，不是 Canvas 或微信真机换肤验收，不再等待方向投票。

A 以暖纸、墨字、番茄红标题 / 品牌与明黄主行动组成明亮市井漫画；主按钮是明黄加墨线与短硬影，不是红色主按钮。中文标题用粗直无衬线，首页完整分为“穿越了 / 这次我带 / 大喇叭逆袭”，保留“带上一件现代物品，去明朝过一生。”与“我要穿越 / 声音 / 成就 / 统计”四个真实入口；“本局进度仅临时保留，关闭或刷新后不能继续。”必须清楚可读。红色喇叭只是品牌识别，不改变真实候选三选一，也不成为固定开局物、奖励或新功能。

本轮按用户“重做全局”的要求，将 A 落到实际客户端：局外页面、四个管理页签、详情、终局，以及人生主界面、HUD、历史、五槽博古架、推进、抉择和阶段检定共享浅纸与墨色 token。技术仍是 TypeScript + minigame-canvas-engine 1.0.29 的 XML / Flex / Canvas，逻辑宽 750，Web / 微信共用；没有另建 DOM 游戏。生产 JSON、内容 ID、概率、成本、命令流程和存储键未改，音乐、地区声与原像素 FX 保持原实现。

`Ui.px()` 以实际 Canvas 可见宽换算字号、间距和触控尺寸；DPR 仅用于位图密度。Web 不再按高度压窄画布，两棵离屏 Layout 画布也按宿主 DPR 采样。短屏优先减少首页图形与留白；长卡牌、声音、管理和详情正文滚动，极矮横屏改用单层整页滚动。管理页签采用两行，选中带勾记；退出事业的代价与操作只出现在事业页。黄色主按钮有短硬影与局部按压反馈，焦点使用即时蓝色轮廓，关闭或切后台取消按压，不增加动画等待或第二个帧循环。

通知与错误内联到当前阅读面，保留 Web 的 live 语义通知，不再浮盖风险或按钮。首页完整保留临时进度警告。原 `public/art/scenes/home.png` 与许可未删除，但已停止作为首页背景；新喇叭是批准 A 样板的本地程序绘制概念图，不是新增高清发布 logo。本轮没有外部生图、上传、音频生成或替换媒体，也不把 38×38 小头像当高清素材。

### 本轮实际验证

- `npm run typecheck`、`npm run build`、`npm run build:wechat` 通过；Web 构建仍提示主 JS 超过 500 kB，未为换肤改动打包架构。最终微信包总计 4,476,610 字节，各分包均在构建门槛内。
- 在 Orca 内置浏览器打开实际开发版 Canvas，走通身份、无默认选择的三选一、选中并提交单件物品、人生推进、重大抉择、四个管理页、完整物品详情、声音、成就、统计与真实终局。验证了必选家当不能用 Esc 绕过、管理返回保留同一待选抉择、原生按住推进遇到抉择停止、松开清除手势、静音端点禁用与减少动态不改变游戏状态。
- 首页检查视口 320×568 / DPR 2、360×640 / DPR 3、375×667 / DPR 2、390×844 / DPR 2、414×896 / DPR 3、768×1024 与 1280×800；桌面 Canvas 最大宽 460。四入口均在可见区域，最小高度约 48 px。局内另检查 320 / 360 宽和 640×360 横屏，声音按钮最小约 44.16 px。正文、风险与长说明可滚动；没有以缩字代替阅读空间。
- 新 UI 实际使用的正文／背景角色组合最低 WCAG 对比度约 4.96:1，焦点／浅底组合最低约 4.34:1。真实自动阶段的待检定快照已被观察到；220ms 自动过渡未获得可用的独立截图，不宣称逐阶段视觉或帧率测量完成。
- 原生 Canvas PNG 证据位于 `local/outgame-ai/03-global-ui/previews/`。Orca 的 DPR>1 页面截图出现分块重复，已报告工具问题；证据改为读取实际 Canvas 位图，未改游戏画面规避截图缺陷。

这些是 Web 开发版验证与两端构建证据，不是微信开发者工具／真机、音频试听、读屏全流程、平台安全区或设备帧率验收。

## 许可与验证说明

minigame-canvas-engine 的 MIT 全文保存在 `licenses/minigame-canvas-engine.MIT.txt`。既有 pixelfx 素材保留 MIT 和原作者声明。首页 / 身份插画的原绘图源声明 CC0；物品图与 MP3 的来源及原项目权利说明分别记录在 `licenses/media-sources.txt`，不把没有声明为 CC0 的素材擅自改称 CC0。构建会将许可声明一并复制到 Web 与微信产物。

本地启动与构建验证不等于微信开发者工具或真机验收。真实 AppID、平台音频恢复、存储配额及分包网络行为仍须在目标基础库和设备上确认。

## 根目录整理说明

旧版本将 Layout 放在子目录内，引用了旧仓库的游戏核心、内容和媒体。将该目录移到根目录后，这些外部引用不再成立；现在改为完整的本地依赖。

只保留启动和游戏运行所需的纯 TypeScript 核心、生产 JSON 及现有本地媒体，不恢复 Cocos 场景、组件、旧 V2 页面或旧项目测试目录。后续复制或检出本仓库时，应一并保留 `src/game/`、`assets/resources/data/` 和 `public/`；`node_modules/` 与 `dist-*` 可以通过安装和构建重新生成。
