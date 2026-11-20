# 家庭内容合并验收报告

## 结论

**最终授权修复后验收通过：validate、完整 npm test、四JSON jq、授权例外审计均退出0；139项测试全部通过。** 家庭追加92事件、12成就、5死因、0链，新增重大选择0。首次400局曾发现29局旧选择预算超限；用户随后明确授权最小旧内容修复，父代理修改21旧事件、3链承诺文案及1成就短评，最终400局均在1–5次范围内。不能再称全包仅append-only：家庭仍仅追加，旧对象变更严格按例外清单审计。未放宽断言、修改引擎、增加依赖或改lockfile。下方“首次”各节保留失败过程，最终结果以本节及末尾复验记录为准。

## 首次实测命令与原始证据（预算修复前）

父代理明确通知生产合并完成后执行：

1. `npm run validate:content -- --content assets/resources/data/ming_end`：退出0，`issues:0`。完整输出 `validate-output.txt`。
   - `sha256Json=5e66783576abd7d895b95d66bb4022ddfab6ef709a171c11c3d51c3a74555c0f`
   - `StaticContentLoader fingerprint matches`
   - events448、chains22、achievements137、deaths36。
2. `npm test`：首轮123项、122通过、1失败；在normal seed16发现6次选择。原始输出 `test-output.txt`。
3. 修正测试诊断方式：不在第一局越界时停止，完成全部400局后统一断言，**不改变1–5次要求、不减少样本**。再次 `npm test`：退出1，123项、122通过、1失败、0跳过；总耗时48591.780449ms。完整日志与29局逐条event/age/option在 `test-output-complete.txt`。
4. `jq empty assets/resources/data/ming_end/{events,chains,achievements,deaths}.json`：退出0，无输出，完整四JSON合法。
5. `node --import ./tools/register-typescript.mjs local/family-content/audit-family-content.mjs`：退出0；`audit-output.json`含完整追加ID、全部92事件字段/trigger/condition/outcome/stages，以及基线与前缀哈希；`audit-error.txt`为空。
6. 额外最小诊断：加载四份基线数组、真实GameEngine、normal seed16，完整人生仍有6次选择。结果 `baseline-seed16-output.txt`。此为定位旧缺陷，不是改写生产或伪造通过。

## 追加数量与原对象不变证明

|数组|基线|生产|追加|
|---|---:|---:|---:|
|events|356|448|92|
|chains|22|22|0|
|achievements|125|137|12|
|deaths|31|36|5|

92事件分任务18+37+9+23+5。审计对每个数组执行 Node `assert.deepEqual(production.slice(0, baseline.length), baseline)`，不仅比较数量或ID。基线哈希与生产前缀哈希逐项相等：

- events：`653f84f40ccf356caac8f58c8870fd8efbf45b720faf72a695a88e6a841e1076`
- chains：`e66dc693217dc26cec7292382a26908691a283ef5241d797a80d416528142dac`
- achievements：`c8ad27476342d5ec26fb182b391b08118595e6f0675d4f909b459b5af8b84d92`
- deaths：`f32b9ed25648fa364ae327428a975a4a1d968df46c036f8025acfb76e9d49802`

完整ID清单见 `audit-output.json` 的 `arrays.events.ids`、`arrays.achievements.ids`、`arrays.deaths.ids`，以及各task notes。新增成就ID：A_FAM_HOME_AND_CAREER、A_FAM_SON_AND_DAUGHTER、A_FAM_FIVE_GENERATIONS、A_FAM_CHILD_WELL_TAUGHT、A_FAM_HIGH_MARRIAGE、A_FAM_REMARRIED、A_FAM_GRANDCHILD、A_FAM_HEIR、A_FAM_HEIRLESS、A_FAM_BEREAVED_CHILD、A_FAM_CHILD_MARRIED、A_FAM_LIFE_TOGETHER。死因ID：D_FAM_END_OLD_AGE、D_FAM_END_HOUSE_FIRE、D_FAM_END_OVERWORK、D_FAM_END_CLAN_CROSS_FIRE、D_FAM_END_FAMILY_SHELTER。

## 字段、ID及引用审计

通过的正式测试覆盖：

- 新顶层E/A/D_FAM ID对所有生产顶层集合及时代identity/background/injury无撞名；stage ID按事件内局部作用域校验，所有next_stage_id指向真实本事件stage。
- 所有92事件都是automatic、random，有完整trigger与顶层outcome，无新增choice、无chain_start、无写入或读取两项重大选择消费flag。**家庭重大选择新增0**，chains追加0。
- 所有新F_FAM条件读取都有生产flag_add生产者；不把旧池既存孤立flag误报为新增错误。此静态闭合不等于所有组合能在自然人生中实现，另有实际引擎行为测试。
- ContentValidator全包结构与语义校验通过：chain/death/identity等引用均存在，新增5死因均有事件实际引用。
- 92事件条件op、compare字段、effect词表、trigger必填字段全查；不是仅抽3条。

逐字段说明示例：

1. `E_FAM_MAR_BETROTHAL_SHORT`：id/title/text分别标识、标题、聘礼不足遭遇；condition要求成年、wealth<2、已说合且新旧婚姻均不存在、无丧偶史；trigger为现有random完整配置；interaction=automatic；outcome确实写亲事告吹，remove MATCHED、add BETROTHAL_FAILED，next_stage_id=null。后续另议事件真实消费FAILED，不把失败伪装成功。
2. `E_FAM_CHILD_FIRST_BOY_EARLY_PLAIN`：condition要求age18–26、wealth<=2、当前已婚、无新旧首胎里程碑；outcome同步旧HAS_CHILD、新CHILD_1、已知男性、嫡出与18–26出生组；无选择、无事业链、无局外年份字段。成年后续由组上界26+18计算安全阈值。
3. `E_FAM_END_HOUSE_FIRE`：condition要求成年、低体魄、当前已婚；低权重rare随机触发；outcome进入真实逃生stage；失败进入救援stage，最终救援失败才执行真实death effect，成功路径不伪装死亡。stage.check与success/failure均交真实D20引擎处理。

## 真实引擎回归覆盖

- 全部92新增生产事件保留实际condition/effects/stages与概率，使用真实GameEngine和scheduler，在隔离竞争的针对性初始状态下实际触发；不只检字段。
- 全生产池wealth0/1/6/12/20调度均能选到家庭事件；priority过滤、概率0、次数限制、包含当前年的冷却、原年度随机上限1均有回归。
- 财富0–20每档真实经历说合→下聘或失败另议→婚礼；旧婚姻认领、新旧婚姻同步、丧偶删除两种当前婚姻、续弦保留丧偶历史及排除原岳家反噬。
- 旧子女认领不重生首胎、不猜性别；新出生同步旧flag；26/39岁出生次年不能成年成婚；legacy成年保守58岁；子女死亡保留出生里程碑并阻止重复死亡和该活子女婚嫁。
- 真实跨年单局首胎、二胎、长子女婚嫁、孙辈出生、曾孙出生、玄孙出生链达到五代；逐代实际年龄间隔>=18，最终在93岁以上、105岁寿命前达到；70岁+两个出生里程碑不能冒领。
- 晚出生孙辈须先有真实出生，陪伴正文已改为婴儿也适用，不再强加未获批准的五岁门槛。
- 分家要求真实成年活子女及财富门槛；婴儿夭折不凭空授予三个存活子女里程碑。
- 实际D20种子覆盖成功/失败/自然1/自然20与分支effects；自动事件无option日志；死亡只结束一次，结束后拒绝nextYear；成就不提前结束人生、终局类成就按当前条件判定。

## 400局自然人生结果与失败定位

四策略均使用种子0–99；normal选首个可用选项、cautious按safe/normal/high取低风险、risky取高风险、career优先选直接chain_start，否则首个。策略不是最优AI；normal与career本批结果相同。

|策略|局数|选择min/max|P50/P90|<40岁死亡|家庭事件数|超5局数|
|---|---:|---|---|---:|---:|---:|
|normal|100|1/7|4/5|19|717|10|
|cautious|100|1/6|4/5|18|754|7|
|risky|100|1/7|4/5|25|631|2|
|career|100|1/7|4/5|19|717|10|
四组家庭选择次数全部为0，每局均正常走到一次死亡。死因分布完整记录在输出diagnostic；自然400局没有观察到新D_FAM死因，不能据此声称这些罕见死因的自然发生率已估准。针对性测试实际触发全部新事件，通用D20覆盖成功/失败/自然1/20，但未穷举每个新增死亡事件的全部连续救援失败组合；新死因引用闭合不等于每个死因已在自然人生中观测。

第一个失败normal seed16：60岁E_START_IMPERIAL_EXAM；61岁E_MOD_HEALER_NODE_1；63岁E_MOD_HEALER_NODE_2；64岁E_CHAIN_IMPERIAL_EXAM_4及E_HIST_1645_YANGZHOU_FATE；66岁E_MOD_HEALER_NODE_3，共6次。全部29局越界中的choice ID都存在于基线。基线seed16同为6次，仅开局/事业终点换为FORTRESS_DEFENSE，其余医者与历史选择相同。根因是旧现代内容多个节点仍为choice，可与原开局、事业终点及历史选项累加；新增家庭没有直接新增菜单，但加入随机池改变了既有抽样轨迹。

失败定位：首轮 `tests/engine.test.mjs:116`；聚合断言 `tests/engine.test.mjs:132`。当时复现入口 `npm test`。随后用户授权最小旧内容例外，父代理修复后同一预算断言通过；没有删除断言、缩小种子或把现代选择排除计数。

## 人工文案与敏感词审查

自动对所有新增事件、成就、死因扫描契约禁止词，通过。人工读取婚姻遭遇和结果，复核最终失败另议版本：不将聘礼失败写成成功；高门和纳妾交代双方商议与现实开销，不含情色或物化措辞；贫婚从简不嘲笑贫困。人工读取5死因及全部致死stage成功/失败正文：无血腥细节、无死亡笑话；火灾、误伤、梁架倒塌属于突发遭遇，非强迫主动冒险；病重/救援先有实际求治，失败克制叙述。也复核子女挥霍与普通经营失败区分、晚生孙辈通用陪伴文案。

## 限制与未验证项

- 最终139项全通过，但自然400局只选择每局首张offer，不等于全部卡牌、起点、选项及组合穷举；另有三词条九组受控场景及全池预算结构检查。
- 旧E_LIFE_CHILD_MISCHIEF/SUCCESS/SENIOR_GRANDCHILD没有出生年精确门槛；旧HAS_CHILD在丧子后仍可能产生旧活子女/孙辈叙述。本次预算例外未改这些对象，不能宣称全生产家庭时间线彻底无矛盾。
- 家庭flag闭合、隔离事件见证和定向五代轨迹不意味着所有组合自然高概率可达。五代是罕见长寿路径。
- 未实测真人游玩时长、微信设备或UI视觉；本次纯内容与CLI范围，无相关通过声明。自动关键词不是平台审核保证。
- 当前环境无可用LSP，按父代理确认使用源码与声明读取。
- 永久npm test从生产加载，不依赖local片段或基线；append-only审计为本次local专用。未运行构建/lint/typecheck冒充行为校验。

## 最终授权预算修复与复验

用户明确授权“最小范围修改旧选择机制或旧内容，修复原有1–5预算漏洞并重新验证”。父代理仅整合预算内容；验收代理未修改生产引擎或测试标准。

### 最终命令实测

- `npm run validate:content -- --content assets/resources/data/ming_end`：退出0，issues0；完整输出 `validate-budget-output.txt`。
- 完整bundle指纹：`5b266872c2dc865c367bc5a6b9f4766291e3ec76994a3fc01ecb7d6bd700b48d`，StaticContentLoader一致。
- `npm test`：退出0，**139 tests / 139 pass / 0 fail / 0 skipped**，耗时52163.935927ms；原始输出 `test-budget-output.txt`。
- `jq empty assets/resources/data/ming_end/{events,chains,achievements,deaths}.json`：退出0。
- `node --import ./tools/register-typescript.mjs local/family-content/audit-family-content.mjs`：退出0，结果 `audit-budget-output.json`，错误文件 `audit-budget-error.txt` 为空。

### 授权例外与不变证明

例外来源 `budget-exceptions.json`，每个旧ID有明确理由。审计保留旧ID与次序；对非白名单仍逐对象deepEqual；白名单若未实际变化也会失败。每个例外的JSON Pointer及before/after原值全部写入 `audit-budget-output.json` 的 `arrays.*.changed[].differences`，不是仅列ID或跳过差异。

- events：356旧对象中**335完全不变，21授权修改**；仍追加92家庭事件，生产448。
- chains：22旧对象中**19完全不变，3仅 `/commitment` 变化**；无新增链。
- achievements：125旧对象中**124完全不变，1仅 `/text` 变化**；仍追加12，生产137。
- deaths：31旧对象**全部不变**；追加5，生产36。

21旧事件为三组各7：CORN的TRIAL/STORE/RELIEF/FAST_INVENTORY/FAST_DISTRIBUTE/FAST_ESCORT/BREAKTHROUGH；HEALER的NODE_1/NODE_2/NODE_3/FAST_1/FAST_2/FAST_3/BREAKTHROUGH；FLASHLIGHT的EVIDENCE/PATROL/ESCORT/FAST_FRAUD/FAST_ROTA/FAST_EXIT/BREAKTHROUGH，均冠 `E_MOD_` 前缀。三链为 `CHAIN_MOD_CORN_KING`、`CHAIN_MOD_HEALER_SAGE`、`CHAIN_MOD_FLASHLIGHT_DETECTIVE`。成就为 `A_MOD_FLASHLIGHT_DEATH_ROBBERY`，修正危险迁至完成主链之后的短评时间事实。

非例外旧对象前后哈希相等：events `5453b24267e9a784da85fa756ff0b21c91618ad6a34f8bee26d3eab8f9b78152`；chains `752abce37c93c05b3ae74ea9bb01d912aca58e3bd120604a582a81fa9d87bcef`；achievements `7ee8049d541bf5c3fe8b705f4262da609d5d524201180ecddd3eb548837bb94a`；deaths `f32b9ed25648fa364ae327428a975a4a1d968df46c036f8025acfb76e9d49802`。预算前全前缀不变证据仍作为历史记录保留，不能误作最终全前缀相等。

### 预算结构与真实迁移场景

新增16项测试全部通过：

- 三词条×1634正常／1643快进／1644快进，共9组真实GameEngine场景。每条线路恰好3个进展，无中途菜单；快进没有执行普通链节点，避免1643开局重复领成长。
- 所有可用突破选项实际分支恢复执行：在任何骰子阶段前消费HISTORICAL共同名额；消费后其他同预算菜单均被条件阻断；已消费额度的开局场景不会弹突破。
- 三组迁移危险死亡结果均通过真实种子和显式选项实际触发；自动进展不强迫致死风险。此项针对现代预算迁移，不表示所有家庭罕见死因已穷举。
- 整板药自动进展后仍在；只有显式use_course才AVAILABLE→USED，交药前后属性相等，避免再发自动已给的成长。
- 全18进展节点为automatic；所有三突破option阶段前消费共同额度；所有生产random/historical choice受DIRECTION或HISTORICAL门禁且先消费；chain choice只在末节点。
- 一次审计确认三条旧线共60项独立flag_add/death/ending_unlock生产结果均保留；危险路径另由上述真实引擎测试证实。

### 最终400局统计

|策略|局数|选择min/max|P50/P90|<40岁死亡|家庭事件数|超5局数|
|---|---:|---|---|---:|---:|---:|
|normal|100|1/5|3/4|16|744|0|
|cautious|100|1/4|3/4|17|780|0|
|risky|100|1/5|4/5|14|793|0|
|career|100|1/5|3/4|16|744|0|

每局仍选首张offer；策略与种子0–99未缩减。400局均有1–5次成功重大选择，家庭choice日志为0，均正常走到一次死亡。死因完整分布见最终测试diagnostic。未观察到新D_FAM自然死因，罕见概率与真人时长仍不作过度结论。
