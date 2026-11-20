# 医者选择预算修复交付

`budget-healer.json` 为 `{events, chains, reasons}`：7 个旧事件和 1 条旧主链的完整替换对象，不含家庭内容，未直接改动生产文件。

## 自动进展

- `E_MOD_HEALER_NODE_1/2/3` 分别沿用原第一项跟诊、清洁、救助结果及成长、标记；`NODE_2` 的 `S_HYGIENE` 原检定、成功和失败均保留。
- `E_MOD_HEALER_FAST_1/2/3` 分别沿用原第一项分诊、净水、交接结果及原触发、条件、优先级；`FAST_1` 仍中断普通链，`FAST_2` 的 `S_WATER` 原检定和两个分支均保留。自动进展不消耗整板药、不增加死亡、不占历史重大选择。
- 原本普通／快进菜单里只提供较低成长、且被自动正常进展覆盖的登记、辅助等重复选项已移除；重大菜单保留可主动暂停协诊的 `withdraw`，进行中的事业仍可通过既有手动放弃机制退出。

重大菜单要求已有 `READY`：普通主链此时已完成，快进普通链已中断，因此菜单中的暂停不会回溯改变原链状态；提前终止进行中事业仍依靠原有手动放弃。

## 重大菜单与风险

`E_MOD_HEALER_BREAKTHROUGH` 增加未使用 `F_LIFE_HISTORICAL_TURN_USED` 的事件条件；推广、当地照护、交药、自诊、携药独行、暂停这六项均在进入任何阶段前写入该标记，与重大历史选择互斥。事件文案只预告成本与风险，不自动发生自诊或遇袭。

- `spread` 的持卡、历史线、年份、才干、人脉、`F_MOD_HEALER_READY` 等原高阶门槛不变；`S_SPREAD` 的 medicine DC 24、原骰至少 10、成功／失败／自然 20 及其标记与奖励不变。
- 普通和快进的 `use_course` 合并，仍须同时持卡和拥有 `F_MOD_HEALER_COURSE_AVAILABLE`；仅选此项才移除可用标记、写入 `F_MOD_HEALER_COURSE_USED`。因自动进展已经发放原第一项的 +3 才干、+3 人脉，不在此重复发奖。交药后保留手册，选前正文说明整板耗尽。
- 原 `S_MOD_HEALER_DELAY_RESCUE` 迁为 `S_MOD_HEALER_BREAK_DELAY_RESCUE`：仅主动选择腹痛自诊后进入，要求持卡且已有跟诊用药边界 `F_MOD_HEALER_BOUNDARY`；原 medicine DC 18、成功及 `F_MOD_HEALER_DEATH_DELAY` 后接 `D_MOD_HEALER_DELAY` 的失败路径保留。快进原本并无该自诊选项，不能凭空跳过跟诊事实。
- 原普通 `S_MOD_HEALER_ROBBERY_ESCAPE` 和快进 `S_MOD_HEALER_FAST_ESCAPE` 合并为 `S_MOD_HEALER_BREAK_ROBBERY_ESCAPE`：要求持卡、尚有整板药，且已有普通救助 `F_MOD_HEALER_RELIEF` 或快进交接 `F_MOD_HEALER_FAST_DONE`；必须主动携药独行才进入。原 medicine DC 18、求援脱险和 `F_MOD_HEALER_DEATH_ROBBERY` 后接 `D_MOD_HEALER_ROBBERY` 的失败路径保留。两种路径的成功标记分别已由各自自动节点产生，合并检定成功不再重复写入，避免快进者无故得到普通救助成就，反之亦然。
- 自诊与携药危险都需真实持有对应手册或药品；整板用尽不能再次选择携药独行。死亡标记先于死亡效果，结算时可触发原死亡成就。未新增死因或成就标记。

## 成就与调度边界

普通自动节点继续产出 `BOUNDARY`、`HYGIENE`、`RELIEF`；快进自动节点继续产出 `FAST_DONE`；原推广成功及自然 20 分别继续产出 `SPREAD`、`LEGACY`。两项死亡成就保留各自显式危险选择及失败路径。例如足够早的普通开局可先完成第六年救助，进入 1640—1643 年仍处于历史线且未占用共享预算的重大菜单；两项 DC 18 检定均可掷出自然 1 失败。上述是按内容条件和引擎规则分析的可达路径，不是实跑证据。

历史事件先于随机突破调度。1644 年在京师且满足京师历史事件条件时，历史选择可能先消耗共享标记，之后医者突破及迁入的危险选项本局不再出现；其他年份／地区仍有可达机会。1645 年历史阶段结束后随机阶段转为架空线，不能保证每局都遇到突破；不通过绕开历史条件制造双菜单。

`CHAIN_MOD_HEALER_SAGE` 只改 `commitment` 文案；`nodes`、`completion`、`interrupt_condition` 和 `interrupt_text` 保持原状。未运行测试、构建、校验或格式化；请统一验收自动进展和两处真实检定、两种路径的药品可用／耗尽、风险成就、共享历史门禁及真实人生选择预算。
