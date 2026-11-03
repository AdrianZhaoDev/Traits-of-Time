# UI 重构 - 阶段 3：动效矩阵、官印快进与左右批红交互

## 目标
1. 依据 `Doc/动效与微交互制作规范.md` 构建 `UIAnimController.ts`，使用 Cocos 纯原生 `tween` 与 `UIOpacity`，零第三方库依赖。
2. 实现 5 大微交互动效：
   - 朱砂盖印与震屏微动 (`playStampEffect`)
   - 铜钱翻转与数值涨跌抖动 (`playStatChangeEffect`)
   - 岁月折页风化褪色渐变 (`updateScrollWeathering`)
   - 命数烛火动态暗角呼吸与濒危急促闪烁 (`updateCandleVignette`)
   - 腰牌晃动微动效 (`playPlaqueSway`)
3. 底部青铜官印长按连续快进交互：短按推进一年，长按 (>=0.35s) 启动持续推进，遇抉择或终局自动截断。
4. 奏折决策批红卡片 `MemorialCard.ts`：左右滑动拖拽交互，左滑冷眼旁观，右滑倾力入局。

---

## 交付文件
- `assets/scripts/presentation/UIAnimController.ts`
- `assets/scripts/presentation/MemorialCard.ts`
- `Doc/UI重构_阶段3_交互控制器与动效矩阵.md`
- `tests/presentation/phase3-interaction-and-animations.spec.ts`

---

## 核心实现说明

### 1. UIAnimController 动效矩阵
严格遵循《动效与微交互制作规范》，基于 Cocos 原生 `tween` 与 `UIOpacity`，合批安全与零外部依赖：
- **朱砂盖印与震屏微动 (`playStampEffect`)**：
  - 初始缩放 2.8x，带自然歪斜角度（`±6°`）；
  - 0.06s 渐显透明度至 255，并在 0.18s 内以 `quadIn` 砸落归位至 1.0x；
  - 盖印瞬间联动 `playScreenShake`，通过 4 段阻尼衰减震荡屏幕（振幅 +5px -> -5px -> +2.5px -> 0px，总时长 0.12s）。
- **铜钱翻转与数值涨跌抖动 (`playStatChangeEffect`)**：
  - 增益（`delta > 0`）：0.14s 压扁至 `scaleX = 0.1, scaleY = 1.2` (`quadIn`)，后 0.14s 回弹至 1.0x (`backOut`)，模拟铜钱沿 Y 轴翻转；
  - 跌损（`delta < 0`）：4 段快速左右颤动（+4px -> -4px -> +2px -> 0px，各 0.04s，总耗时 0.16s），呈现受挫惊慌感。
- **岁月折页风化褪色渐变 (`updateScrollWeathering`)**：
  - 监听 ScrollView 滚动视口；
  - 卡片处于顶部 30% 渐隐区时，基于其到顶部的距离，线性衰减 `UIOpacity` 至 110；超出顶部则设为 90，视口内其他区域保持 255。
- **命数烛火动态暗角呼吸与濒危急促闪烁 (`updateCandleVignette`)**：
  - 常态（`age < 60 && luck > 2`）：3.2s 周期正弦呼吸，缩放 1.03x ~ 1.0x，暗角透明度 90 ~ 140；
  - 濒危（`age >= 60 || luck <= 2`）：1.1s 急促闪烁，缩放 0.92x ~ 1.0x，暗角透明度 160 ~ 220，营造风中残烛压迫感。
- **腰牌晃动微动效 (`playPlaqueSway`)**：
  - 身份发生变动或开局时触发；0.12s 轻微放大 1.05x，并在 0.15s 内正弦摆动 `±5°`，0.1s 归位复原。

### 2. 底部青铜官印长按连续快进
- **触控交互模型**：
  - `TOUCH_START`：官印按钮缩放至 0.95x 蓄力，记录按压开始；
  - 短按（`< 0.35s` 抬起）：触发单步推进（推进一年）；
  - 长按（`>= 0.35s`）：启动连续快进，以 `0.22s` 固定步频自动触发后续年份推进；
  - 截断保护：在遇到抉择事件（`pending !== null`）、角色死亡/生平终局（`status === 'ENDED'`）或引擎异常时，立即重置 `isSealHolding = false` 并打断连推，防止跳过关键命运分支。

### 3. 奏折决策批红卡片 (MemorialCard)
- **拖拽手势与批朱/批墨映射**：
  - 卡片挂载 `TOUCH_START`、`TOUCH_MOVE`、`TOUCH_END`、`TOUCH_CANCEL` 监听；
  - 拖拽位移跟随并根据 X 轴偏移量叠加轻微旋转（`-(deltaX / 500) * 8°`）；
  - 左右提示标签随拖拽距离动态高亮微放（1.15x / 0.9x）；
  - **左滑 > 110px**：触发“批墨”（冷眼旁观 / 拒绝，对应 `options[0]`），卡片向左飞出并回调执行；
  - **右滑 > 110px**：触发“批朱”（倾力入局 / 顺从，对应 `options[1]` 或 fallback 单选项），卡片向右飞出并回调执行；
  - 滑动未达门槛（`|deltaX| <= 110px`）：以 `backOut` 弹性复位居中。

---

## 验证验收
- TypeScript 类型检查：`npx tsc --noEmit` 0 报错。
- 内容规则与数据指纹校验：`npm run validate:content -- --content assets/resources/data/ming_end` 通过。
- 单元测试：`npx vitest run` 完整套件全部绿灯通过（包括 `phase3-interaction-and-animations.spec.ts`）。
