# 智链宝 V2.0 — IMPLEMENTATION_PLAN.md

> 版本：v1.3
> 状态：M0–M3 第一阶段代码已合入，当前进入内测、真实数据演练与发布验收
> 原则：第一阶段最终一次性完整上线；M0–M3只是内部建设顺序。

## 当前实施事实（2026-09-02）

- 当前 `main` 为 `b97588e721d954ae7590ffd6f70dab5dc99e4480`；PR #50 合并后的 CI #482 全部通过。
- M0–M3 第一阶段代码基线已经合入。PR #22、#24、#28、#29、#35、#36、#39、#40、#41、#42、#50 均已合并；被 #50 取代的 #45、#47、#48、#49 已关闭且未单独合并。
- `main` 受保护，required checks 为 `quality`、`database`、`critical-e2e`、`docker-build`、`security`、`performance`、`browser-compat`。
- 仓库当前为 public。该状态已经由仓库所有者确认，本文件只同步事实、不修改仓库设置；任何 Secret、真实业务数据和迁移资料仍不得进入 Git，上线前应再次确认公开策略。
- PR #42 的参考资料包适配仍是 `SAMPLE`。它不是受控 V1 `FULL` snapshot、FULL rehearsal、正式迁移或最终对账证据。
- 当前冻结新增功能，不启动 M4。下一阶段是 TEST 部署与 smoke、具名 UAT、受控 FULL 演练、真实备份/恢复和 PROD preflight；在这些外部门完成前始终保持 `RELEASE_READY=NO`。

# 1. 开工前

GitHub：

```text
repo 当前为 public（所有者已确认）
main 已保护
PR 已启用
CI 与 required checks 已启用
```

最初“创建私有 repo”属于历史建议，已被当前公开仓库决定取代。公开仓库不允许提交 Secret、真实业务数据、V1 原始资料包或迁移证据；生产上线前仍需复核该治理决定。

根目录准备：

```text
AGENTS.md
docs/*
.env.example
Dockerfile
package.json
package-lock.json
```

禁止先写业务页面再补权限/数据结构。

---

# 2. M0 基础底座

目标：

> 多角色、一人一账号、权限、附件、审计、Worker 跑通。

## M0.1 Project Skeleton

- Next.js；
- TypeScript；
- Tailwind；
- Mobile/Admin layout；
- ESLint；
- Vitest；
- Playwright；
- Docker standalone；
- health/ready。

Gate：

```text
npm ci
lint
typecheck
test
build
Docker启动
```

## M0.2 Database Foundation

建立：

```text
Person
Account
Session
Organization
AdministrativeArea
OrganizationAreaMapping
Appointment
DepartmentTownshipRelation
RoleAssignment
SpecialPermissionGrant
Batch
BatchMembership
GroupLeaderAssignment
AuditLog
StateTransitionHistory
OutboxEvent
JobTask
```

`MINISTER` 使用现有 `RoleAssignment(role_code = MINISTER)`，不新增部长账号、档案或任命表；`GroupLeaderAssignment` 继续只表达团长与批次的关系。本说明只约束后续 M0.2 实现，本次文档任务不开始 M0.2。

输出首个 Prisma Migration。

Gate：

> 空库 migrate deploy 成功；重复 deploy 无异常。

## M0.3 Auth

- 手机号登录；
- 待启用；
- 未激活；
- 首次改密；
- 保密确认；
- 30天Session；
- 2设备；
- 第3台踢最老；
- 重置；
- 全部退出。

Gate：

> Auth E2E全通过。

## M0.4 Permission

实现五层Permission。

先做最小页面：

> 权限诊断测试页只在TEST环境使用。

Gate：

- 多角色；
- 镇区；
- 部门；
- ADMIN；
- SUPER_ADMIN；
- 敏感权限；

负向测试全部通过。

## M0.5 Attachment

- COS；
- Upload intent；
- Complete；
- Short URL；
- MIME/magic；
- 扫描Adapter；
- AccessLog。

## M0.6 Worker / Outbox

- Job claim；
- retry；
- idempotency；
- Outbox consumer。

Gate：

> 重复Worker不重复产生业务结果。

**M0完成条件：多角色权限和一人多角色验证通过。**

---

# 3. M1 核心闭环

目标：

> 一条真实需求从发现到成效完整走通。

## M1.1 Enterprise

先企业，因为Demand依赖正式Enterprise。

- 企业；
- 联系人；
- 新增/纠错申请；
- 版本；
- 停用；
- 合并基础；
- 列表/详情。

## M1.2 Demand Lead

- 公开表单；
- 走访来源接口先预留；
- 待关联企业；
- 核验；
- 补充；
- 合并；
- 关闭；
- 转正式草稿；
- 原来源快照。

## M1.3 Formal Demand

- 草稿；
- 提交审核；
- 退回；
- 发布；
- 详情；
- 状态历史。

## M1.4 Claim / Collaboration

- 原子认领；
- 协同申请/邀请；
- 退出/移除；
- owner history。

Gate：

> 并发认领测试。

## M1.5 AI Recommendation

- current member候选池；
- AI排序理由；
- evidence snapshot；
- alumni补充路径。

AI失败不阻止业务。

## M1.6 Progress / Close

状态：已在 PR #22 实现并合入 `main`。

- 进展；
- stale派生；
- 团长与部长共享的团队协调提醒（7天限频）；
- 提交办结；
- 管理员核实；
- 退回；
- 办结；
- 主责退出申请及 ADMIN/SUPER 审核；
- SUPER owner transfer preview/confirm；
- 生命周期 Message/Todo/Outbox、Attachment 与 cancel cleanup。

## M1.7 Outcome

状态：M1.7 Outcome 已在 PR #24 实现并合入 `main`。

- 办结 APPROVE 原子创建 NONE/TRACKING Plan，历史 COMPLETED 可一次补建；
- 多轮 DRAFT/RETURNED/PENDING_REVIEW/APPROVED、editVersion 与 activeKey 并发保护；
- 负责镇区填报，ADMIN/SUPER 审核，PASSED evidence 或 verifiedNote；
- dueVersion Job、Outcome Outbox/Message/Todo 与终态清理；
- 仅 APPROVED increment 的服务端合计，trackingBatchId/trackingDate 为后续 Reporting 真源；
- 移动端与管理端同一 Demand 详情完成填报、退回、审核、结束。

## M1.8 Home

状态：A-M1-008 已在 PR #26 实现并合入 `main`，后续体验优化随 PR #39 合入。

- `HomeService.overview()` 在服务端聚合消息、公告、全团需求、当前在宝、今日行程、待办和最新需求，页面不直接使用 Prisma；
- 团长/部长复用 `team.overview.view`，其他角色不显示全团概览；
- “久未更新”复用上海自然日口径，单条规则与 MySQL 批量统计做等价测试；
- 当前在宝去重、排除取消并最多展示 5 人；今日行程沿用本人/团队既有可见性且最多 3 条；
- 待办只读校验真实业务状态，派生优先级并最多 3 条，GET 不产生状态写入；
- 最新需求只展示 `PENDING_CLAIM`，当前有效且未拒绝的本人推荐优先，最多 3 条且首页不提供认领操作；
- 荷宝在独立对话路由缺失期间降级到政策、企业、团员结构化检索，并显式说明能力缺口；
- 不新增 Home/Dashboard 数据模型、API、Migration。

**M1完成条件：一条需求端到端走通。**

---

# 4. M2 资源与日常工作

可以部分并行。

## M2.1 Member / Contacts

- 在任/往届；
- 能力画像；
- 批次；
- 派出单位；
- 通讯录。

## M2.2 Map

- AdministrativeArea；
- GeoJSON；
- 企业地图；
- 团员地图；
- NavigationAdapter。

## M2.3 Presence

- 来离宝；
- 当前在宝。

## M2.4 Trip / Visit

- 一周行程；
- 多节点；
- 参与人；
- 共享结果；
- 每企业生成Visit；
- Visit→多Lead。

Gate：

> 行程结果重复提交不重复生成走访。

## M2.5 Talent

- 人才申请；
- 正式人才；
- 原推荐人；
- 当前联系人；
- 多镇区轮次；
- Progress；
- AI简历提取。

## M2.6 Policy

- 主政策文件；
- 补充附件；
- AI提取；
- 人工确认；
- 发布；
- 双状态；
- 替代关系。

**M2完成条件：资源可查，行程可转需求线索。**

---

# 5. M3 保障与上线

## M3.1 Reimbursement

必须严格按 REIMBURSEMENT_RULES。

先表单/状态，再OCR。

不要反过来以OCR驱动业务模型。

## M3.2 Help

- 类别含餐饮；
- 转组织；
- 唯一主办人；
- expected date；
- reopen。

## M3.3 Announcement / Message / Todo

虽然M0有Outbox，此阶段完成完整UI和全部矩阵。

## M3.4 Reporting

固定五张月度台账。

不含报销/求助。

不排名。

## M3.5 Import / Export

统一 Import Engine。

字段映射/预览/去重/错误/快照。

## M3.6 V1 Migration

按 MIGRATION_PLAN：

- 样本；
- 全量演练；
- 对账。

当前实现状态：迁移 framework、26 条脱敏 sample rehearsal，以及 PR #42 的 V1 参考资料包 `SAMPLE` 适配均已合入；真实 V1 受控 `FULL` snapshot 尚未提供，FULL rehearsal 仍被 source-data gate 阻止。该状态不代表正式迁移、final incremental、最终对账或生产切换完成。

## M3.7 System Admin

- 参数；
- Map boundary；
- AI status；
- Storage health；
- Audit；
- Backup/Restore UI。

## M3.8 Hardening

- Performance；
- Security；
- AI eval；
- Browser；
- weak network；
- restore drill。

**M3完成条件：全部第一阶段模块完成集成验收。**

---

# 6. 第一阶段正式UAT

角色：

```text
SUPER_ADMIN
ADMIN
reimbursement manager
group leader
township A
township B
department
3–5 members
```

跑完整清单。

---

# 7. 正式迁移和上线

```text
V1 freeze
→ final backup
→ final incremental migration
→ reconciliation
→ PROD snapshot
→ deploy
→ smoke
→ release V2
→ shut down V1
```

---

# 8. M4第二阶段（不和V2.0首发混做）

基础数据稳定约1个月后：

- 领导工作台；
- LeadershipAssignment正式启用；
- 督办；
- 岗位交接UI；
- AI月报/总结。

第一阶段只留底层模型。

---

# 9. Codex任务拆分粒度

一个PR原则：

> 一个清晰业务能力。

好：

```text
feat(auth): first login flow
feat(demand): atomic claim
feat(trip): complete trip and create visits
```

不好：

```text
feat: build all V2
```

避免数千行无法Review。

---

# 10. 每个模块开发顺序

统一：

```text
Data model
→ Migration
→ Repository
→ Domain Service
→ Permission
→ Event
→ API
→ UI
→ Unit
→ Integration
→ E2E
```

不先做漂亮页面再补服务端。

---

# 11. 变更控制

若用户后续提出新想法：

```text
ChatGPT分析
→ 判断是否改变PRD
→ 规格更新
→ 新Git任务
→ Codex分支
→ TEST
→ Merge
→ Deploy
```

不在生产服务器临时改。

---

# 12. 第一批建议Git Issues

```text
M0-001 scaffold
M0-002 prisma foundation
M0-003 auth session
M0-004 permission service
M0-005 attachment service
M0-006 audit/outbox/jobs
M0-007 mobile shell
M0-008 admin shell

M1-001 enterprise
M1-002 demand lead
M1-003 demand review
M1-004 demand claim
M1-005 collaboration
M1-006 recommendation
M1-006 progress/close
M1-007 outcome
M1-008 home
```

后续再按模块继续拆。

---

# 13. 当前接力门槛

M0–M3 已完成代码合并，不再从 M0 重启，也不因文档同步重复开发已完成模块。当前只允许围绕第一阶段发布收口：

```text
最新 main
→ TEST 部署与 smoke
→ 具名角色 UAT
→ 受控 V1 FULL 演练与对账
→ 真实备份/恢复演练
→ PROD preflight / cutover
```

内测明确发现的缺陷可单独建 Issue/PR 修复；没有验收证据支持的新功能继续冻结，M4 不启动。

## M3.5 实现记录（2026-08-28）

统一 Import Engine、Field Registry、EntityMatcher、企业/团员/人才 Adapter、逻辑快照、确认幂等，以及企业限域/人才管理员导出已进入本里程碑实现。M3.6 已由独立里程碑实现 provider-driven dry-run 与 dedicated V2 Migration DB Actual Apply、业务 target + Map 原子写入、resolution 复用、changed-source fingerprint fail-safe、正式 Attachment file policy/scanner 复用、PDF 目标重读/Link 和真实 MySQL 幂等测试；非 PENDING Help、Presence/Trip/Visit/Role 保持 unsupported review。PR #42 已增加参考资料包适配，但输出仍固定为 `SAMPLE`；FULL rehearsal 继续等待受控 V1 `FULL` snapshot。

## M3.4 实现记录（2026-08-28）

状态：已实现并合入 main。固定五张结构化月度工作台账、历史 as-of Demand/批次/久未更新/待成效口径、范围解析、APPROVED Outcome Decimal 汇总、异步 Job、私有 Attachment、Excel 安全、响应式入口与专项测试进入本里程碑实现。不含报销、求助、排名、AI 叙述、M4 工作台或 V1 Migration 执行。

## M3-007 status

Status: implemented in PR #28 and merged into `main`. System settings/versioning, Asia/Shanghai work calendar, capability-driven AdminShell, high-risk overview, batch/import pre-backup, map activation preview, AI/OCR config lifecycle and evaluation gate, health/storage aggregation, full redacted audit, backup catalog/provider abstraction, restore/maintenance orchestration and UI/API are implemented. Recovery hardening includes explicit fake-provider gating, normalized environment and exact-schema restore guards, rechecked Provider preview, post-restore validation, reentrant crash recovery/finalization, Provider-only catalog ingest, evidence-based compliance, complete restore UI actions, read-only `NOT_WIRED` SLA settings, and expanded Batch/Map impact previews. M3-008 later added the official CynosDB adapter, but no real production provider evidence or controlled restore drill is claimed.

## B-M3-008 Final hardening

Status: implemented in PR #29 and merged into `main`. The milestone adds release-readiness truth states; seven required CI contexts; security headers, dependency/secret/code scanning and real ClamAV CI; fixed-scale MySQL performance; Chromium/Firefox/WebKit and weak-network coverage; AI contract evaluation and permission-filtered structured Chat; official CynosDB backup integration; guarded restore-to-new-TEST-cluster tooling; read-only consistency audit; and release/UAT/operations runbooks. PR #50 later bound UAT automation evidence to an exact clean candidate, added the local structured-chat E2E path, and fixed the vulnerable transitive `mysql2` version. It adds no Prisma migration and starts no M4 scope.

This is code-complete wording only. The current protected `main` and CI are verified, but production release remains `RELEASE_READY=NO` until a release candidate also has TEST smoke, named UAT, V1 FULL rehearsal/reconciliation, production scanner, real backup, real restore drill/cleanup, maintenance and production preflight evidence.

**IMPLEMENTATION_PLAN.md v1.3 END**
