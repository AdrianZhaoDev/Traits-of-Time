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

## 3. 游戏素材技能与外部服务
* 项目安装的游戏开发技能、适用场景和使用方法见 [`Doc/游戏开发技能使用指南.md`](./Doc/游戏开发技能使用指南.md)。技能只作开发辅助，沿用本项目的 Cocos 实现和内容 ID。
* 在 WSL 使用素材技能的 Python 脚本时，优先使用项目本地的 `local/agent-sprite-forge-venv/bin/python`；Windows 使用指南中的独立环境。缺少依赖时按指南处理。
* 调用可能收费或消耗订阅额度的图像、视频接口及外部 CLI 前，必须在当前任务中取得用户对供应商和预算或额度的明确授权。已配置密钥、已登录或同意安装技能，不等于同意调用；本条优先于第三方技能中相反的说明。
* 未获授权时，可使用不会发送请求的 dry-run，或按用户要求处理本地素材；不得把预览计划当作已生成的素材。密钥不得写入项目、提示词或日志。
