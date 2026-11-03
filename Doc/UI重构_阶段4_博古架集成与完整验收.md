# UI 重构 - 阶段 4：博古架集成与完整验收

## 目标
1. 构建右侧常驻竖向博古架组件 `RelicBarController.ts`：
   - 收集传家宝与珍贵词条（如“传家之宝”锁子甲、“万家生佛”等）。
   - 实现词条生成时印章飞入博古架插槽的平滑曲线动画。
   - 点击博古架图标展示微缩传家宝溯源详情。
2. 整合 `GameMain.ts`：
   - 将 `LogParser`、`EventFoldItem`、`UIAnimController`、`MemorialCard`、`RelicBarController`、`EnumMapper` 全部织入主流程。
   - 顶部 HUD 显示汉化身份、地区、阶层。
   - 底部实现青铜官印长按蓄力连续推进逻辑。
3. 验证与验收：
   - 执行 TypeScript 类型检查 `npx tsc --noEmit`。
   - 执行明末内容包校验 `npm run validate:content`。
   - 执行 Vitest 测试套件 `npm test`，确保 100% 绿灯。
