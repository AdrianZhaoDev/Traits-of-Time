# 代理与协作规范 (AGENTS.md)

本文件是项目中所有 AI 辅助、代理（Agent）与开发者协同作业时的准则。

## 1. 核心设计与文案约束 (Core Design & Writing Style)
项目的所有文案创作、事件生成、道具说明及剧情迭代，必须遵守 [`Doc/文案设计与风格规范.md`](./Doc/文案设计与风格规范.md)。详细文案规则统一在该文件维护，本文件不重复列出。

---

## 2. 核心架构与工程准则
* 生产内容主目录为：`assets/resources/data/ming_end/`。
* 任何内容字段变动后，必须运行并确保全部测试与校验绿灯：
  * 校验内容格式与依赖：`npm run validate:content -- --content assets/resources/data/ming_end`
  * 运行完整测试套件：`npm test` 或 `npx vitest run`
* 严禁无故修改或破坏已有的 ID 引用系统（包括 `cards.json`, `events.json`, `chains.json`, `deaths.json`, `achievements.json` 的关联）。
