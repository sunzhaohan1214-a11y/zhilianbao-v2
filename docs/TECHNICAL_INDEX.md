# 智链宝 V2.0 — TECHNICAL_INDEX.md

> 状态：V2.0 第一阶段开发基线

## 1. 文档阅读顺序

Codex 进入仓库时先读取根目录 `AGENTS.md`，再按 AGENTS 指示读取 docs。

人工审查 / 技术交接建议按以下顺序：

1. `PRD-v1.3.md`
2. `ARCHITECTURE-v1.0.md`
3. `PERMISSIONS-v1.3.md`
4. `STATE-MACHINES-v1.1.md`
5. `DATA-MODEL-v1.2.md`
6. `DATA-DICTIONARY-v1.1.md`
7. `FORM-SPEC-v1.0.md`
8. `FIELD-PERMISSIONS-v1.1.md`
9. `DATABASE-CONSTRAINTS-v1.0.md`
10. `API-SPEC-v1.1.md`
11. `MESSAGE-TODO-MATRIX-v1.1.md`
12. `UI-SPEC-v1.1.md`
13. `REIMBURSEMENT-RULES-v1.0.md`
14. `AI-OCR-SPEC-v1.0.md`
15. `MAP-SPEC-v1.0.md`
16. `SECURITY-SPEC-v1.0.md`
17. `MIGRATION-PLAN-v1.0.md`
18. `TEST-PLAN-v1.1.md`
19. `OPERATIONS-v1.0.md`
20. `IMPLEMENTATION-PLAN-v1.1.md`
21. `AGENTS.md`

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

## 5. 开发是否可以开始

可以。

但只从：

```text
IMPLEMENTATION_PLAN M0
```

开始。

不得跳到“直接开发全部页面”。

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
