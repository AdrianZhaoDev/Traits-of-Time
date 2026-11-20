# 任务2交付说明

交付 `task2.events.json`：37 个顶层事件，全部为自动随机事件，不占剧情选择、不启动科举或其他事业链。出生、死亡及代际状态均以有限出生年龄组和单调 flag 表达；没有新增年戳或计数器。常规事件 priority 0，只有五世同堂这一前提极具体的一次性衔接事件使用 priority 1。

## 事件 ID 与意图

1. `E_FAM_CHILD_RECOGNIZE_LEGACY`：从旧有子女状态登记长子女，不叙述新出生，也不猜性别。
2. `E_FAM_CHILD_FIRST_BOY_EARLY_PLAIN`：18–26岁、家资不足3时迎来长子。
3. `E_FAM_CHILD_FIRST_BOY_EARLY_FEAST`：18–26岁、家资至少3时生长子，并在出生后的满月摆酒。
4. `E_FAM_CHILD_FIRST_GIRL_EARLY_PLAIN`：18–26岁、家资不足3时迎来长女。
5. `E_FAM_CHILD_FIRST_GIRL_EARLY_FEAST`：18–26岁、家资至少3时生长女并摆满月酒。
6. `E_FAM_CHILD_FIRST_BOY_LATE_PLAIN`：27–39岁、家资不足3时迎来长子。
7. `E_FAM_CHILD_FIRST_BOY_LATE_FEAST`：27–39岁、家资至少3时生长子并摆满月酒。
8. `E_FAM_CHILD_FIRST_GIRL_LATE_PLAIN`：27–39岁、家资不足3时迎来长女。
9. `E_FAM_CHILD_FIRST_GIRL_LATE_FEAST`：27–39岁、家资至少3时生长女并摆满月酒。
10. `E_FAM_CHILD_SECOND_GIRL_EARLY_WIFE`：18–26岁，已有存活长子时妻子生女儿。
11. `E_FAM_CHILD_SECOND_GIRL_EARLY_CONCUBINE`：18–26岁，已有嫡长子且妾在世时妾生女儿。
12. `E_FAM_CHILD_SECOND_BOY_EARLY_WIFE`：18–26岁，已有存活长女时妻子生儿子。
13. `E_FAM_CHILD_SECOND_BOY_EARLY_CONCUBINE`：18–26岁，已有嫡长女且妾在世时妾生儿子。
14. `E_FAM_CHILD_SECOND_GIRL_LATE_WIFE`：27–39岁，已有存活长子时妻子生女儿。
15. `E_FAM_CHILD_SECOND_GIRL_LATE_CONCUBINE`：27–39岁，已有嫡长子且妾在世时妾生女儿。
16. `E_FAM_CHILD_SECOND_BOY_LATE_WIFE`：27–39岁，已有存活长女时妻子生儿子。
17. `E_FAM_CHILD_SECOND_BOY_LATE_CONCUBINE`：27–39岁，已有嫡长女且妾在世时妾生儿子。
18. `E_FAM_CHILD_SECOND_LEGACY_EARLY`：18–26岁时旧池长子女已有登记，家中又添一孩，不推测两孩性别。
19. `E_FAM_CHILD_SECOND_LEGACY_LATE`：27–39岁时同样承接旧池长子女，家中又添一孩。
20. `E_FAM_CHILD_THIRD_EARLY`：18–26岁已有前两孩时迎来第三孩。
21. `E_FAM_CHILD_THIRD_LATE`：27–39岁已有前两孩时迎来第三孩。
22. `E_FAM_CHILD_SCHOOL`：家资允许且长子女至少七岁时请夫子开蒙，夫子提到乡里读书人盼着科考，不启动玩家的科举链。
23. `E_FAM_CHILD_MARRIAGE`：45岁以后为确实成年且存活的长子女办婚事，家资减1。
24. `E_FAM_CHILD_SUCCESS`：50岁以后，确实成年且存活的二孩运用你教的方法独自做成生意；家资加2、人脉加1。
25. `E_FAM_CHILD_SPENDTHRIFT_FIRST`：真实成年且存活的长子摆阔花过头，家资至少6时替他偿还，家资减2。
26. `E_FAM_CHILD_SPENDTHRIFT_SECOND`：真实成年且存活的二孩为儿子时，同样处理摆阔欠款。
27. `E_FAM_CHILD_INFANT_LOSS`：低权重罕见的新生儿夭折，克制表达遗憾，不写任何 flag。
28. `E_FAM_CHILD_BEREAVED_FIRST`：60岁以后失去成年长子女，记录具体死亡及丧子经历。
29. `E_FAM_CHILD_BEREAVED_SECOND`：60岁以后失去成年二孩，记录具体死亡及丧子经历。
30. `E_FAM_CHILD_BEREAVED_THIRD`：60岁以后失去成年三孩，记录具体死亡及丧子经历。
31. `E_FAM_CHILD_GRANDCHILD_EARLY`：已成家且存活的长子女有新生儿，玩家年龄至多50，记录孙辈出生组。
32. `E_FAM_CHILD_GRANDCHILD_MIDDLE`：同上，玩家年龄51–60，记录相应出生组。
33. `E_FAM_CHILD_GRANDCHILD_LATE`：同上，玩家年龄61–63，只记录真实孙辈，不生产五代所需的早出生组。
34. `E_FAM_CHILD_GREAT_GRANDCHILD_EARLY`：早组孙辈已成年，玩家68–75岁时见到真实新生曾孙辈。
35. `E_FAM_CHILD_GREAT_GRANDCHILD_LATE`：中组孙辈已成年，玩家78–80岁时见到真实新生曾孙辈。
36. `E_FAM_CHILD_FIVE_GENERATIONS`：曾孙辈已成年并新生玄孙辈，玩家与该存活子女、孙辈、曾孙辈及新生儿五代齐聚。
37. `E_FAM_CHILD_ENJOY_GRANDCHILD`：60岁以后，有第二孩里程碑和真实孙辈时陪伴孙辈，气数加1；文案适用于婴儿。

## 状态生产者和消费者

以下全名均以 `F_FAM_` 开头：

- `CHILD_1` 由首胎8个分支或旧子女认领事件生产；`CHILD_2` 由二胎10个分支生产；`CHILD_3` 由三胎2个分支生产。三者只记录出生，不是存活人数，永不移除。新首胎同时写已有旧池 `F_LIFE_HAS_CHILD`，并要求它尚不存在；旧池已有该标记则只认领已有孩子。
- `CHILD_1_BIRTH_18_26`、`CHILD_1_BIRTH_27_39` 由对应首胎分支生产，`CHILD_1_BIRTH_LEGACY` 由旧子女认领生产；`CHILD_2_BIRTH_18_26` / `CHILD_2_BIRTH_27_39` 由各二胎分支生产；`CHILD_3_BIRTH_18_26` / `CHILD_3_BIRTH_27_39` 由各三胎分支生产。各孩子只属于一个组，供年龄下界计算和任务3读取。
- `CHILD_1_BOY` / `CHILD_1_GIRL` 由对应新首胎分支互斥生产；`CHILD_1_LEGITIMATE` 只由明写妻子生育的新首胎生产。四个妾生二胎分支要求这个嫡出事实与当前 `F_FAM_MAR_CONCUBINE_ALIVE`，并生产 `CHILD_2_CONCUBINE_BORN`。任务3可据此分别证明嫡出、妾生，但仍须检查两个孩子各自成年与存活。
- `CHILD_SON_AND_DAUGHTER` 只由首胎已知性别且二胎为异性的8个分支生产；任务5的儿女双全成就还应同时要求 `CHILD_2`。旧池认领无法辨别先前性别，故其二胎不生产此事实。
- `CHILD_SCHOOLED` 由长子女开蒙生产；`CHILD_MARRIED` 由长子女成年婚嫁生产，记录历史；`CHILD_SUCCESS` 由存活成年二孩的成功事件生产。若用成功事实证明眼下有继承人，须另检查 `not CHILD_2_DEAD`。
- `CHILD_1_DEAD`、`CHILD_2_DEAD`、`CHILD_3_DEAD` 分别由对应的成年子女死亡事件生产，并同时生产永久 `CHILD_BEREAVED`；三条死亡分支互斥、各自 rare、weight 2、最多一次，均不改人脉。凡正文涉及现存子女，检查对应 `not CHILD_n_DEAD`，不重置出生事实或将亡者当作重新出生。`CHILD_SPENDTHRIFT` 由两个亏空分支之一生产，避免两条都发生。
- `GRANDCHILD` 由三条真实孙辈出生事件生产，代表已出生且在本批模型中仍活着的、长子女所生孙辈；本批没有孙辈死亡事件。`CHILD_GRANDCHILD_BIRTH_LE50`、`CHILD_GRANDCHILD_BIRTH_51_60` 分别由早、中组出生事件生产，供曾孙辈年龄推导；晚组只记录真实孙辈。`CHILD_GRANDCHILD_ENJOYED` 由陪伴事件生产，防止重复收益。
- `CHILD_GREAT_BIRTH_LE75` / `CHILD_GREAT_BIRTH_LE80` 分别由两条真实曾孙辈出生事件生产；`FIVE_GENERATIONS` 只由玄孙辈实际出生并五代相聚的事件生产。五代事件排除 `CHILD_1_DEAD`，但不因其他子女死亡而误排除；孙辈和曾孙辈本批没有死亡事件。陪孙辈也不要求已故的长子女复活。
- 外部依赖：任务1生产 `F_FAM_MARRIED` 和 `F_FAM_MAR_CONCUBINE_ALIVE`；后者是当前在世，不是只代表历史的 `F_FAM_CONCUBINE`。旧池生产并消费 `F_LIFE_HAS_CHILD`，任务2仅在新首胎同步添加，不清除。

## 时间和边界

- 新孩子只在玩家18–26或27–39岁出生；若一个孩子在该组最晚上界出生，成年18岁对应玩家至少44或57岁。旧出生事件允许最晚40岁，旧孩子成年保守使用58岁。每年随机上限为一次，故一二三胎不会在同一个随机年度各出生一次。
- 开蒙要求孩子保守至少7岁：对应玩家年龄33、46或旧组47；没有将新生儿写成求学或成年人。二孩成功和两个亏空分支核对各自组别及存活；三种成年子女死亡在玩家至少60岁时才发生，而被追踪子女最晚在玩家40岁时出生。
- 满月酒不是游离多年后的随机事件：直接整合在新首胎的家资至少3分支中，从出生到满月同一叙事结算，人脉加1；家资0–2有完整生育分支，不需要支付办酒家资。
- 长子女成年成家后才有孙辈出生；出生分成不晚于50、51–60、61–63三个玩家年龄段，只有前两段另记用于推导曾孙出生年龄的 flag。陪伴文案适用于婴儿，不写孙辈自行跑动或吃点心；玩家至少60岁且真实出生事件已发生后才能触发。孙辈出生至多到玩家63岁，避免把年迈的长子女无条件写成新生儿父母。
- 早组孙辈最晚在50岁时出生，玩家68–75岁时至少18岁；此后曾孙辈最晚在75岁时出生，玩家93岁起至少18岁。中组孙辈最晚在60岁时出生，玩家78–80岁时至少18岁；曾孙辈最晚在80岁时出生，玩家98岁起至少18岁。示例可达顺序：玩家22岁生长子女、23岁生二孩、45岁孩子成婚、46岁孙辈出生、68岁曾孙辈出生、93岁玄孙辈出生并五代齐聚。其他第三组孙辈不虚构后代，也不因此自动授予五代。寿命上限105岁内存在完整路径，但实际随机调度是否出现需验收。
- 新生儿夭折事件不写 flag，也不占三个受追踪出生里程碑；后续可出生的新孩子是另一个孩子。每条分支最多发生一次，且死亡事件不删出生里程碑。
- 旧 `E_LIFE_CHILD_MISCHIEF`、`E_LIFE_CHILD_SUCCESS` 和 `E_LIFE_SENIOR_GRANDCHILD` 自身没有足够的出生时间或存活状态，旧池可能早报成长或孙辈；本任务不能改旧条目，因此不能声称整个生产池已经消除此既有问题。保留旧 `F_LIFE_HAS_CHILD` 是为了不抹去旧池历史成就，极少数丧子后旧孙辈事件也可能仍被旧条件调度，不能把它当成本批 `F_FAM_GRANDCHILD` 的生产者。

未运行测试、构建、lint 或格式化；交由任务6及父代理合并后统一验收。
