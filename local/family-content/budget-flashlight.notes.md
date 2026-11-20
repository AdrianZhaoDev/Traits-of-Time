# 手电选择预算交付说明

交付：`budget-flashlight.json` 是按 ID 完整替换的对象包，包含 7 个旧事件、1 条旧链和经父代理明确授权的 1 条旧成就，以及逐 ID 的 `reasons`；不追加新事件、链、死因、成就或 flag。请按 ID 合并 `events`、`chains` 和 `achievements` 三个数组，不要直接拼接数组。家庭内容未改动。

## 六个自动进展

- `E_MOD_FLASHLIGHT_EVIDENCE`：自动进入原 `evidence_check` 真实才干 D20（DC 15、`night_patrol`）。入口只描述准备搜证，不先发奖励；成功采用原第一正常结果，写 `F_MOD_FLASHLIGHT_EVIDENCE`、才干 +3、人脉 +3；失败保留原检定结果，写同一 flag、才干 +2、人脉 +1。两支都能继续链且均无死亡；这是预算合并后正常／失败成长的明确差别，不会重复奖励。
- `E_MOD_FLASHLIGHT_PATROL`、`E_MOD_FLASHLIGHT_ESCORT`：自动结算各自原首个安全 outcome；继续写 `PATROL`、`ESCORT`、`READY` 和原成长。
- `E_MOD_FLASHLIGHT_FAST_FRAUD`、`E_MOD_FLASHLIGHT_FAST_ROTA`、`E_MOD_FLASHLIGHT_FAST_EXIT`：保留原历史年份、优先级和前置，自动结算各自首个安全 outcome；第一步仍写 `ABORT` 使正常链中断，依次写 `FAST_1`、`FAST_2`、`FAST_DONE`，并保留对应查证、巡夜、护送及 READY 标记。快进高危重复分支集中至突破。
- 原中途安全备选提供的体魄投资不再由这些节点提供；不把体魄成长叠加到自动首选奖励上。突破的才干、体魄两条路线与原门槛均保留，体魄仍可由已有事业及其他事件获得。

## 重大选择、危险与退出

`E_MOD_FLASHLIGHT_BREAKTHROUGH` 原事件条件增加未使用 `F_LIFE_HISTORICAL_TURN_USED`；所有七个选项的 outcome 均先写入该 flag，包括两种原突破、原安全退路、三个危险选项和退出。与既有历史重大选择共用一次预算。原才干／体魄条件、人脉门槛、DC 22、原骰下限 10、普通成功／自然 20／失败及安全退路效果不变；选择前仍说明追查失足可能丧命。

| 危险选项 | 实际阶段事实及持物前提 | 移入的真实逃脱检定 | 失败保留的成就 flag 与死因 |
| --- | --- | --- | --- |
| `flashlight_robbery` | 持手电，完成普通主链且已搜证 | `flashlight_break_robbery_escape`，体魄 DC 17 | `F_MOD_FLASHLIGHT_DEATH_ROBBERY` → `D_MOD_FLASHLIGHT_ROBBERY` |
| `flashlight_claims` | 持手电，已有搜证和巡夜 | `flashlight_break_claims_escape`，才干 DC 17 | `F_MOD_FLASHLIGHT_DEATH_CLAIMS` → `D_MOD_FLASHLIGHT_CLAIMS` |
| `flashlight_misstep` | 持手电，已有护送和 READY | `flashlight_break_ditch_escape`，体魄 DC 17 | `F_MOD_FLASHLIGHT_DEATH_MISSTEP` → `D_MOD_FLASHLIGHT_MISSTEP` |

对应普通和快进的透墙／暗沟危险分别合并为同一个重大选项及逃脱阶段；快进的 `FAST_1`、`FAST_2` 和 `FAST_DONE` 已由前面自动节点产生，无需危险阶段再次生产。抢灯原本只在普通搜证出现，因此仍要求普通主链事实。三个危险阶段沿用原判定属性、DC、tag 和死亡 flag／死因；成功不叠发自动成长。无危险被强加给自动事件。

原 `flashlight_quit` 仍为明确选择，写原 `F_MOD_FLASHLIGHT_ABORT`，但因集中到完成后的重大菜单，它现在是停止后续查案，而不再是搜证时提前手动中止主链；原伤病、封路及快进的中断条件仍保留。

`CHAIN_MOD_FLASHLIGHT_DETECTIVE` 仅更新 commitment，说明自动进展、可失败但继续的搜证和集中重大选择；原 nodes、completion 和 interrupt 全部保留。

## 成就短评例外

`A_MOD_FLASHLIGHT_DEATH_ROBBERY` 只把 text 从“才刚接触夜查……”改为“追赶抢灯贼时遇险，这段人生就此结束。”：危险已移到完成普通主链后，旧时间描述不再真实。ID、名称、条件、priority、category 均保留；其余九项手电成就不改，配额与等级不变。其余手电进度／突破／自然 20 和三种死亡成就 flag 仍有生产路径。

未运行构建、测试、格式化或校验；合并后由统一验收验证选择预算、真实 D20 成功／失败、普通与快进先后条件、共同历史预算门禁、三死因及十项成就可达性。
