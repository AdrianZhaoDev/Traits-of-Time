# 提示词5：家庭成就与终局

交付 `task5.achievements.json` 12 项、`task5.deaths.json` 5 项、`task5.events.json` 5 项，均为可追加的 JSON 对象数组。成就优先级为 44–95：milestone 9 项、life 2 项、anecdote 1 项；不新增事业链、不改旧生产对象，也不产生任何新 flag。

## 成就 ID 与意图

1. `A_FAM_HOME_AND_CAREER`「成家立业」：当前已婚，同时有真实原生职业链正在进行或已经完成；单纯财富、身份、读书和历史启动标记不代替事业。
2. `A_FAM_SON_AND_DAUGHTER`「儿女双全」：二胎出生且有可确认一儿一女的事实标记；旧线长子女性别不明时不会凭人数授予。
3. `A_FAM_FIVE_GENERATIONS`「五世同堂」：至少 70 岁、已有二胎出生里程碑，且实际五代团聚事件已经发生。
4. `A_FAM_CHILD_WELL_TAUGHT`「教子有方」：记录任务2中成年子女取得成果的历史里程碑。
5. `A_FAM_HIGH_MARRIAGE`「高门贵婿」：记录曾经高门联姻，不把历史姻亲当作当前婚姻。
6. `A_FAM_REMARRIED`「续弦不渝」：同时要求曾丧偶、当前已婚和续弦事实。
7. `A_FAM_GRANDCHILD`「含饴弄孙」：以实际出生的孙辈事件而非玩家年龄推断。
8. `A_FAM_HEIR`「后继有人」：两名实际成年且当时存活的子女在分家事件中接过家资后记录成果。
9. `A_FAM_HEIRLESS`「后继无人」：终局仍有家资至少 8、曾有无子托付经历、没有新首胎里程碑，也没有旧线孩子标记。
10. `A_FAM_BEREAVED_CHILD`「白发送黑发」：至少 50 岁且有送别成年子女的历史，短评只回顾经历，不宣称所有子女都已离世。
11. `A_FAM_CHILD_MARRIED`「子女成家」：记录真实成年并存活的长子女婚嫁经历。
12. `A_FAM_LIFE_TOGETHER`「晚年有伴」：终局至少 50 岁、当前有伴侣，并有取得成果且当前存活的第二名子女。

## 死因与接入事件

1. `D_FAM_END_OLD_AGE`「寿终家中」← `E_FAM_END_OLD_AGE`：80 岁以上、体魄至多 3 且当前有伴侣时，罕见地在伴侣陪伴下寿终。
2. `D_FAM_END_HOUSE_FIRE`「家宅失火」← `E_FAM_END_HOUSE_FIRE`：25 岁以上、体魄至多 3 且当前有伴侣时，夜间意外失火，两次撤离检定皆失败才死亡。
3. `D_FAM_END_OVERWORK`「劳碌成疾」← `E_FAM_END_OVERWORK`：50 岁以上、体魄至多 2、当前有伴侣且实际有指定职业链进行时，积劳病倒；两次救治检定皆失败才死亡。
4. `D_FAM_END_CLAN_CROSS_FIRE`「宗族争斗误伤」← `E_FAM_END_CLAN_CROSS_FIRE`：25 岁以上、体魄至多 3 且当前有伴侣时，路过田界械斗遭误伤，两次救治检定皆失败才死亡。
5. `D_FAM_END_FAMILY_SHELTER`「护家遇难」← `E_FAM_END_FAMILY_SHELTER`：30 岁以上、体魄至多 3 且当前有伴侣时，屋梁意外倒落，就近庇护伴侣受伤；两次救治检定皆失败才死亡。

五条都是 automatic、random、rare，一局每条至多遭遇一次；priority 均为 0，weight 为 2 或 3，概率门控为 0.06、0.08 或 0.12。门控、同优先级事件加权抽取和年度随机上限共同决定实际遭遇，不能把门控值说成每年实际死亡概率。四种意外／病症都设真实的两段体魄检定和存活结果；寿终则直接结束。意外仅描述突发灾祸和现场庇护，不让玩家被迫主动涉险。引擎年度自然寿限在随机池之前结算，故寿终事件只可能出现在尚未达到本局自然寿限的年岁，不保证每局触发。死亡文案不虚构子女或孙辈，所有死因都有明确事件引用。

## 状态来源及边界

- 任务1的婚礼、高门联姻、丧偶、续弦及旧婚姻认领生产 `F_FAM_MARRIED`、`F_FAM_HIGH_MARRIAGE`、`F_FAM_WIDOWED`、`F_FAM_REMARRIED`；前者为可移除的当前婚姻，后三者仅表明曾经发生。各死因事件只据当前婚姻叙述在场伴侣。
- 任务2的 `E_FAM_CHILD_FIRST_*` / `E_FAM_CHILD_RECOGNIZE_LEGACY` 和 `E_FAM_CHILD_SECOND_*` 分别生产永久出生里程碑 `F_FAM_CHILD_1`、`F_FAM_CHILD_2`。其中已知性别长子女的异性二胎事件另生产 `F_FAM_CHILD_SON_AND_DAUGHTER`；旧线长子女性别不明时不会凭人数授予儿女双全。
- `E_FAM_CHILD_SUCCESS` 记录成年存活二胎运用玩家传授的方法独立做成生意，生产 `F_FAM_CHILD_SUCCESS`；`E_FAM_CHILD_BEREAVED_SECOND` 在该子女去世时生产 `F_FAM_CHILD_2_DEAD`，该事件与另两条成年子女身故事共同生产 `F_FAM_CHILD_BEREAVED`。
- `E_FAM_CHILD_MARRIAGE` 生产 `F_FAM_CHILD_MARRIED`；`E_FAM_CHILD_GRANDCHILD_*` 生产真实出生的 `F_FAM_GRANDCHILD`；`E_FAM_CHILD_FIVE_GENERATIONS` 在五代相聚且末代出生时生产 `F_FAM_FIVE_GENERATIONS`。这些标记记录历史；本任务不把它们单独当成当前子女存活证明。
- 任务3的 `E_FAM_WEALTH_ESTATE_LARGE` / `E_FAM_WEALTH_ESTATE_MODEST` 在两名子女实际成年并存活、达到分家和家资条件时生产 `F_FAM_ESTATE_SETTLED`，两人各自承接一份家资；`E_FAM_WEALTH_HEIRLESS` 生产经历性 `F_FAM_HEIRLESS`。后继无人成就另在死亡时核对当前家资、`F_FAM_CHILD_1` 及旧生产 `F_LIFE_HAS_CHILD`，以免经历之后生子仍授予。
- 职业条件读取原有 `CHAIN_MILITARY_MERIT`、`CHAIN_FIREARMS_RESEARCH`、`CHAIN_EPIDEMIC_HEALING`、`CHAIN_FORTRESS_DEFENSE`、`CHAIN_MARITIME_TRADE`、`CH_WORKSHOP`、`CH_JN_TRADE`、`CH_gm_arms`、`CH_gm_water`、`CH_gm_fort`；成家立业接受其中 active 或 completed，劳碌病倒仅接受 active。
- milestone 与 anecdote 是发生时记录的经历，life 是死亡时重新核对的状态；因此出生、丧子和分家历史不会伪装成终局时人物仍在世。
- 旧池 `E_LIFE_CHILD_MISCHIEF`、`E_LIFE_CHILD_SUCCESS`、`E_LIFE_SENIOR_GRANDCHILD` 自身没有出生年／成年门槛，晚生子时原有叙述仍可能过早。按契约不改旧条目，本次片段不宣称整个生产家庭时间线已经完全无矛盾。

依共同契约未运行 build、lint、测试、格式化或内容校验；合并后由任务6验证实际调度、死亡分支与跨任务可达性。
