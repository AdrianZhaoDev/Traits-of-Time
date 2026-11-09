# 时空词条 V2 · HTML 版

本目录是独立的 HTML/CSS/TypeScript 前端版本。页面入口是 index.html，整体视觉与内嵌像素特效素材取自原项目 output/pixelfx/preview.html；开局、属性、事件、选项、检定、事业、成就、统计和结局读取现有游戏核心与 ming_end 内容。V2 不依赖 Cocos Creator，也没有 Three.js 依赖。原 Cocos 项目保留在 Traits-of-Time/，没有被修改或删除。

## 本地运行

在本目录运行 npm ci，然后运行 npm run dev。

生产构建输出到 dist/，运行 npm run build。将 dist/ 作为静态 H5 页面部署即可。

## 微信小程序

此版本按微信普通小程序内嵌 H5 页面设计，使用 DOM、CSS、Canvas 和本地资源。部署 dist/ 到已配置的 HTTPS 网页域名后，由微信小程序 WebView 页面加载该地址。这个 V2 是 H5 页面，不是微信小游戏原生 Canvas 包；WebView 宿主页和后台域名配置需要在微信小程序工程中完成。

页面不从第三方 CDN 加载运行时代码或图片。特效 PNG 和音频均保存在本地。人生进度仅保存在当前页面运行期间；关闭或刷新页面后需重新开局。已完成的人生记录和音量设置保存在本机浏览器存储中。