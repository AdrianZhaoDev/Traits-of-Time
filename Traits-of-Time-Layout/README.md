# 时空词条 · Layout 独立客户端

本目录是独立的 Web / 微信小游戏客户端。界面使用 npm 发布版 **minigame-canvas-engine 1.0.29** 的 XML、Flex 布局与 Canvas 元素；不是 DOM 游戏界面，也不是把 Web 页面套入微信 WebView。视觉参照仓库的 `output/pixelfx/preview.html`。原 Cocos 工程、`Traits-of-Time-V2` 和生产内容均保持独立，不由本工程改写。

## 环境与安装

需要 Node.js **22.22.1 或以上**。本工程锁定 TypeScript 5.9.3、Vite 7.3.1、esbuild 0.28.2；使用提交的 `package-lock.json` 安装：

```bash
# 仓库根目录：为共享引擎提供其原有 ajv 依赖
npm ci

# Layout 独立依赖
cd Traits-of-Time-Layout
npm ci
```

不能把本目录单独拷走后直接构建：它依赖同一仓库里的共享源码、生产数据及现有媒体文件。根目录的 `ajv` 仍从根目录 `node_modules` 解析，不在 Layout 内另设内容校验器或数据副本。

## 开发与 Web 发布

在 `Traits-of-Time-Layout` 目录执行：

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 准备本地媒体后启动 Vite 开发服务器 |
| `npm run build` | 准备媒体并生成 `dist-web/` |
| `npm run preview` | 准备媒体并预览已经生成的 `dist-web/`，需先运行 build |
| `npm run typecheck` | 准备媒体并执行 TypeScript 检查，不生成 JS |
| `npm run build:wechat` | 准备媒体并生成原生 Canvas 小游戏 `dist-wechat/` |
| `npm run prepare:assets` | 仅重建生成目录 `public/`，不编译、不修改素材源 |

Web 入口为 `index.html` / `src/main.ts`。将 `dist-web/` 作为静态站点目录托管；`base: "./"` 支持部署在子目录。请通过 HTTP(S) 访问，不要直接用 `file://` 打开源码或产物。所有图像、音频与特效都是包内相对资源，不依赖媒体 CDN。

## 微信开发者工具导入

1. 运行 `npm run build:wechat`。
2. 在微信开发者工具选择 **小游戏**，导入 **`Traits-of-Time-Layout/dist-wechat`**，不是仓库根目录、`dist-web` 或 V2 目录。
3. 生成的 `project.config.json` 默认使用 `touristappid` 供本地导入；体验、上传及发布前，必须替换为自己的真实小游戏 AppID。每次重新构建都会重新生成该配置，请在新产物中再次设置真实 AppID。
4. 使用支持 `wx.loadSubpackage` 的基础库。工程配置为 3.4.9；正式上线应在目标基础库与真实设备上验证。

产物包含真实 `game.js`、`game.json`、`project.config.json` 和 CommonJS 游戏程序，不包含 WebView。`src/wechat.ts` 只导出 `startWechat()`；主包先安装微信环境缺失时所需的**纯数据 `structuredClone` shim**，再加载分包，最后调用该入口，因此共享引擎不会先于 shim 执行。Web 不安装或覆盖 `structuredClone`。

### 包大小与资源分包

主包只保留启动代码、配置和许可声明；以下四个普通分包通过 `wx.loadSubpackage` 加载成功后才启动游戏：

- `runtime/`：`application.js`，由共享引擎、原始内容导入和 Layout 客户端一起打包。
- `media/art/`：首页图与八件实际使用的原始物品图。
- `media/audio/`：音乐、环境音、提示音三个通道所用的原始 MP3。
- `media/fx/`：四张原始像素特效图集与 `data.json`。

每个分包目录都有小游戏协议要求的 `game.js`。构建会输出主包、各分包及总包的实际字节数；主包及每个生成分包均采用 **4 MiB** 保守上限，总包上限为 **30 MiB**。超限立即报错并删除本次不合格输出，不会把超限目录当作可发布结果。普通分包的微信官方限制可见[分包加载文档](https://developers.weixin.qq.com/minigame/dev/guide/base-ability/subPackage/useSubPackage.html)；本工程对每个分包额外使用同样的 4 MiB 门槛。

## 共享源码与目录约定

`src/` 通过 `../../assets/scripts/...` **直接导入**仓库原实现，包括：

- `application/GameSession`：人生推进与所有待选决策的权威入口。
- `application/NativeContentLoader`：直接导入 `assets/resources/data/ming_end/` 的生产 JSON。
- `presentation/EnumMapper`、`LogParser`：原枚举翻译、原日志解释。
- `presentation/LifetimeRecords`：完成记录与成就的原有汇总逻辑。

不复制这些核心文件，不导入 `cc`，不从 V2 的旧引擎或旧内容副本取数据，也不改写原 ID。珍宝与成就只来自真实生产内容和游戏日志，不增加虚构解锁记录。

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
- `src/renderer.ts`：两棵 Layout 树、顶层输入路由、滚动、长按、键盘及特效合成。
- `src/platform.ts`：Web / 微信主 Canvas、离屏 Canvas、图像工厂、视口、安全区、存储与前后台事件。
- `src/audio.ts`：三通道音量、手势解锁、Web Audio 元素 / 微信 `InnerAudioContext` 适配。
- `src/effects.ts`：原图集逐帧回放，由宿主每帧合成，没有额外动画循环。
- `tools/assets.mjs`、`tools/prepare-assets.mjs`：明确白名单、确定性复制；`public/` 是可删除重建的生成目录。
- `tools/build-wechat.mjs`：原生小游戏打包、分包配置和包大小门槛。
- `licenses/`：引擎 MIT、pixelfx MIT / 原声明及媒体来源说明。

媒体源只读：

```text
../assets/resources/art/ming_end/
../assets/resources/audio/ming_end/
../Traits-of-Time-V2/public/fx/
```

运行时统一调用 `platform.asset("art/..." | "audio/..." | "fx/...")`。Web 对应 Vite 的相对 base；微信对应本地 `media/` 分包路径。准备脚本不复制 `.meta`，不复制 Cocos 场景、事件大图、无关背景或生产数据文件夹。FX 的元数据直接导入原 V2 `public/fx/data.json`，PNG 与同一来源逐字节复制；不克隆 pixelfx、不重新生成或购买素材。

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

## 许可与验证说明

minigame-canvas-engine 的 MIT 全文保存在 `licenses/minigame-canvas-engine.MIT.txt`。既有 pixelfx 素材保留 MIT 和原作者声明。首页 / 身份插画的原绘图源声明 CC0；物品图与 MP3 的来源及原项目权利说明分别记录在 `licenses/media-sources.txt`，不把没有声明为 CC0 的素材擅自改称 CC0。构建会将许可声明一并复制到 Web 与微信产物。

本次执行结果见下节；兼容性烟测不等于微信开发者工具或真机验收。真实 AppID、平台音频恢复、存储配额及分包网络行为仍须在目标基础库和设备上确认。

## 本次验证（2026-11-09）

- `npm run typecheck`、`npm run build`、`npm run build:wechat` 均通过；Vite 仍保留大于 500 kB 的单块提示，没有通过抬高阈值隐藏提示。
- 根目录生产内容校验通过：`ming_end / 0.7.2`，直接使用原内容指纹。
- 控制器烟测完成 3 段人生，覆盖选择、自动检定、事业退出、结束后反复查看报告不重复计数，以及重新创建控制器后读取完成记录。
- Chromium 实际 Canvas 点击、键盘选择、事业退出、音量持久化、拖动长报告与从开局到终局均已操作；长按跨过自动检定后在下一项玩家选择处停止。
- 已检查 320 / 375 / 414 / 768 宽度及 844×390 横屏，无页面横向溢出；浏览器刷新后完成记录与音量仍保留。
- 生成的 CommonJS 微信引导经兼容性宿主烟测，四个本地分包加载、主画布渲染及四类触摸注册成功；这不是微信真机验证。
- 根目录完整测试为 **709 通过、2 失败**。失败均在原 `tests/presentation/opening-flow.spec.ts`：仍用旧节点名 `Btn_穿越` 查找现已改名的 Cocos 按钮。本次没有修改 Cocos 源码或把这两项用例改成新的文案断言。
