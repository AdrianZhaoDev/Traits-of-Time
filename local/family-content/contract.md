# 本次家庭内容任务共同契约
用户要求按提示词1–6分别派子代理，追加生产内容；严禁改旧条目。生产路径 assets/resources/data/ming_end。父代理负责唯一合并。子代理只写自己 local/family-content 下的新增交付文件，验收代理另拥有测试/校验入口。

## 已确认决策
用户已通过表单明确选择：所有家庭事件 automatic（包括高门联姻、纳妾、求官、接济），保留原有每局1–5次选择预算。不加 choice、不用 F_LIFE_DIRECTION_TURN_USED / F_LIFE_HISTORICAL_TURN_USED，不新启事业链，不改引擎、不改旧生产对象。chains.json 本次预计0追加。
已查生产目录没有 E_FAM_/F_FAM_/A_FAM_/D_FAM_，不得撞其他子任务ID。根 package.json 缺validate:content/test；有ajv、esbuild、typescript，无vitest。基线已保存在 local/family-content/baseline/ 四文件。

## Schema/工具
先读 skill://era-architect 与 Doc/文案设计与风格规范.md。自动事件用现有顶层 outcome:{text,effects,next_stage_id:null或真实stageID}；不能只写顶层effects。所有事件含id,title,text,condition,trigger,interaction,outcome，trigger完整写 kind:random,weight,priority,trigger_probability,cooldown_years,max_occurrences,rare。可用stages真实D20分支。
条件仅all/any/not/compare/has/is，字段age/calendar_year/start_year/intelligence/wealth/physique/prestige/luck；集合flags/cards/active_chains/completed_chains/injuries。effects仅flag_add/flag_remove/attribute_add/chain_start/identity_set/death/ending_unlock。属性范围0–20。无数量或年戳字段可增加。
必须先查已有引用再用。flags可新建，但所有条件使用的新flag要有可达生产者。各任务新flag除下述共享契约外带自己的编号范围标记以免碰撞（例如 F_FAM_LIFE_*）。所有新增event顶层id全局唯一；option/stage也用唯一前缀。
已有链 CHAIN_IMPERIAL_EXAM、CHAIN_MILITARY_MERIT、CHAIN_FIREARMS_RESEARCH、CHAIN_EPIDEMIC_HEALING、CHAIN_FORTRESS_DEFENSE、CHAIN_MARITIME_TRADE、CH_WORKSHOP、CH_JN_EXAM、CH_JN_TRADE、CH_gm_arms、CH_gm_water、CH_gm_fort、CH_MENTOR、CH_STUDY。读书孩子不启玩家的科举链。
每个任务不得运行build/lint/tests/formatters。统一完工后验收代理运行一次全套；允许只读数据探索。文件新建write，已有文件修改必须edit。不得用脚本改文件。不得用minimal reasoning。

## 跨任务flag契约（生产者只在指定任务）
任务1婚姻生产 F_FAM_MARRIED（当前婚姻），F_FAM_WIDOWED（曾丧偶，永久历史），F_FAM_REMARRIED（续弦事实），F_FAM_HIGH_MARRIAGE（曾高门联姻），F_FAM_CONCUBINE（曾纳妾）。丧偶必须remove MARRIED；续弦必须not MARRIED且WIDOWED，add MARRIED/REMARRIED；普通初婚排除WIDOWED。WIDOWED不可清除。高门反噬要求当前MARRIED且not WIDOWED，以免岳家在续弦后串线。婚礼穷/中/富条件覆盖wealth所有段。F_FAM_CONCUBINE只记录历史，不用于宣称仍有妾在世。
任务2子女生产 F_FAM_CHILD_1/2/3（出生里程碑，不等于存活人数，永不移除）、F_FAM_CHILD_SCHOOLED、F_FAM_CHILD_MARRIED、F_FAM_CHILD_SUCCESS、F_FAM_GRANDCHILD、F_FAM_FIVE_GENERATIONS、F_FAM_CHILD_BEREAVED。若提及当前活着的某子女必须检查自己定义的子女死亡flag；长幼/性别/年龄/死亡不能矛盾。五世同堂绝不能仅age>=70+CHILD_2即授予，必须真实五代事件并有时间门槛/存活家庭前提。夭折事件不加出生里程碑，不计作已出生的三个孩子；避免重复死亡。用有界生育年龄段/出生年龄组flag＋成长年龄阈值保证不会刚出生次年成人。具体时间方案自己设计，交付解释。
任务3高位生产 F_FAM_HEIRLESS（只作经历；后继无人成就仍需当前无CHILD_1）、F_FAM_ESTATE_SETTLED。其他子女状态读取任务2共享flag；分家须年龄>=55、CHILD_2且真实成年，财富不够不能强行分巨产。所有事件额外限制wealth>=6或prestige>=6（单独要求更高时照旧）。
任务4个人人生仅生产 F_FAM_LIFE_*。有子孙/妻子/老友等具体前提必须有合理flag/年龄支撑。
任务5成就读取上述flag；新增A_FAM_*与D_FAM_*。如为新增死因接入触发，另交 task5.events.json，事件用 E_FAM_END_*；低权重rare、体魄等真实严苛门槛，不提高日常失败致死率，不自动强迫玩家选择危险主动行为。所有死亡由事件引用，不能空定义不落地。

## 文案
普通15–35字、重大25–50字为软目标，自然现代中文明末生活。正文遭遇/结果实际后果，避免重复；不批量段子。婚姻不物化，无情色；贫穷不嘲笑、死亡不戏谑；禁起义/造反/称帝/妖道/血祭/民族蔑称，不发明现代物品。落点诚信、持家、教子、济邻。

## 交付
对应 taskN.events.json / task5.achievements.json / task5.deaths.json 为合法对象数组，可原样拼接。对应 taskN.notes.md 列全部新增顶层id，每事件一句意图，全新flags生产者/用途及跨任务依赖，数目，边界设计。不要输出生成Python脚本、伪代码或假通过。不要修改生产文件。父代理统一追加并审阅，任务6负责真实校验与测试。
