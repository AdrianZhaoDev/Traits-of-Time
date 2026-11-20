# 后期人生独立验收交接

## candidate-04 设计实验冻结结论

最新证据：`local/late-life-experiments/candidate-04`，SHA256SUMS/CAPTURE保留。同seed0–99四策略400局已完成：固定全局active P90四策略均4；whole P90=19；旧gap P90=3；LL专用whole/active=25/4；成功剧情选择1–5；窗口逾期0；早死55/400。全局对照baseline40/23→01 21/11→02 22/6→03 20/5→04 19/4（whole/active）。这不是全人生gap<=4，也不是suite或Canvas通过。

04 `results/gap-clusters.json`剩4例>6：normal/cautious seed22死亡前后续未兑现（7年截尾）；normal28与cautious76原伴侣已去世，改为独自清点共同凭据（8/7年，不计共同事项成功）。这些不靠强行好事/缩寿消除。

04 `results/trajectories.json`有自然富贵、困顿、清贫有名、幼年+9、事业中断、长寿六类完整年表。04 `results/focused-trajectories.json`另保存normal0/2/28/39/45及cautious76完整逐年正文/效果：normal0普通、normal2困顿、normal39权势取水路/农具工序成果、normal45配送待遇、normal28财富5体弱照料及丧偶承接和后期财富6照料、cautious76事业中断仍保留图纸成果。所有source均明确自然seed；03同名文件仅是历史佐证。

工具与回归冻结供独立tester验证；后续只按其真实失败修复，不另跑全套重复验收。下文candidate03描述是保留的历史诊断，候选就绪状态以本节为准。

04六卡各3局career、seed27–29条件实验亦已完成，输出`results/target-CARD_*.jsonl`，不作为自然抽卡概率。上述均为设计仿真实验，不是测试套件通过。

最终验收曾因默认测试发现递归扫描local快照、并发资源污染而中断首份400产物（128完整行+第129截尾，无summary）。该产物不得当成功；保留故障证据。工具修复后仅写`.jsonl.partial`，同步逐行写并在结束时fsync，全部人生及summary成功后才发布`.jsonl`；失败非0且不发布完整名。Core负责释放资源后新out重跑400。新增成功/注入写入失败消费者回归在`tests/simulation.test.mjs`，Evidence未自行运行。

## 状态与证据

- 最后已测候选：`local/late-life-experiments/candidate-03`，不是最终冻结版；candidate-04待Stories通知。
- 原始基线：`local/late-life-baseline/20261117T094505Z`。含UTC、源码/内容/tools/tests、必要依赖与SHA256清单。禁止覆盖。
- baseline `results/original.jsonl`是原工具400局；`results/evidence.jsonl`为同引擎增强证据。`comparability.json`记录400局全部旧字段一致。
- candidate-01/02/03均隔离源码和内容，固定seed0–99、normal/cautious/risky/career各100；各`results/four-strategies.jsonl`保存逐命令前后状态与日志，文件较大，须逐行读。
- Evidence未运行测试套件、lint、typecheck、构建或Canvas验收；不得把设计仿真当完整通过。

## 最终tester命令

从冻结后的工作区运行，输出名必须唯一（工具拒绝覆盖）：

```bash
npm run validate:content -- --content assets/resources/data/ming_end
npm test
npm run typecheck
npm run build
npm run build:wechat
node --import ./tools/register-typescript.mjs tools/simulate.ts --root . --samples 100 --seed-start 0 --out local/late-life-final/four-strategies
node --import ./tools/register-typescript.mjs tools/report-late-life.ts local/late-life-final/four-strategies.jsonl tools/late-life-causal-mapping.json local/late-life-final/ll-causal.json
node --import ./tools/register-typescript.mjs tools/report-global-progress.ts local/late-life-final/four-strategies.jsonl tools/late-life-causal-mapping.json local/late-life-final/global-progress.json
node tools/late-life-trajectories.mjs local/late-life-final/four-strategies.jsonl local/late-life-final/trajectories.json
node tools/cluster-late-life-gaps.mjs local/late-life-final/four-strategies.jsonl local/late-life-final/global-progress.json local/late-life-final/gap-clusters.json
```

六卡条件场景（不当自然概率）：

```bash
for card in CARD_MODERN_CORN CARD_MODERN_ANTIBIOTIC CARD_MODERN_FLASHLIGHT CARD_MODERN_CALCULATOR CARD_MODERN_GLUE CARD_MODERN_LIGHTER; do
  node --import ./tools/register-typescript.mjs tools/simulate.ts --root . --samples 3 --seed-start 27 --strategy career --target-card "$card" --out "local/late-life-final/target-$card"
done
```

仅定位回归可用（不替代完整npm test）：

```bash
node --import ./tools/register-typescript.mjs --test tests/late-life-runtime.test.mjs tests/late-life-content.test.mjs tests/simulation.test.mjs
```

Web和微信实际Canvas须最终tester另行启动/操作，检查正文、选项等待、暂停恢复、逐年记录、路线呈现与结束结算。未有微信运行设备证据不得称微信实际体验通过。

## 三套统计不可互换

1. 旧metrics保持原语义：属性/身份/地点/伤病/成就/非预算flags/事业状态变化。会计入新flag，因此旧gap变好不充分说明真实体验改善。
2. `report-late-life.ts`是新增LL因果安排专用：明确安排与后续实际兑现成对，首次distinct arrangement计建立与兑现年。重复安排、单独flag/加1不算。这个whole不是全人生无实质进展；未映射的原生家庭/事业可能有发展。
3. `report-global-progress.ts`固定全局诊断：LL兑现对+实际家庭里程碑allowlist、身份转换、事业完成/中断；中断单列损失而非成功。排除死亡本身、generic flags、奖章、重复属性和仅文案。家庭名单见`tools/late-life-global-progress.ts`。三版离线同算结果保留。

全局active分析切片：第10年开始，至同时满足elapsed>=19与age>=55之前；baseline用同一分析边界，不声称旧版已有settlement功能。whole保留全部后期年，不用切片遮蔽长寿维护。死亡前未兑现仍保留在分母并单列截尾。状态进展不充分等同爽/惨，实际文本须人工读。

已测全局whole/active P90：baseline40/23，01为21/11，02为22/6，03为20/5。03旧gap P90=3，LL专用whole/active=28/5。不能把某套数值冒称另一套达标。

## Fixtures与恢复

`tests/late-life-content.test.mjs`包含：
- 六卡真实完整人生；连续年份、显式选择1–5、事件实例不重复。
- 年龄3/30/65可控开局，保存恢复后相同命令结果一致，重复命令不可再次施加效果；无自动代选。
- 富有有权/富无权/权无财/清贫有名/失利无业/贫困体弱/普通路线，消费者`updateLateLife`断言。
- 财富波动不抖动，持续丧失财富按确认年数换线，成果保留。
- 旧友与无人脉的`follow_up`候选差异及最迟后备。
- 中断事业逐年长寿阶段和成果保留。
- 自动后续无新增直接致死/缩寿，因果映射真实引用。

这些是未运行的回归，不是通过声明；最终tester须诊断失败，不删除正确断言换绿。
Runtime拥有`tests/late-life-runtime.test.mjs`，具体窗口/预算/存档版本回归以该文件为准。旧人生save_version5→6、rules3→4明确不兼容，不篡内容指纹绕过。

## 必读真实年表

candidate03 `results/trajectories.json`：富贵、贫困、清贫有名、少年+9、事业中断、长寿六类自然seed，source明确natural。
`results/focused-trajectories.json`：
- normal39：族老财富7，1669取水路协调→1672修通，1675早年工序图→1678学徒采用；核查权势适配、集体署功、无自动大额扣款。
- normal45：1664约个人时辰配送→1667送到；与旧留货不同，不凭标签计新待遇。
- normal28：1682既有丧偶后独自整理共同凭据；1721富足体弱预约照料→1725按单准时送达。较早财富5/体1落CARE_OTHER是已报待04修点。
- cautious18/76：事业中断但真实早年手艺仍可被采用，不强制翻身。

03 `results/gap-clusters.json`列7人8段>6；两段死亡截尾、两段丧偶、一个恢复变化、一个无事业、两个CARE维护。`gap-five-six.json`列28个5–6年段，其中11个CARE_OTHER。聚类是非互斥观察，不是反事实准入证明。

## 风险与停止条件

- candidate04尚未测，不能提前冻结或称目标通过。
- whole长尾须分真实因果变化/损失/重复维护，不能逼老人每4年凭空开新事业。
- 报成功成长与真实损失时分栏；既有死亡后的承接不是本轮新增致死，也不是成功。
- baseline类别剩余122人中48仅是年度末样本未找到匹配入口，不是39.34%入口bug率；不可强发菜单。
- 早死对照保留新增/避免配对，不只净值。03为55/400，02相同；01为52，baseline49。前期转向入口改变候选池，不能用后期未触发解释全部产品风险。
