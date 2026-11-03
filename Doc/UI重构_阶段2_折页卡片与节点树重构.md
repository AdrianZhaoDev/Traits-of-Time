# UI 重构 - 阶段 2：折页卡片与主节点树层级重构

## 目标
1. 确立 750x1334 竖屏比例规范，重构主画布 `Canvas` 下的完整层次骨架。
2. 构建 `EventFoldItem.ts` 组件：渲染单年历史事件/际遇卡片，拆分淡墨起因、朱砂印章、泥金正文及属性变动。
3. 重写 `GameMain.ts` 中的 UI 装配与渲染管线，将旧版平铺 Label 替换为 `EventFoldItem` 卡片式呈现，顶栏全面对接 `EnumMapper`。

---

## 节点树层级结构 (Canvas 750x1334)
```text
Canvas (750x1334)
├── BgLayer (750x1334, #1E1B18)
│   ├── PaperTexture (宣纸暗底)
│   └── CandleVignette (烛火暗角，挂载 UIOpacity)
├── TopHUD (Y: 567, 750x200)
│   ├── EraAndAgeLabel (纪年+年龄)
│   ├── IdentityPlaque (地域/阶层/身份腰牌容器)
│   └── StatsCoinBar (五维铜钱栏：体/财/智/脉/气)
├── CenterScrollArea (Y: 20, 750x880)
│   ├── EventScrollView (ScrollView, 680x880, X: -30)
│   │   └── Viewport (Mask)
│   │       └── Content (垂直 Layout, 间距 16px)
│   └── RightRelicBar (X: 335, 60x880, 垂直博古架插槽容器)
├── DecisionOverlay (Z: 10, 默认隐藏)
│   ├── MaskBg (半透明遮罩)
│   └── MemorialCard (奏折批红卡片，支持左右拖拽)
└── BottomControlBar (Y: -547, 750x240)
    ├── SealAdvanceBtn (青铜官印主按钮，带圆形进度环)
    └── SubBtnLayout (重启人生、存档、滚底辅助按钮)
```

---

## 交付文件
- `assets/scripts/presentation/EventFoldItem.ts`
- `assets/scripts/presentation/GameMain.ts`（重构节点骨架与折页追加逻辑）
- `Doc/UI重构_阶段2_折页卡片与节点树重构.md`

---

## 关键代码设计
- **卡片配色与排版**：
  - 普通卡片背景：`#2A2621`
  - 带词条的高光卡片：`#362F28`，金色描边/提示
  - 起因文本：22px，`#8C8275` (淡墨小字)
  - 正文/结果：26px，`#E6DEC8` (浓墨正文) 或 `#D4AF37` (泥金)
  - 朱砂印章：红底黑字或红边朱字框，`#C83C23`
