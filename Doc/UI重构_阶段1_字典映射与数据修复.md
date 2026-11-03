# UI 重构 - 阶段 1：字典映射、文本拆分引擎与数据修复

## 目标
1. 建立明末完整枚举字典映射模块 `EnumMapper.ts`，消除顶部 HUD 直接显示 `I_CLAN_ELDER`、`R_SHANBEI` 等英文 ID 的问题。
2. 建立日志流结构化拆分聚合器 `LogParser.ts`，解决引擎层同一事件触发 `event` 与 `effects` 导致 UI 双重重复打印的问题，并将 outcome 中的 `【词条】` 与实际结果文案结构化拆分。
3. 修正 `events.json` 中修补战甲（`E_SOC_SENIOR_REPAIR`）的错误木器文案。
4. 提供配套测试用例，保证纯逻辑与字典映射的单测绿灯。

---

## 交付文件
- `assets/resources/data/ming_end/events.json`（已修复）
- `assets/scripts/presentation/EnumMapper.ts`
- `assets/scripts/presentation/LogParser.ts`
- `tests/presentation/enum-mapper-and-log-parser.spec.ts`

---

## 详细规格与实现要点

### 1. EnumMapper.ts 映射规范
- 地区映射：
  - `R_SHANBEI`: "陕北·延安府"
  - `R_CAPITAL`: "京师·顺天府"
  - `R_JIANGNAN`: "江南·苏州府"
  - `R_LIAODONG`: "辽东·关外卫"
- 阶层映射：
  - `C_REFUGEE`: "流民"
  - `C_SOLDIER`: "军户"
  - `C_GENTRY`: "士绅"
  - `C_MILITARY`: "卫所武官"
  - `C_OUTLAW`: "义军"
- 身份映射（涵盖 ming_end 中所有出现过的职业/身份 ID）：
  - `I_YOUTH`: "总角幼童"
  - `I_DEPENDENT`: "宗族子弟"
  - `I_REFUGEE`: "逃荒流民"
  - `I_WORKER`: "作坊帮工"
  - `I_HOUSEHOLD`: "军户余丁"
  - `I_MILITARY_OFFICER`: "卫所旗官"
  - `I_SILK_MERCHANT`: "绸缎巨贾"
  - `I_JUREN`: "乡试举人"
  - `I_ARTISAN`: "军匠百工"
  - `I_HEALER`: "悬壶医家"
  - `I_MARITIME_MERCHANT`: "海商掌柜"
  - `I_COMMUNITY_LEADER`: "乡党领袖"
  - `I_WAREHOUSE_OVERSEER`: "仓廪司库"
  - `I_CLAN_ELDER`: "宗族耆老"
  - `I_TENANT`: "佃农雇工"
  - `I_SCHOLAR`: "县学庠生"
  - `I_MERCHANT`: "行商走贩"
  - `I_SOLDIER`: "营兵精锐"
- 属性名称与图标映射：
  - `health`: { name: "体魄", icon: "体" }
  - `wealth`: { name: "家资", icon: "财" }
  - `capability`: { name: "才干", icon: "智" }
  - `connection`: { name: "人脉", icon: "脉" }
  - `luck`: { name: "气数", icon: "气" }
- 方法：`translateRegion(key: string): string`、`translateCaste(key: string): string`、`translateIdentity(key: string): string`、`translateStat(key: string): { name: string; icon: string }`、`translateEnum(key: string): string`。

### 2. LogParser.ts 聚合与拆分规范
```typescript
export interface FoldItemData {
  eventId?: string;
  introText: string;     // 起因淡墨：原 event text 或背景
  outcomeText?: string;   // 结果描述
  stampTag?: string;      // 词条印章名（从【xxx】解析）
  effectsText?: string[]; // 属性变化摘要提示
  type: string;           // 'history' | 'event' | 'system' | 'crisis' | 'chain'
}
```
- 输入：`SessionLog[]`
- 聚合规则：
  - 维持当前聚合帧。
  - 遇到 `log.type === 'event'` 时，若紧随其后（或在同批次回执中）出现相同或相连的 `log.type === 'effects'`（`source_id === event.id`），将其合并为一个 `FoldItemData`，避免在 UI 上分成两行显示。
  - 正则表达式 `/^【(.+?)】(.*)$/`：提取 stampTag 与正文。
