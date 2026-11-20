# 任务4：个人人生事件

交付 `task4.events.json`，共23条真实自动随机事件：少年3条、青年4条、壮年4条、暮年4条、贫寒4条、富足4条。全部无需历史年份；权重15–20、触发概率0.55–0.75、优先级0，单条最多发生一次，不增加选择或事业链。壮年赊米的还账事件可延续到暮年，以免债务因年龄跨界无法清偿。

## 每条事件的意图

### 少年

- `E_FAM_LIFE_CHILD_NEIGHBOR_FRIEND`：邻家玩伴一起修风车，建立有具体经历的早年友谊。
- `E_FAM_LIFE_CHILD_FIRST_PAY`：少年替米铺做轻活，第一次收到自己的工钱，准备为家里买米。
- `E_FAM_LIFE_CHILD_GATHER_FIREWOOD`：邻人让出碎柴，少年把柴带回家续上灶火。

### 青年

- `E_FAM_LIFE_YOUNG_ON_THE_ROAD`：跟驮队谋生时听到乡音，向同乡打听故里的消息。
- `E_FAM_LIFE_YOUNG_FELLOW_TRAVELER`：同路人分干粮、玩家递水，建立互相照应的情谊。
- `E_FAM_LIFE_YOUNG_FIRST_WORK`：学过缝补后首次独自完成一批布袋，按期交活领钱。
- `E_FAM_LIFE_YOUNG_FRIEND_FAIR_PAY`：做活被少算工钱时，已结识的朋友陪着对账并追回欠款。

### 壮年

- `E_FAM_LIFE_MIDDLE_FAMILY_DEBT`：贫寒时和现任伴侣面对柴米开销，赊粮暂解燃眉之急并留下债务。
- `E_FAM_LIFE_MIDDLE_REPAY_DEBT`：有了余钱后偿还先前的米账，清除欠款状态。
- `E_FAM_LIFE_MIDDLE_TRADING_PARTNER`：合伙赶集的搭档破了袋，玩家帮忙缝好、捡齐货物。
- `E_FAM_LIFE_MIDDLE_ILLNESS`：一场大病造成真实体魄损失，也让玩家停下手里的活慢慢休养。

### 暮年

- `E_FAM_LIFE_ELDER_ROAD_RECOLLECTION`：有驮队经历的人看见旧包袱，想起闯荡岁月并提醒后生留意落脚处。
- `E_FAM_LIFE_ELDER_FRIEND_GONE`：早年结交的朋友过世，玩家收起信，克制地追忆故人。
- `E_FAM_LIFE_ELDER_MENDING_TAUGHT`：会缝补粮袋的老人把针脚教给邻居。
- `E_FAM_LIFE_ELDER_GRANDCHILD_STORY`：确有孙辈后，老人向身旁的孙辈讲述邻里排水的旧事。

### 贫寒

- `E_FAM_LIFE_POOR_EMPTY_POT`：寻工未果、锅中无米，饥饿带来有限体魄损失。
- `E_FAM_LIFE_POOR_WARM_FIRE`：缺柴时到邻家灶边取暖，也顺手帮邻人续火。
- `E_FAM_LIFE_POOR_BOWL_SOUP`：汤摊主看见受冻的玩家，递来半碗热汤。
- `E_FAM_LIFE_POOR_SHARE_WATER`：记得曾受过的热汤之恩，玩家给淋雨的赶路人分水。

### 富足

- `E_FAM_LIFE_RICH_CROWDED_ALONE`：席上宾客簇拥又不断请托，玩家的烦心事无人倾听。
- `E_FAM_LIFE_RICH_ECHO`：席间众人只顾附和，账房核对后才指出错账。
- `E_FAM_LIFE_RICH_EMPTY_TEA`：请客闲谈却又听到一席请托，自己的心事仍未说出口。
- `E_FAM_LIFE_RICH_CONFIDANT`：经历过富足时的孤独后，早年结交的朋友来访，双方终于能好好谈心。

## 新增 flag 生产者与用途

- `F_FAM_LIFE_EARLY_FRIEND`：由 `CHILD_NEIGHBOR_FRIEND` 或 `YOUNG_FELLOW_TRAVELER` 产生；供 `YOUNG_FRIEND_FAIR_PAY`、`ELDER_FRIEND_GONE`、`RICH_CONFIDANT` 使用，仅代表早年确曾结识朋友。
- `F_FAM_LIFE_TRAVELED`：由 `YOUNG_ON_THE_ROAD` 产生；供 `ELDER_ROAD_RECOLLECTION` 回望明确的驮队经历。
- `F_FAM_LIFE_MENDING`：由 `YOUNG_FIRST_WORK` 或 `MIDDLE_TRADING_PARTNER` 产生；供 `ELDER_MENDING_TAUGHT` 判断玩家曾实际缝补布袋。
- `F_FAM_LIFE_RICE_DEBT`：由 `MIDDLE_FAMILY_DEBT` 产生；`MIDDLE_REPAY_DEBT` 检查并移除，表示尚未结清的具体米账。
- `F_FAM_LIFE_FRIEND_LOST`：由 `ELDER_FRIEND_GONE` 产生；`RICH_CONFIDANT` 排除该状态，避免把已故朋友写作来访者。
- `F_FAM_LIFE_RECEIVED_SOUP`：由 `POOR_BOWL_SOUP` 产生；供 `POOR_SHARE_WATER` 回忆实际受过的帮助。
- `F_FAM_LIFE_RICH_LONELY`：由 `RICH_CROWDED_ALONE` 或 `RICH_EMPTY_TEA` 产生；供 `RICH_CONFIDANT` 回忆此前的独处经历，不宣称孤独永久持续。
- `F_FAM_LIFE_CHILD_FIREWOOD`、`F_FAM_LIFE_MENDING_TAUGHT`、`F_FAM_LIFE_GRANDCHILD_STORY`、`F_FAM_LIFE_CONFIDED` 分别由同名意图事件写入，作为添柴、传手艺、讲旧事、倾诉的历史记录，本批不以它们推断当前关系或其他状态。

上列生产者和使用者省略共同的事件前缀 `E_FAM_LIFE_`；本任务新增 flag 均使用 `F_FAM_LIFE_` 前缀。

## 跨任务依赖及边界

- `F_FAM_MARRIED` 由任务1生产，赊粮故事仅在婚姻仍存续时出现；还账不再提及伴侣，因此丧偶后仍可偿债。
- `F_FAM_GRANDCHILD` 由任务2的实际孙辈出生事件生产；任务2确认该标记永久保留且本次没有孙辈死亡事件。讲故事不声称孙辈的性别、年龄、理解能力或其父母仍在世。
- `F_LIFE_ROUTE_LIVELIHOOD` 是旧生产标记；少年首次领工钱限8–10岁且排除该谋生路线。旧内容并无覆盖全部赚钱叙事的统一标记，故不能据此证明整个旧池绝无此前领工钱的叙事。
- 早年朋友只可能在7–14岁或18–30岁建立，老友去世至少60岁；不会在少年或青年期出现。朋友离世为克制的告别，不以死亡充当温情奖励。
- 大病及其后果在同一事件中按因果呈现，不依赖不存在的既往病史。传手艺要求此前实际缝补，回望驮队要求此前实际随队出门；各后续受单年随机事件数量与既有高优先级池影响，不保证每局出现。
- 旧生产池本身仍有仅靠旧子女标记出现子女成事或孙辈的事件，无法从本任务保证整套旧家庭时间线无矛盾；遵照契约不修改旧对象。
