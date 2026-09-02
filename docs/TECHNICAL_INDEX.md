# 智链宝 V2.0 — TECHNICAL_INDEX.md

> 状态：V2.0 第一阶段开发基线

## 1. 文档阅读顺序

Codex 进入仓库时先读取根目录 `AGENTS.md`，再按 AGENTS 指示读取 docs。

人工审查 / 技术交接建议按以下顺序：

1. `PRD.md`（当前文档版本 v1.3）
2. `ARCHITECTURE.md`（TECH v1.0）
3. `PERMISSIONS.md`（当前文档版本 v1.3）
4. `STATE_MACHINES.md`（当前文档版本 v1.1）
5. `DATA_MODEL.md`（当前文档版本 v1.2）
6. `DATA_DICTIONARY.md`（当前文档版本 v1.1）
7. `FORM_SPEC.md`（当前文档版本 v1.0）
8. `FIELD_PERMISSIONS.md`（当前文档版本 v1.1）
9. `DATABASE_CONSTRAINTS.md`（当前文档版本 v1.0）
10. `API_SPEC.md`（当前文档版本 v1.1）
11. `MESSAGE_TODO_MATRIX.md`（当前文档版本 v1.1）
12. `UI_SPEC.md`（DESIGN v1.1）
13. `REIMBURSEMENT_RULES.md`（当前文档版本 v1.0）
14. `AI_OCR_SPEC.md`（当前文档版本 v1.0）
15. `MAP_SPEC.md`（当前文档版本 v1.0）
16. `SECURITY_SPEC.md`（当前文档版本 v1.0）
17. `MIGRATION_PLAN.md`（当前文档版本 v1.0）
18. `TEST_PLAN.md`（当前文档版本 v1.1）
19. `OPERATIONS.md`（当前文档版本 v1.2）
20. `IMPLEMENTATION_PLAN.md`（当前文档版本 v1.3）
21. 根目录 `AGENTS.md`

> 仓库内规格文件使用稳定文件名，版本号记录在文件内容中；不要根据文档版本号自行拼接不存在的文件名。

## 2. 权威层级

发生冲突：

```text
PRD已确认业务规则
>
PERMISSIONS / STATE_MACHINES
>
DATA_MODEL / DATA_DICTIONARY
>
API / MESSAGE / UI / 领域规则
>
ARCHITECTURE实现细节
>
代码
```

技术规格不得私自改变PRD。

如果PRD存在真实空白：

> 技术方案可以选实现，但必须标记“技术决定”，不能伪造产品规则。

## 3. 当前唯一明确待外部制度补充

```text
差旅交通补助/伙食补助精确计发天数
```

当前系统只：

- 展示参考标准；
- 人工填写；
- 保存claimed_days/amount/note。

Codex不得猜公式。

## 4. 已完成的关键技术决定

```text
单仓库
模块化单体
Next.js
Mobile/Admin双UI
TDSQL-C MySQL
Prisma + Migrate
DB Session
五层Permission
COS私有附件
AI/OCR Adapter
VectorDB辅助索引
腾讯地图+自有GeoJSON
Transactional Outbox
MySQL Job Queue
第一阶段无Redis
Vitest+Playwright
Local/Test/Prod
GitHub唯一代码真源
WorkBuddy部署
GROUP_LEADER与MINISTER独立角色映射同一团队协调能力包
```

## 5. 当前开发阶段

M0–M3 第一阶段代码已经合入 `main`，不得从 M0 重启、重复实现既有模块或提前启动 M4。当前工作模式是发布收口：

```text
TEST部署与smoke
→ 具名UAT
→ 受控V1 FULL演练与对账
→ 真实备份/恢复
→ PROD preflight与cutover
```

只有内测发现的明确缺陷或已确认功能缺口才进入新的 Issue/PR；外部证据未齐前始终保持 `RELEASE_READY=NO`。

## 6. 不再需要产品逐项确认的技术细节

以下可由技术实现按本基线自行决定：

- 文件内部类/函数命名；
- Repository组织；
- 常规索引细节；
- 测试fixture；
- 组件拆分；
- CSS实现；
- Docker层优化；
- 日志库小版本；
- CI缓存；
- 无业务影响的代码重构。

## 7. 必须回到产品规格确认的变化

- 新角色；
- 角色能力变化；
- 数据可见范围变化；
- 新核心状态；
- 状态流转变化；
- 报销规则变化；
- 企业是否开户；
- 人才联系方式规则；
- 负责人转交规则；
- 业务终态语义；
- 新敏感数据开放；
- 第二阶段提前进入第一阶段。

**TECHNICAL_INDEX.md END**
