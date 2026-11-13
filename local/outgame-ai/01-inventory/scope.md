# 01｜局外重制只读盘点与素材契约

状态：**全项目风格已批准为 A「爆笑开播」；37 项新媒体仍为 planned，外部服务未授权，未完成新素材的运行接线。** 视觉以 [UI 整体风格方案](../../../Doc/UI整体风格方案.md) 为唯一规范，审批及本地参考见 [风格清单](../02-style/manifest.json)。

本清单定义局外实施范围、真实交互与素材契约。下面的源码与媒体信息是静态盘点，不冒充当前运行验收；风格批准、媒体文件批准、供应商授权与平台验收分别记录。文档修订不改运行代码、生产 JSON、玩法、持久化、现有媒体或许可。

## 1. 工程事实与边界

- TypeScript + **minigame-canvas-engine 1.0.29**，Canvas，750 逻辑宽，Web / 微信小游戏。证据：`package.json:17-25`、`src/renderer.ts:1,35-42`、`src/view.ts:34-40`、`src/ui.ts:102-105`。Web 的宿主、无障碍语义桥和失败提示可以是 DOM；游戏画面不是 DOM 页面，不能套 CSS/DOM/Cocos 组件实现。
- 遵守 `AGENTS.md`、`Doc/文案设计与风格规范.md` 和已批准 A 的 `Doc/UI整体风格方案.md`：自然中文、事实/数值/ID不变、实际阅读宽度、死亡分寸与临时进度提示。全项目目标统一 A；本提示词包的运行改造仍受下列局外／保护层边界约束。
- 重制 **12 个消费表面**：首页、身份、开局家当、本机成就、统计、声音、管理的事业/现代词条/家当/生涯成就、物品详情、终局。另单列启动加载/失败两种**原生兜底**，不是需要生成大图的新页面。
- **保护底层**：人生推演主画面/HUD/历史折页/博古架本体/推进/重大抉择/检定/局内四图集特效、局内音乐和地区声。管理、声音、详情、报告即使叠在 game 上也在重制范围；只改变其自己的视觉层，不能借此换掉下层画面或全局皮肤。
- 不新增商店、登录、商城、云存档、排行榜、领取/装备/出售、重抽、撤销选中、开局或管理里的新详情入口。素材编号是制作任务号，**不是游戏内容 ID**。

### screen 与 overlay 不是同一件事

`AppSnapshot.screen` 只有 `home | identity | game`；`snapshot.overlay` 是私有栈的最后一项，不是独立路由。证据：`src/controller.ts:12-25,43-49,66-78`。

| 分类 | 真实值 / 消费者 | 本阶段处理 |
| --- | --- | --- |
| 目标 screen | home、identity | 新局外视觉的未来消费点；本阶段不改 |
| 保护 screen | game | base Layout、HUD、历史、博古架、推进保持原样 |
| 目标 required overlay | cards（底层仍为 identity） | 三选一/确认语义不变，不能加关闭绕过 |
| 保护 required overlay | decision、stage | 重大抉择/检定视觉、概率及流程不改 |
| 目标普通 overlay | achievements、stats、sound、career、relic、ending | 只改目标层；career 的四页是同一 overlay 内 tab |
| 原生兜底 | startup.loading、startup.failure | 不需要新媒体、不依赖大图/音频；保留宿主行为 |

## 2. 真实开局、栈与确认/返回契约

1. 首页 `startLife -> controller.start()`：若 busy 则忽略；`resetLife()` 清掉当前内存人生与 overlay，busy=true，异步 initialize。不是恢复旧人生。初始化结果不成功/不是 card 候选时留在首页并发真实失败提示，不制造候选。`src/controller.ts:87-128,273-288`。
2. initialize 成功后，**先** `screen=identity`、`view=result.state`；此时引擎已经 pending card，但 `cardsRevealed=false`，所以还没有 cards overlay。`src/controller.ts:109-120,297-303`。
3. 身份页点击“挑选本局家当”才 `revealCards()`：置 revealed、清 selectedCardId、同步 cards required overlay，screen仍为 identity。`src/controller.ts:130-136`、`src/view.ts:216-218`。
4. 卡片点击只 `selectCard(id)`；同卡仍保持选中，换卡覆盖原 ID，**没有取消选中**、没有详情点击或重抽。确认按钮在 busy/未选时禁用。`src/controller.ts:138-155`、`src/view.ts:323-337,68-70`。
5. 确认成功提交既有 `selectCard` 命令后才 `screen=game`；清 revealed/selection，随后完成当前年份的自动阶段。不能为播动画延迟提交、改概率或新增等待。`src/controller.ts:157-165,373-394`。

忙碌不等于全局封锁：首页三个辅助入口当前未绑定 busy，普通 `open()` 也没有通用 busy 守卫。初始化期间打开的普通面板可继续位于身份页上方；身份揭晓反馈必须等真实可见，不能因重制擅自清栈。`src/view.ts:179-185`、`src/controller.ts:115-120,221-229,297-303`。

栈规则与返回：

- `pushOverlay`：不存在则 push；已经存在则截掉它以上的层，不复制同名层。`syncRequiredOverlay` 先移除旧 required 层，再把当前 required 层放栈底，普通管理/设置可位于上面。`src/controller.ts:290-303`。
- `close()` 对 cards/decision/stage 只通知必须完成，不 pop；普通 overlay 只 pop 一层，relic 不再在栈内时清 relicId。普通面板外部遮罩不是通用关闭按钮，**只有 relic 有既有外部关闭 action**。`src/controller.ts:231-241`、`src/view.ts:158-167,461-464`。
- 从重大抉择打开 career，返回必须仍回原抉择，不能推进年份或消除 pending。`src/view.ts:97-98`、`src/controller.ts:297-303`。
- 事业选中 active 实例后，“确认退出选中事业”直接调用 abandon；现有代码**没有额外二次确认对话框**。成功移除 career，可能继续当前年自动阶段。按钮的禁用条件不完全等同 controller 的 READY/AWAITING_OPTION 守卫，不凭美术宣称一切状态可退出。`src/view.ts:117-122,351-364`、`src/controller.ts:212-218`。
- 首次 ENDED 记录 report，并把 ending 放在栈底，清掉过时 career；更高设置等普通层可保留。回看报告不重复记完成次数。返回历程仅 close，**状态仍 ENDED**；返回首页清当前人生；重启调用 start 创建新人生。`src/controller.ts:330-350`、`src/view.ts:123-131`。
- 物品详情唯一已接 UI 入口是博古架 `relic_<index>`。controller 允许检查候选 ID 只是允许条件，不是开局已有详情入口。管理现代/家当页也只是静态文字 entry。`src/view.ts:265-271,367-372,453-464`、`src/controller.ts:254-260`。
- 管理标签属于 `GameViewBuilder` 的显示状态：gameCareer 入口重置到事业页并清选择，decisionCareer 只打开面板；切任意标签都会清 selectedCareer，点击当前标签也会清除事业选择。关闭面板本身不重置标签，不为新切换声改变该行为。`src/view.ts:24,97-98,284-286,343-348`。

### 不变的持久化

当前人生的 SessionSave slot 是 start 内闭包，只有内存暂存；刷新/离开/返回首页会丢失。仅已完成人生与音量走平台存储。记录键 `time-travel.lifetime-records.v1`，音量键 `time-travel.audio-settings.v1`；不新建云档、迁移键或“继续人生”承诺。记录读失败不覆盖原档，写失败仅当前页面保留，并展示 warning；管理成就并集与本机完成人生成就不是同一个集合。证据：`src/controller.ts:28,94-101,339-344`、`src/game/presentation/LifetimeRecords.ts:13-60`、`src/audio.ts:12,211-238,261-275`。

## 3. 全页面状态矩阵

这是**静态实现盘点及后续显示契约**，不是实机验证记录。N/A/未实现不伪装成已有状态，也不为填表新增功能。长文本必须完整可读，不用裁切、烘焙文本或缩小字号逃避；当前风险单列。

### 内容与长度

| 页面 / 层级 | 正常 | 空内容 | 长文本 | 长列表 |
| --- | --- | --- | --- | --- |
| home / screen | 标题、我要穿越、声音/成就/统计、临时进度提示 | 无业务空列表；旧首页图缺失不能成为控件可用性的依赖 | 标题、说明和提示均为代码文字；homeScroll可滚动 | 固定三个辅助入口，不制造无限列表 |
| identity / screen | 明朝、年份、年龄、身份、地区/门第；挑选本局家当 | player缺失时当前返回空字符串，无独立空状态 | 身份/地区/门第名称、两段说明按实际宽度换行；identityScroll | 年份/年龄/身份固定三项，不新增身份列表 |
| cards / required_overlay | 真实pending.cards三选一；未选时确认禁用；提交成功才进入game | pending非card或候选定义缺失时当前可为空；start的非card结果已有失败notice；不合成补位卡 | 名称、稀有度、description、检定加成；panel_cards纵向滚动 | 只呈现真实候选，三选一不变，不新增候选/抽卡/分页 |
| achievements / overlay | 仅records中的已完成人生本机成就；跳过未知定义ID | records.achievements.size=0显示还没有解锁成就；不造锁定/奖励条目 | name/meta/text及读取或写入warning保留；panel_achievements | 完整已获集合滚动；不逐条播解锁声 |
| stats / overlay | 完成次数、最长寿命、累计经历、已获成就；只统计已完成人生 | completed=0仍显示四项零值；没有独立空统计页面 | 本机范围说明、存储warning、数值不烘焙入图；panel_stats | 固定四行，不新增历史人生详情或榜单 |
| sound / overlay | music/effects/ambience三路滑块、加减、单路及全部静音 | 无业务空内容；设置读取抛错时沿用现有默认并仅在控制台警告，当前面板无保存失败提示行 | 说明及键盘提示换行；panel_sound | 固定三路，不新增总线/音色/设备菜单 |
| career.careers / overlay_tab | 四标签；active/completed/interrupted事业、进展/下次年份/commitment及退出不退费说明 | player.chains.length=0显示暂无事业记录；未知definition跳过 | name/commitment按宽度换行；panel_career | 所有实际chains滚动，非active为静态记录 |
| career.modern / overlay_tab | 只列实际持有且ID以CARD_MODERN_开头的卡；当前文字entry，无图无详情点击 | 尚无现代词条 | 名称/稀有度/description完整换行；panel_career | 实际持有集合滚动，不新增图鉴/商店 |
| career.relics / overlay_tab | 实际持有且ID不以CARD_MODERN_开头的家当；当前文字entry，无图无详情点击 | 尚未获得家当 | 名称/稀有度/description完整换行；panel_career | 真实持有集合滚动 |
| career.achievements / overlay_tab | records、player.achievements、ending.achievements及primary_achievement_id的并集；不同于首页本机成就页 | 并集size=0显示本局还没有成就；未知definition跳过 | name/meta/text换行；panel_career | 完整并集滚动；不是仅本局或仅已完成人生 |
| relic / overlay | name/rarity/description/check_bonus或本局随身家当、收起详情、外部关闭区；当前无图片 | relicId为空或未知card时当前输出空overlay；不造替代物 | 当前宽402、外框450、top=safeTop+290且无scroll；长文有越界风险，后续目标须完整可读 | 单物品详情，无列表，不新增翻页 |
| ending / overlay | 年份年龄、死因、享寿/家资/成就、主成就、最高身份、五属性、事业、次成就与随身家当 | 无report则body空；无death定义显示人生终点通用文案，无primary显示普通人生；空集合不造记录 | 完整死因/成就/家当说明；panel_ending；主成就不在次成就重复 | 完整事业、成就和家当滚动；不虚构分页/分享功能 |
| startup.loading / native_fallback | 微信showLoading加载分包；Web无独立生成图加载屏 | 无媒体依赖 | 原生宿主文字，不烘焙为图片 | 不适用 |
| startup.failure / native_fallback | Web startup-status文本或noscript；微信hideLoading后showModal | 图/音加载失败不能妨碍此文本兜底 | 原生文本完整错误说明，不依赖新图 | 不适用 |

### 交互与返回

| 页面 | 忙碌 / 禁用 | 选中 | 键盘焦点 | 返回路径 |
| --- | --- | --- | --- | --- |
| home | start期间显示正在揭晓身份；startLife禁用，三个辅助入口未统一禁用；startLife由snapshot.busy禁用 | 无业务选中态 | Web语义按钮；切换screen没有首控件自动聚焦；Canvas有焦点时Enter/空格调用首个可用action | 首页无更上一层；Esc只调用close，当前无overlay时不退出或清档 |
| identity | start尾部busy为true时揭家当按钮禁用；revealCards由busy禁用，controller另守卫screen/pending/cardsRevealed | 无业务选中态 | Web主要按钮有语义控件，但切换到identity不自动聚焦；Canvas有焦点时Enter/空格可调用该可用按钮 | 未提供返回首页按钮；无overlay的Esc不跳页，不新增重抽/返回功能 |
| cards | 候选与确认由busy禁用，确认文案正在启程；busy或未选禁用确认；禁用按钮不新增失败点击 | selectedCardId；点击同卡仍选中，换卡覆盖，无撤销选中 | 可用候选及确认；Web aria-pressed来自cardOffer | 无关闭按钮；Esc/close只给请先选定提示，不能绕过选卡；仅confirmCard成功迁移game |
| achievements | 无专属busy加载态；header返回随busy禁用，footer返回未绑定busy；列表为静态entry，不是可点击奖励 | 无列表选择态 | 当前可聚焦返回按钮；静态成就不是伪按钮 | close弹出一层回原screen/overlay；不清记录/人生 |
| stats | 无专属busy态；header返回随busy禁用，footer未绑定busy；无业务禁用行 | 无业务选中态 | 返回按钮焦点；统计行静态 | close回上一层；不写入当前未完成进度 |
| sound | 无独立加载态；音量即时设置，header返回随busy禁用，footer未绑定busy；value<=0减小禁用；value>=1增大禁用 | 0显示恢复，>0显示静音；全部静音按钮反映三路值；不是新增持久化字段 | Web range键盘/Tab/方向键、按钮；Canvas range action的空invoke不等于键盘调音量 | 返回仅close；修改已即时保存，无应用/确认/取消回滚；game底层音乐/环境继续 |
| career.careers | active选择、abandon、closeCareer及header返回由busy禁用；tab按钮当前未绑定busy；无active选中时abandon禁用；controller仅READY/AWAITING_OPTION接受abandon，UI并非完整复制该守卫 | selectedCareer为active instance_id；切tab清空；确认退出成功才移除career overlay | 四tab、可用active条目、退出与返回；Web active条目aria-pressed | 返回pop，可能回decision或game；确认退出直接abandon，没有额外二次确认对话框 |
| career.modern | tabs未统一busy禁用，退出按钮此页一直不可用，返回遵原守卫；abandon按钮禁用，不把物品行做成新的可执行操作 | 仅tab强调；无物品行选择；切tab清空selectedCareer | tab和返回等既有按钮；静态物品条目不新增Tab节点 | close或切现有tab；不丢持有物，不新增详情入口 |
| career.relics | 同career.modern，无独立加载态；abandon按钮禁用 | 仅tab强调，无行选择 | tab及既有返回等按钮 | close或切现有tab；不新增出售/装备/丢弃 |
| career.achievements | 同其他career tabs，无独立加载态；abandon按钮禁用 | 仅tab强调，无成就行选择 | tab及既有返回等按钮；不逐条聚焦装饰 | close可回decision/game；切tab不改成就或本机记录 |
| relic | 无专属busy态；详情关闭控件未绑定busy；没有业务禁用状态；无效ID由controller拒绝 | 由relicId决定展示对象，不改变持有或selectedCardId | Web先有dismissRelic外部关闭action再closeRelic；焦点不能落到下层博古架 | 收起/外部区域/Esc pop一层；relicId在栈中已无relic时清空；主画面与博古架本体不改 |
| ending | 重启和header返回随busy禁用；reviewLife/homeEnding未统一绑定busy，home有controller守卫；重启由busy禁用；open ending无报告会notice | 无业务行选择态 | 重启/返回历程/返回首页和header返回等已有action | 返回历程仅pop，保留ENDED状态；返回首页清当前人生；重启start创建新人生；重开报告不重复计完成次数 |
| startup.loading | 原生加载中；不增加伪重试/确认控件 | 不适用 | 微信原生宿主控制；Web无新增加载焦点 | 按现有加载完成hideLoading；不新增导航 |
| startup.failure | 失败不是正在加载，不造无限busy动画；不增加商店/登录/联网修复操作 | 不适用 | Web role=alert/noscript；微信宿主原生弹窗 | 保留原提示的既有确认/关闭含义，不新造重试/清档 |

### 共享输入/动画的边界

- 两个真实 Layout 分别承载 base/overlay；绘制 base → 局内 FX → overlay → 焦点/通知。输入/命中/滚轮/语义控件只交当前顶层，命中跳过 disabled 和滚动裁剪外部。`src/renderer.ts:179-206,247-258,277-330,377-384,432-441`。
- `Ui.control` 的 disabled 通常 opacity=0.45；`pressed` 是可选业务状态，不是所有按钮都选中。busy只由具体view/controller守卫，不是全局遮罩；**不要宣称所有按钮 busy 都被禁用**。`src/ui.ts:17-25,81-99`。
- Web 有语义按钮/range、overlay内Tab循环、焦点滚入视区及Canvas青色焦点框。**只有切入/返回到有overlay的层时**自动聚焦首个可用控件；切换home/identity等base screen不自动聚焦首控件，关闭全部overlay也没有专门恢复到打开者的逻辑。Esc只close，Canvas有焦点时Enter/空格调用首个可用action，方向/Page键滚第一个scroll；range方向键依赖Web原生input。微信没有这套DOM语义桥代码，不能称真机键盘焦点已验。`src/renderer.ts:396-500`。
- 已有按下换背景、180ms overlay淡入、200ms局内属性脉冲、按住推进350ms后每220ms推进；这些共享逻辑/局内脉冲和快进不做全局重皮。当前没有通用hover媒体、独立loading动画或通用错误贴图。`src/renderer.ts:131-143,231-254,347-392`。
- 后续局外动画仅改变显示，不更改命令时间、输入区域、返回与确认语义。关闭/切页/重复触发/销毁取消过时动画与回调；后台不追赶；减少动态使用静态最终态。08里的时长是未来调校目标，不能写成当前已实现。
- 几何基线：逻辑高为 `round(750 × viewport.height / viewport.width)`，安全区按同一比例换算；Web取实际Canvas矩形且平台安全区返回0，宿主CSS另有safe-area padding；微信取窗口safeArea。不要把浏览器窗口宽、Canvas实际宽、750逻辑宽混成同一尺度。`src/renderer.ts:164-175`、`src/platform.ts:53-65,136-144`、`src/web.css:10-16`。
- 普通面板外宽702、内宽650，高度上限1120，正文独立滚动且页头页脚在滚动区外；这也承载受保护的decision/stage，所以新底纹、框和转场只能给目标overlay显式应用，不能全局改共享panel模板。`src/view.ts:48-54,158-167`。

## 4. 文件存在、代码引用、文档宣称分别记录

### 实物基线

| 类别 | 已列出文件 | 代码引用 / 条件 | 本地文件头事实 |
| --- | --- | --- | --- |
| 首页背景 | `public/art/scenes/home.png` | `src/view.ts:170-172` home | 900×1440，RGB；当前绘为750×可用高度，不是等比cover |
| 八共用物品 | `public/art/items/{corn,antibiotic,flashlight,calculator,book,glue,lighter,bowl}.png` | `src/view.ts:11-15,267,332`，实际候选/持有时才请求 | 全为512×512 RGBA；RGBA头不代表有效透明像素已验 |
| 三音乐 | `public/audio/music/{home,life,ending}.mp3` | `src/renderer.ts:145-147,159-160` 状态选曲 | 22.05kHz、单声道、64kbps MP3 |
| 三地区环境 | `public/audio/ambience/{shanbei,capital,jiangnan}.mp3` | game未结束且地区命中映射，overlay不改路由 | 同上；未解码/测时长/试听 |
| 十一cue | `public/audio/cues/{tap,reveal,select,error,choice,gain,achievement,ending,death,item,identity}.mp3` | 下表区分7种有调用、4种未发现调用 | 同上；不等于11种都已触发 |
| 四图集 | `public/fx/FX_MING_CANDLE.png`、`FX_COLLECT_BURST.png`、`FX_COMIC_POOF.png`、`FX_ACHIEVE_CONFETTI.png` | `src/effects.ts` + renderer日志条件 | 560×608、448×756、560×460、800×1820 RGBA |
| 图集元数据 | `public/fx/data.json` | 模块导入/按旧ID查配置 | 不是第五张图或新外部素材 |
| 随包许可 | `public/licenses/` 四份txt | prepare复制源licenses直接文件；微信另复制licenses | 存在不等于历史源/全部权利已独立核验 |

共30个媒体文件，加1个元数据，匹配 `tools/assets.mjs:7-23` 的31文件显式清单；许可另列。`public/art/identity/` 与 `public/art/people/` 当前为空，不能因旧来源文档写过就声称有身份/人物图。三个 `public/*/outgame/` 目录在盘点时未观察到，本阶段不创建它们或生成媒体。

| 旧cue文件名 | 存在 | src调用条件 | 共享 / 不代表什么 |
| --- | --- | --- | --- |
| tap.mp3 | 是 | 所有非disabled的renderer.invoke先unlock再playCue(tap)然后action.invoke | 局内与局外所有普通action；range连续拖动直接setVolume不经invoke |
| reveal.mp3 | 是 | event日志 | 局内事件日志 |
| select.mp3 | 是 | 未发现playCue调用（仅类型、增益、路径模板和必需清单） | 不称已触发；与同名音乐不是同一资源 |
| error.mp3 | 是 | 未发现playCue调用（仅类型、增益、路径模板和必需清单） | 不称已触发；与同名音乐不是同一资源 |
| choice.mp3 | 是 | option日志 | 局内选择日志 |
| gain.mp3 | 是 | effects日志存在attribute_add/wealth且amount>0 | 局内正家资日志 |
| achievement.mp3 | 是 | achievement日志 | 局内解锁日志，与打开旧成就页无关 |
| ending.mp3 | 是 | 未发现playCue调用（仅类型、增益、路径模板和必需清单） | 不称已触发；与同名音乐不是同一资源 |
| death.mp3 | 是 | death日志 | 局内死亡日志 |
| item.mp3 | 是 | card_selected日志 | 原选卡提交日志；不可被局外音效原位替换 |
| identity.mp3 | 是 | 未发现playCue调用（仅类型、增益、路径模板和必需清单） | 不称已触发；与同名音乐不是同一资源 |

### 文档的宣称不自动变成事实

- `licenses/media-sources.txt:9-13` 声称四图集从旧V2原样复制，并保留pixelfx MIT/NOTICE；本次未独立核历史原件逐字节一致，不删现有NOTICE。
- `licenses/media-sources.txt:15-22` 声称首页、三身份、三人物及绘制源CC0；实际public只有首页。声明中的历史相对路径和绘制源未独立核验，CC0是文档转述，不是本次外部权利审查结果。
- `licenses/media-sources.txt:24-28` 声称八物品为项目代码绘制，**没有**统称它们CC0；`:30-37` 声称17音频原创算法合成。旧生成器/provenance未独立核实；不能由文件存在推导已获新生成/上传授权。
- `README.md:30,89-116` 的媒体/发布说明只作声明；其中`:108`写11种提示音，实物是11个文件，静态代码只发现7种调用，不能转述为11种都已触发。打包规则以当前tools/platform为据，不用旧dist存在证明未来新资源已入包。四份 `licenses/*.txt` 与 `public/licenses/` 同名副本的SHA-256本次逐份相同；这只证明副本一致，不核准旧来源或商用权。
- 08正文已经声明“36素材任务+1分层工序，未生成/未审批”。本清单沿用其37个父编号；UI批次内部是variant，不发明新的游戏内容ID或暗算调用次数。

## 5. 共享保护规则：可逐项对应代码

| 不可原位替换/全局重皮 | 实际共享消费者 / 原路由 | 新局外资源的安全边界 |
| --- | --- | --- |
| `public/art/items/*.png` | cardOffer 54×54；game博古架46×46，`src/view.ts:264-271,323-337` | 新图只在cards/既有relic详情用 `art/outgame`；博古架继续旧图；管理列表不凭图新增点击 |
| `public/audio/cues/tap.mp3` | `renderer.invoke` 所有非disabled action，`src/renderer.ts:265-268` | 新UI cue只按目标控件/上下文分流，不覆盖tap或全局修改局内invoke反馈 |
| `public/audio/music/life.mp3` | identity、cards、未结束game和其上overlay | MUS-02只能局外准备阶段新接；进入game恢复原life，不覆盖文件 |
| `public/audio/music/ending.mp3` | 非home且status=ENDED；报告关闭后的历程仍用它 | MUS-03只报告上下文，回历程恢复原ending；不能直接把ENDED全换新曲 |
| 地区环境三MP3 | game未结束 + region；管理/设置/详情不改变 | AMB-01仅home/准备；game面板沿用下层地区声，不替换地区文件 |
| 四旧图集与 `data.json` | game烛火循环；正家资gold、death poof、achievement confetti日志 | 新FX命名空间独立；不改ID/元数据/日志、烛火或死亡成就表现 |
| `ink/fonts/Ui.control/Ui.button` | home到game/decision/stage全共享，`src/ui.ts:1-14,81-107` | 未来新皮肤仅目标view/overlay显式使用，不能改全局token/按钮让保护面随之变化 |
| `game()/fold()` 与推进输入 | `src/view.ts:223-321`、renderer长按/快进 | 管理/设置/详情只改自身层；入口本体、底层Canvas、HUD、历史/博古架不改 |

### 原音频/FX生命周期（现状，不是新能力）

- 原选曲：home → home；非home且未ENDED → life；非home且ENDED → ending。普通overlay不触发切歌。identity/cards没有地区环境；game未结束才按 `R_SHANBEI/R_CAPITAL/R_JIANGNAN` 选地区声。`src/renderer.ts:145-147`、`src/audio.ts:14-18,184-196`。
- 一个音乐voice、一个环境voice、四个轮转短音voice，**没有现成双播放器交叉淡变**；同源不重设，换源先stop。真实手势才解锁，前台且对应音量>0才播放；播放器边界平方增益。后台暂停循环/停止短音，恢复只恢复当前循环；失效文件警告后静音、无蜂鸣替代，销毁释放。微信服从系统静音开关。`src/audio.ts:43-130,155-170,177-258`。
- 声音设置即时修改原music/effects/ambience三通道，单路/全部静音恢复最近非零值；连续range拖动直接setVolume，不经invoke连续播tap；加减/静音按钮仍普通action。不新增保存/应用/取消回滚语义。`src/view.ts:426-449`、`src/audio.ts:211-238`。
- 四图集配置声明：烛火20fps/80帧/4s循环；金币20fps/28帧/1.35s；死亡15fps/25帧/1.6s；成就15fps/52帧/3.4s。数字来自 `public/fx/data.json` 配置，非实测。重复同层重置elapsed；后台/非game不推进但不清旧一次性效果；减少动态固定烛火首帧且不播一次性。`src/effects.ts:39-94`。不能借局外取消规范偷偷改变这些局内现状。

## 6. 新素材契约：页面—资源—触发—结束—共享消费者

所有下表均为**未来计划**。`manifest.json.assets` 对每个父ID保存要求字段、消费位置、目标规格、触发/取消/共享/保护、授权、审批与状态；完整实际文件清单在 `baseline`，不混作已生成的新资产。

### 背景

| ID | 消费位置 / 触发 | 结束 / 隔离边界 |
| --- | --- | --- |
| IMG-BG-01 | home；src/view.ts:170-191；home可见且未被其他上下文替代 | 替换首页自己的旧底景；保留代码文字、入口与临时进度提示；离开目标screen或overlay后不再绘制，不能替换下层game |
| IMG-BG-02 | identity；src/view.ts:194-220；identity可见且cards尚未覆盖 | 身份中性场景，不预设随机身份/人物/阶层；离开目标screen或overlay后不再绘制，不能替换下层game |
| IMG-BG-03 | cards；src/view.ts:57-70,158-167；顶层cards可见 | required overlay自身的低对比背景，不把cards改成新screen；离开目标screen或overlay后不再绘制，不能替换下层game |
| IMG-BG-04 | achievements、stats、sound、career.careers、career.modern、career.relics、career.achievements；src/view.ts:114-122,132-167,340-382,426-450；目标档案/管理/声音overlay可见 | 只在目标overlay内裁切的共用底景/材质；sound不另造全屏背景；game下层不变；离开目标screen或overlay后不再绘制，不能替换下层game |
| IMG-BG-05 | ending；src/view.ts:123-131,158-167,385-423；ending报告可见且有真实report | 报告overlay自己的中性底景；不按死因/评价预画结果，不覆盖game底图；离开目标screen或overlay后不再绘制，不能替换下层game |

### 物品（每项独立文件）

| 素材编号（非游戏内容ID） | 现有内容绑定 | 旧共享图（实物） | 计划局外用途 |
| --- | --- | --- | --- |
| IMG-ITEM-01 | CARD_MODERN_CORN / 高产耐旱玉米良种 | public/art/items/corn.png | cards.cardOffer + 既有relic详情；新图不进入game博古架 |
| IMG-ITEM-02 | CARD_MODERN_ANTIBIOTIC / 抗生素与防疫手册 | public/art/items/antibiotic.png | cards.cardOffer + 既有relic详情；新图不进入game博古架 |
| IMG-ITEM-03 | CARD_MODERN_FLASHLIGHT / 手摇发电强光手电 | public/art/items/flashlight.png | cards.cardOffer + 既有relic详情；新图不进入game博古架 |
| IMG-ITEM-04 | CARD_MODERN_CALCULATOR / 太阳能简易计算器 | public/art/items/calculator.png | cards.cardOffer + 既有relic详情；新图不进入game博古架 |
| IMG-ITEM-05 | CARD_NATIVE_BOOK / 旧蒙书与小杆秤 | public/art/items/book.png | cards.cardOffer + 既有relic详情；新图不进入game博古架 |
| IMG-ITEM-06 | CARD_MODERN_GLUE / 502强力胶与折叠军刀 | public/art/items/glue.png | cards.cardOffer + 既有relic详情；新图不进入game博古架 |
| IMG-ITEM-07 | CARD_MODERN_LIGHTER / 防风打火机与醒脑油 | public/art/items/lighter.png | cards.cardOffer + 既有relic详情；新图不进入game博古架 |
| IMG-ITEM-08 | CARD_NATIVE_BOWL / 粗陶乞食破碗 | public/art/items/bowl.png | cards.cardOffer + 既有relic详情；新图不进入game博古架 |

共同触发：只有实际候选/现有relicId命中该既有ID才显示。离开cards、关闭详情、换详情ID即移除相应展示；进入game不继续使用新图。所有物品目标768×768真实alpha，略俯视三分之四、左上柔光、主体70%—80%；不烘焙名称/数字/稀有度/能力。目前cardOffer有图但relic无图无scroll，后续详情新增图位仍在原overlay内，不增加入口或玩法。当前管理现代/家当仍文字列表，本契约不要求新增物品图消费者。

### 可选UI与分层

| ID | 消费 / 触发 | 结束 / 共享边界 |
| --- | --- | --- |
| IMG-UI-01 | src/view.ts:158-167,453-464：仅目标panel与relic面板的可选纸纹，不改共享Ui/ink；目标面板可见且该增强获批准 | panel关闭/销毁移除；不改变命中/布局或game的panel颜色 |
| IMG-UI-02 | src/view.ts:323-337：cardOffer可选装饰框，实际选中、焦点、disabled仍代码绘制；cards中真实候选卡可见且增强获批准 | 关闭cards/进入game移除；快速换选不留旧动画 |
| IMG-UI-03 | src/view.ts:132-151,374-380,385-423：成就或报告可选无字装饰；非局内解锁特效；对应目标页可见且增强获批准 | 关闭/切tab/返回时移除；不逐条模拟解锁 |
| IMG-UI-04 | src/view.ts:183-185,114-155,159-161,343-348,435-447,461-464：仅已存在的局外入口、目标面板内部、返回关闭控件可选装饰；对应既有控件可见且该图标增强批准 | 控件所在目标页关闭/销毁移除；不拦截输入或改Tab顺序 |
| IMG-UI-05 | src/view.ts:132-151,366-380：各真实空集合/零统计处可选插画；不新增锁定、奖励、失败或重试功能；上述各子图对应的真实空判定成立且增强批准 | 集合变为非空、切tab或关闭时移除；不伪造数据 |
| IMG-LAYER-01 | src/view.ts:170-220,158-167：只应用于后续选中的既有目标背景消费位置，不另开screen或动画层宿主；已批准背景确有局外视差需求，且分层工序被授权 | 减少动态或分层失败使用批准静态合成图；离开页面/后台暂停，不动game背景 |

IMG-UI-04的6个variant：achievements、statistics、sound、career、back、close；IMG-UI-05的4个variant：achievements-empty、statistics-empty、career-empty、items-empty。分别独立文件，不交拼图；每个variant的 `sourceFile/runtimeFile/inputReference` 仍为null。统计空插画不能取代四个零值，任何空插画不能掩盖存储warning。分层只能对已批准且可编辑/上传的背景执行，无可用原件时不启动。

### 音乐与环境

| ID | 未来消费 / 触发 | 结束 / 共享边界 |
| --- | --- | --- |
| MUS-01 | 首页及其普通菜单的home上下文；`renderer:145-147` 附近未来分流 | 离开home转准备或游戏原曲；同首页菜单不另切歌 |
| MUS-02 | identity + cards，`controller:115-165` 的真实准备阶段 | 成功进game立即交还原life；不覆盖共享life文件 |
| MUS-03 | ending报告上下文，`view:123-131,385-423`；不单看ENDED | 关闭回历程恢复原ending；重启/首页重评；高层既有菜单沿用底层报告上下文 |
| AMB-01（可选） | home/identity/cards轻室内声；现状这些上下文无环境源 | 进入game交还地区声；ENDED仍按原路由无地区声；不替代任何地区文件 |

循环统一受真实手势/可见性/三通道音量/静音/资源可用性控制，后台pause、恢复不补播短音、销毁释放。音乐目标60—90秒；AMB目标30—60秒；48kHz立体声WAV后处理母版，运行MP3。MUS-02/03必须等MUS-01样片由用户选定且允许上传、工具支持参考音频；当前参考文件为null。目标不是服务原生保证，不能用低采样率重采样冒充新增细节，也不以波形或文件存在冒充循环/混音已试听。

### 单次UI音效

| ID | 计划触发 / 消费位置 | 结束 / 不可跨越边界 |
| --- | --- | --- |
| SFX-01 | 局外普通启用按钮，只有没有专属反馈的action使用；src/renderer.ts:265-268; src/view.ts:179-185,343-348,440-447 | 普通UI反馈被专属SFX替代时不叠加；range拖动不触发；短尾自然结束，后台/静音/销毁依现有生命周期；取消后不补播未发事件 |
| SFX-02 | 成功返回/关闭目标overlay（按钮、Esc、既有relic外部区域）；src/controller.ts:231-241; src/view.ts:122,129-131,151-155,159-161,461-464; src/renderer.ts:396-425 | 只有实际pop才播；cards/decision/stage拒绝close不能伪播关闭；短尾自然结束，后台/静音/销毁依现有生命周期；取消后不补播未发事件 |
| SFX-03 | 用户主动打开既有统计/声音/管理/详情overlay的一次反馈；src/view.ts:183-185,230,271,284-286,97-98; src/controller.ts:221-229,254-260 | 成就页若用SFX-10则不叠open；不改局内入口控件本体/日志cue；短尾自然结束，后台/静音/销毁依现有生命周期；取消后不补播未发事件 |
| SFX-04 | hub_<tab>确实切换到不同既有tab时；src/view.ts:343-348 | 重复同tab不冒充新切换；不改tab/selection语义；短尾自然结束，后台/静音/销毁依现有生命周期；取消后不补播未发事件 |
| SFX-05 | start成功后身份第一次可见；同次start只一次；src/controller.ts:115-126; src/view.ts:194-220; src/renderer.ts:145-156 | 重绘/busy finally/返回遮挡恢复不重播；失败开局不播成功揭晓；短尾自然结束，后台/静音/销毁依现有生命周期；取消后不补播未发事件 |
| SFX-06 | 真实pending候选首次选中或换到不同候选，未最终提交；src/controller.ts:138-146; src/view.ts:323-337 | 换选只播一次新选中；不叠tap/取消；同卡不制造撤销事件；短尾自然结束，后台/静音/销毁依现有生命周期；取消后不补播未发事件 |
| SFX-07 | 没有当前撤销选中行为；仅预留，禁止生成/接入；src/controller.ts:138-146 | 本次不启用，不为使用素材而新增交互；短尾自然结束，后台/静音/销毁依现有生命周期；取消后不补播未发事件 |
| SFX-08 | 有效confirmCard提交/确认反馈的唯一局外主音；须先解清与原item日志cue的冲突；src/view.ts:68-70; src/controller.ts:149-165; src/renderer.ts:148-156,265-268 | 无选中/失败/忙碌不播成功；不得为了新声抑制受保护item日志或延迟游戏命令；短尾自然结束，后台/静音/销毁依现有生命周期；取消后不补播未发事件 |
| SFX-09 | 现有真实局外操作失败/不可执行notice在目标上下文产生的一次反馈；src/controller.ts:104-124,141-143,153-155,223-225,234-247,263-265,330-336,362-366 | disabled命中不触发；同notice重绘不重播；game/decision/stage的原失败语义不改；短尾自然结束，后台/静音/销毁依现有生命周期；取消后不补播未发事件 |
| SFX-10 | 用户主动进入成就页的一次展示提示，可替代该次open/tab；src/view.ts:184,343-348,374-380; src/controller.ts:221-229 | 不逐条播、不冒充新解锁；不与open/tab/tap叠加，不改变局内achievement cue；短尾自然结束，后台/静音/销毁依现有生命周期；取消后不补播未发事件 |
| SFX-11 | 同段人生报告首次可见时一次收束；先解清与死亡/成就日志的同时触发；src/controller.ts:339-350; src/view.ts:123-131,385-423; src/renderer.ts:148-156 | 重开报告/重绘不当新终局；不替换或抑制局内死亡/成就cue；关闭前未触发则丢弃不补播；短尾自然结束，后台/静音/销毁依现有生命周期；取消后不补播未发事件 |

**须先解决的真实冲突**：当前 `confirmCard` 可以先tap，再因 `card_selected` 日志播item；终局可同时产生death/achievement日志。SFX-08/11不能仅再叠一声来宣称完成，也不能覆盖原文件、抑制受保护局内日志cue或延迟命令。第5阶段接线前必须明确局外事务与局内日志反馈的非重叠边界；未证明前保持planned不启用。本阶段只记录冲突，不篡改语义。SFX-09只消费已经产生的真实局外notice，静默guard、禁用点击不能被改成新失败事件。SFX-10主动打开/切入成就页时替代通用open/tab，不逐条庆祝旧成就。

每条只有一个非音乐短事件、无语音/旋律/长混响；48kHz WAV母版后转MP3。单条时长按08约定写入manifest。SFX-07没有当前消费，明确标为预留可选，不能为其新增撤销功能。

### 可选视频 / FX参考

| ID | 用途 / 消费 / 触发 | 结束 / 隔离边界 |
| --- | --- | --- |
| FX-01 | src/view.ts:170-191; src/renderer.ts:247-258：后续首页程序动效的离线设计参考；无当前视频消费者；离线查看参考；未来home可见时运行的是程序动效，不是此视频 | 离开home/后台/销毁停程序循环；减少动态静态；参考文件不进入包 |
| FX-02 | src/view.ts:68-70; src/controller.ts:149-165：启程局外短暂点缀；仅有效确认且cards仍可见的局外视觉窗口；可能没有足够窗口，默认程序实现且不强行展示 | 自然时长后结束；cards不再为顶层、确认失败、重启或销毁时取消过时视觉和回调；screen=game即不再显示，不能为播完拖延提交或盖住game；减少动态静态最终态，后台不追赶 |
| FX-03 | src/view.ts:123-131,385-423; src/controller.ts:339-350：报告无字印记一次显现；同人生首次报告可见；不因重开或重绘重播 | 自然时长后稳定为静态印记；报告关闭、被更高overlay遮挡、重启或销毁时取消过时显现和回调；**底层screen=game不构成取消条件**，仅在ending报告层绘制；减少动态直接最终态，后台不追赶或补播 |

默认使用Canvas程序动效。FX-01永不默认入运行包；FX-02/03须先证明遮罩/提帧可靠、边缘无污染、平台性能/包体合格才考虑运行帧序列，实际运行格式目前为null。FX-02尤其不能为“播完”强留cards或盖住已进入的game；真实流程没有足够局外窗口时不强行播放。减少动态可直接显示最终态；这些视频不带声音，不承诺透明视频或当前播放能力。

## 7. 路径、来源与发布契约（只规划，不声称目录/文件存在）

| 用途 | 计划命名空间 | 当前含义 |
| --- | --- | --- |
| 本阶段结果 | `local/outgame-ai/01-inventory/` | 本次仅核对并更新已有scope与manifest |
| 首页批准风格参考 | `local/outgame-ai/02-style/bright-options/a-comic.html` 及该目录 A 截图 | A 已选定；参考与哈希由02统一索引，不表示新背景／音乐已生成或Canvas已接入 |
| 图片原件/批次 | `local/outgame-ai/03-images/` | 未生成；原服务真实格式先保留，再确定性处理 |
| 视频参考 | `local/outgame-ai/04-motion/` | 参考不等于运行资产 |
| 音频原件/母版 | `local/outgame-ai/05-audio/` | 未生成、未试听、未批准 |
| 运行图片 | `public/art/outgame/` | 验收后新文件，不覆盖art/items |
| 运行音频 | `public/audio/outgame/` | 验收后新文件，不覆盖原cue/music/ambience |
| 条件运行特效 | `public/fx/outgame/` | 仅启用且可提取/可发布的素材；不放参考视频充数 |

- `inputReference/sourceFile/runtimeFile` 是**实际已存在且属于该新条目的文件**：37个新条目当前都为null，不把提示词、旧共享图或计划文件名填进去冒充新文件。`targetSpec.*NamePlan` 和顶层 `pathPlan` 仅是命名方案，不是存在性声明；批次子文件也遵守此规则。
- 新条目仍为 `status=planned`、`provider=null`、rights=unknown_not_cleared、approval=not_authorized；这些状态针对具体媒体文件和外部调用，不否认 A 项目风格已经批准。required=true的26条只表示素材方案目标，另11条可选／预留不得误写成已授权或现有构建依赖。
- 运行素材最终**必须放public并纳入项目版本管理**，不能依赖local、外链CDN、绝对工作机路径或旧dist。根.gitignore当前未列public/local，但本次未检查Git全局排除或跟踪状态，不声称已跟踪，不提交Git。
- `platform.asset('art/outgame/<name>')` 等仍为统一入口。Web按BASE_URL解析、Vite输出dist-web；微信加media/前缀。当前微信脚本递归复制public/art、audio、fx到media相应分包，许可单独到licenses；因此未来outgame文件可随该树复制，但**复制不等于代码已引用/会触发**。`src/platform.ts:84,123,133`、`tools/build-wechat.mjs:9-14,44-47`。
- `tools/assets.mjs` 是显式必需表，不自动发现新文件。后续只在启用资源后更新真正必需项；可选未启用不得阻塞构建。`prepare-assets` 对表stat并复制licenses直接文件，不是生成器。当前微信主包/各分包4MiB、总包30MiB来自脚本，**没有本次测得的新包体数据**。`tools/prepare-assets.mjs:5-21`、`tools/build-wechat.mjs:6-14,90-106`。
- 新资产来源必须登记 `licenses/media-sources.txt`：实际供应商/返回模型/日期、参考来源与哈希/可上传权利、条款与商用核查、原件、加工工具步骤/哈希、审批。源许可经prepare到public/licenses，并随Web/微信发布；本阶段不预填虚构供应商/权利，也不改旧来源声明。
- 旧首页图当前只见home消费者，未来完整迁移后才可决定移除；旧物品、tap、life、ending、地区声、四图集有受保护消费者，不能删/覆盖/通过兼容别名掩盖漏迁移。

## 8. 原生兜底保留

Web `src/main.ts:5-22` 的try/catch捕获执行到该处后的同步初始化异常，显示 `index.html:14-15` 的startup-status；noscript提供禁用JavaScript提示。没有独立Web加载界面或重试按钮；模块加载等尚未进入try的失败不能声称一定被此catch覆盖。微信生成入口 `tools/build-wechat.mjs:56-75` 使用showLoading（“载入时空”），分包成功hideLoading后调用startWechat；缺加载API、分包失败或入口异常会hideLoading并showModal（“加载失败”，只有确认，提示关闭后重新进入），没有自动/按钮内重试。保留这些原生宿主/文本兜底，不添加加载大图、配音、视频或新重试/清档语义；不承诺加载期自动音乐。图集加载失败现有“人生推演仍可继续”通知也不改。以上均为源码路径，未注入故障或运行验证，不把任何错误都断言成分包失败。

## 9. 下一阶段必需输入与当前缺项

1. 已具备：本阶段两文件、08全部提示词及当前真实首页入口/临时进度文字。下一阶段以此作为事实底座，不重新猜范围。
2. **尚未授权**：图像与音乐分别明确供应商、实际可用模型/能力、预算或调用额度、允许上传哪些参考及用途。已配置密钥/登录CLI/安装技能不算授权。当前任务没有此授权，不探测密钥、不调用CLI/外部服务、不消耗订阅额度。
3. **已具备风格批准**：A「爆笑开播」是唯一执行方向，使用奶油纸底、番茄红标题、亮黄墨字主按钮、局部粗墨线和短硬阴影。参考为 `../02-style/bright-options/a-comic.html` 及两尺寸实际截图；不再等待方向三选一。旧 `public/art/scenes/home.png` 不是 A 的风格参考。
4. 经批准且有权使用/编辑/上传的参考原件及哈希；无参考可以使用08“无输入”提示词，但不得伪称沿用了某图。批量图片前还需批准一件物品风格。
5. MUS-01首页主题的生成授权与用户样片选择；当前无文件、无试听结果。MUS-02/03要等该样片批准，且服务真支持参考音频，不用无关曲子冒充同主题。
6. A 的独立 HTML 已有390×844与360×640浏览器检查，证据见02；正式Canvas接入仍须按真实文字／入口、等比裁切／安全区／减少动态、无声可操作及真实手势试听分别验证。HTML证据不代替Canvas、微信或设备试听。

本阶段可完成的盘点已交付；缺项只限制后续生成/审批/接入，不以假路径、假试听或已登录CLI绕过。

## 10. 证据边界与完成口径

- 已执行：静态读取指定源码、08完整37个编号条目、当前打包/来源规则；public实物枚举；本地file头部核对13张PNG尺寸/通道和17个MP3编码信息；sha256sum核对四份许可源/发布副本；文档JSON结构、编号集合、12目标表面+2兜底及各9项状态的只读核对。
- 未执行：构建/测试/内容校验；运行点击/视觉/听觉/真机/减少动态验收；音频解码时长/响度/循环接缝；有效alpha像素/图像风格验收；外部生成/下载/付费；Git跟踪或历史原件字节级核验。
- 符号服务references返回“No language server found for this action”；调用关系依据已知文件读取、定向src检索和独立只读调查，不称LSP完整索引或运行覆盖。
- 文档与manifest的状态矩阵覆盖12目标表面+2原生兜底，37父素材任务均有现有/计划消费位置；SFX-07无当前消费者是明确的保留约束，不伪造接线。没有生产功能、概率、内容ID或存储行为变更。
