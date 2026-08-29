# 智链宝 V2.0 — DATABASE_CONSTRAINTS.md

> 版本：v1.0  
> 状态：MySQL / Prisma 实现约束  
> 目的：把“并发只能一个成功”等产品规则真正落到数据库，不只靠页面判断。

# 1. 原则

优先顺序：

```text
数据库约束
+ 事务
+ Service业务校验
```

三层共同保证。

不要只：

```text
先SELECT看没有
→ 再INSERT
```

否则并发会重复。

# 2. BusinessSequence

业务编号不能：

```text
COUNT(*) + 1
```

建立：

```text
BusinessSequence

prefix
year
current_value
updated_at
```

唯一：

```text
(prefix, year)
```

生成：

```text
事务中原子递增
→ 格式化6位
```

得到：

```text
XQ-2026-000128
```

## 2.1 Batch current uniqueness

MySQL 普通唯一约束无法安全表达“仅 `is_current = true` 的行唯一”。M0-002 不伪造该约束；后续 Batch Service 必须在事务中锁定批次切换范围，先清除旧 current，再设置新 current，并在提交前验证恰好一条 current。所有批次切换必须走该 Service，保留审计并编写并发集成测试。

# 3. Account

```text
UNIQUE(person_id)
UNIQUE(phone)
INDEX(status)
```

手机号改动：

> 事务检查唯一性。

# 4. Session

索引：

```text
INDEX(account_id, revoked_at, expires_at)
INDEX(expires_at)
```

登录成功后：

- 查询有效Session按 `created_at ASC`；
- 超过2台失效最老。

# 5. 时效关系

Appointment / RoleAssignment / PermissionGrant / DepartmentArea 等：

```text
INDEX(person_id, effective_at, expired_at)
INDEX(organization_id, effective_at, expired_at)
```

“当前有效”统一：

```text
effective_at <= now
AND (expired_at IS NULL OR expired_at > now)
```

不要散落多套判断。

# 6. Enterprise

```text
UNIQUE(credit_code)  // NULL允许多条
INDEX(responsible_area_id, status)
INDEX(name)
INDEX(status)
```

企业中文模糊搜索不要期待普通BTree解决全部全文搜索；第一阶段用标准化keyword/LIKE与分页，语义场景交给SearchService。

# 7. Primary Enterprise Contact

MySQL 无通用 partial unique index。

采用父表受控指针：

```text
Enterprise.primary_contact_id
```

设置主要联系人事务：

1. 锁 Enterprise；
2. 校验 contact 属于该企业且 ACTIVE；
3. 更新 `primary_contact_id`；
4. 同步 contact展示字段/标记（如保留）；
5. 写审计。

`is_primary` 如存在，只作为受控冗余，不作为真源。

# 8. Demand atomic claim

Demand 保存：

```text
current_owner_person_id NULL
status
```

认领核心使用条件更新：

```sql
UPDATE demands
SET current_owner_person_id = ?, status = 'IN_PROGRESS'
WHERE id = ?
  AND status = 'PENDING_CLAIM'
  AND current_owner_person_id IS NULL;
```

影响行数：

```text
1 → 成功
0 → 已被认领/状态变化，返回409
```

同事务：

- 插 DemandOwnerHistory；
- StateHistory；
- Outbox。

不允许：

```text
SELECT后页面判断
```

替代此原子写。

# 9. DemandOwnerHistory

```text
INDEX(demand_id, effective_at, expired_at)
INDEX(person_id, effective_at, expired_at)
```

当前 owner 以 Demand.current_owner_person_id 为高性能指针，历史以 OwnerHistory 为真源。

负责人转交：

> 锁 Demand + 结束旧history + 新history + current pointer，同事务。

# 10. Demand Collaborator

防止同一人重复活动关系。

可采用：

```text
UNIQUE(demand_id, person_id, active_key)
```

其中：

```text
ACTIVE → active_key = 1
LEFT/REMOVED → active_key = NULL
```

MySQL unique允许多个NULL，从而保留多次历史。

若 Prisma 对该模式不友好：

> 用事务锁 Demand + 当前活动关系查询 + 插入；必须并发测试。

## 10.1 M1-006 Progress / Close / Owner lifecycle

迁移 `20260831120000_m1_demand_progress_close` 是 expand-only：只新增 Demand 办结/取消事实字段、五个生命周期表、索引、CHECK 和 FK，未修改任何历史 migration。

### DemandProgress / DemandProgressReminder

```text
DemandProgress INDEX(demand_id, created_at)
DemandProgress INDEX(created_by_person_id, created_at)
DemandProgressReminder INDEX(demand_id, reminder_type, sent_at)
```

两表均为 append-only 事实。七个上海自然日的 reminder 限频由事务锁 Demand 后查询持久化 Reminder 记录保证，不以 Message/Todo 作为限频真源。

### DemandCloseRequest

```text
UNIQUE(demand_id, submission_no)
UNIQUE(demand_id, active_key)
```

MySQL `active_key=1/NULL` 表达同 Demand 最多一个当前申请并保留多轮历史。CHECK：

```text
active_key = 1  <=> ended_at IS NULL
active_key IS NULL <=> ended_at IS NOT NULL
```

### DemandCloseReview

```text
UNIQUE(close_request_id)
CHECK(decision <> RETURN OR reason IS NOT NULL)
```

因此每个 immutable CloseRequest 至多一个 immutable Review，且退回必须有原因。

### DemandOwnerExitRequest

```text
UNIQUE(demand_id, active_key)
```

CHECK 保证：

```text
PENDING  => active_key=1 AND reviewed_at IS NULL
APPROVED/REJECTED => active_key IS NULL AND reviewed_at IS NOT NULL
```

### Demand completion facts / foreign keys

`completion_batch_id` 外键指向 `batches(id)`；所有本任务新增正式关系均 `ON DELETE RESTRICT`，防止删除父实体破坏历史（数据库按项目惯例允许 `ON UPDATE CASCADE`）。

进展、Reminder、CloseRequest/Review、OwnerExitRequest 的 Demand/Person/OwnerHistory FK 全部采用同一删除限制策略。关键写事务统一先锁 Demand，再处理 OwnerHistory、CloseRequest、ExitRequest 与 Collaboration，避免只靠页面或先查后写。

## 10.2 M1-007 Demand Outcome

迁移 `20260901113000_m1_demand_outcome` 为 expand-only，只新增 `demand_outcome_plans`、`demand_outcome_rounds`、索引、CHECK 与 RESTRICT FK。

Plan 使用 `UNIQUE(demand_id)`。CHECK 锁定 NONE/NOT_TRACKED 的空日期形态、TRACKING 活动态的日期与 `due_version>=1`、ENDED 的 `next_tracking_date=NULL + ended_at`。办结 APPROVE 在锁定 Demand 的事务内同时写 COMPLETED、CloseReview、Plan、首个 Due Job、Audit/Transition/Outbox；任一失败整体回滚。历史补建同样锁 Demand。

Round 使用：

```text
UNIQUE(demand_id, round_no)
UNIQUE(demand_id, active_key)
```

其中 DRAFT/PENDING_REVIEW/RETURNED 的 `active_key=1`，APPROVED 为 NULL。CHECK 保证金额/数量非负、继续时下一日期必填且晚于 tracking_date、结束时下一日期为空。Service 仍锁 Demand 与 Round，校验 `editVersion`，因此 create/update/submit/review 并发只有一个合法结果。

统计索引覆盖 `(demand_id,review_status,tracking_date)`、`(tracking_batch_id,review_status,tracking_date)` 与 `(outcome_plan_id,review_status,round_no)`。所有正式关系采用 `ON DELETE RESTRICT`。Due Job 使用唯一 `idempotency_key=demand-outcome-due:{planId}:{dueVersion}`；旧版本 Job 只读校验后 no-op，ENDED 时取消该 Plan 尚在 WAITING 的未来 Job。

# 11. TalentTownshipRound

同人才+区域最多一个IN_PROGRESS。

推荐：

```text
active_key TINYINT NULL
```

规则：

```text
IN_PROGRESS → 1
COMPLETED/WITHDRAWN → NULL
```

唯一：

```text
UNIQUE(talent_id, area_id, active_key)
```

这样历史轮次可多条，活动轮次只有一条。

# 12. Help current owner

HelpRequest：

```text
current_owner_person_id NULL
status
```

单位人员认领条件更新：

```text
WHERE status='PENDING'
AND current_owner_person_id IS NULL
AND current_transferred_org_id = actor有效组织
```

成功后：

```text
status=IN_PROGRESS
```

同事务写 AssignmentHistory。

# 13. Presence overlap

同一Person时间区间重叠无法仅靠普通unique约束。

Service事务中：

```text
SELECT active relevant rows FOR UPDATE
→ overlap check
→ insert/update
```

重叠条件：

```text
new_start < existing_end
AND new_end > existing_start
```

取消记录不参与。

必须有并发测试。

# 14. Trip visit generation

防止行程结果重复生成走访。

EnterpriseVisit：

```text
UNIQUE(trip_id, enterprise_id)
```

如果一行程理论上同企业出现多个节点但产品仍要求同一行程同企业一条走访主记录，则使用该唯一键，并将多个节点信息聚合/关联。

# 15. Reimbursement invoice duplicate

对“明确相同发票号”：

建议规范化：

```text
invoice_no_normalized
```

索引：

```text
INDEX(invoice_no_normalized)
```

不建议全局强制 UNIQUE：

> 历史迁移、纠错等可能存在真实重复数据，需要提示/受控处理而不是数据库无法入库。

Service发现精确重复时返回业务提示。

# 16. Todo

建议：

```text
dedupe_key
active_key
```

OPEN：

```text
active_key=1
```

CLOSED：

```text
active_key=NULL
```

唯一：

```text
UNIQUE(dedupe_key, active_key)
```

确保同业务同类型同人一个OPEN。

# 17. Outbox

```text
UNIQUE(dedupe_key)
INDEX(published_at, occurred_at)
```

消费：

- claim批次；
- 发布成功填 `published_at`；
- 重试不重复最终消息。

# 18. JobTask

```text
UNIQUE(idempotency_key)
INDEX(status, scheduled_at, priority)
INDEX(locked_at)
```

Worker claim：

> 使用事务 + 行锁/`SKIP LOCKED`（数据库版本确认支持后）或等价安全claim方案。

所有raw SQL封装在 JobRepository。

# 19. AnnouncementRecipientState

```text
UNIQUE(announcement_version_id, person_id)
```

新版本重新建一组状态。

旧版本状态不覆盖。

# 20. LegacyMigrationMap

```text
UNIQUE(source_system, source_entity, source_id)
INDEX(target_entity, target_id)
```

这是迁移幂等核心。

# 21. 常用 Demand 索引

至少评估：

```text
INDEX(status, responsible_area_id)
INDEX(responsible_area_id, status, first_published_at)
INDEX(current_owner_person_id, status)
INDEX(creation_batch_id)
INDEX(current_follow_batch_id)
INDEX(first_published_at)
```

最终用真实查询 EXPLAIN 调整，不盲目堆索引。

# 22. 常用列表索引原则

每个高频列表先明确：

```text
WHERE
ORDER BY
分页键
```

再设计复合索引。

禁止为了“可能用到”给每个字段建单列索引，导致写入变慢。

# 23. 分页

普通列表初期 offset pagination 可接受。

高频超大审计/消息表后期可采用 cursor pagination：

```text
(created_at, id)
```

第一阶段无需所有列表复杂化。

# 24. 外键删除策略

正式数据：

```text
ON DELETE CASCADE
```

需非常谨慎。

核心正式关系优先：

```text
RESTRICT / NO ACTION
```

历史明细不因主业务“删除”被级联物理删除，因为正式业务本身不物理删除。

临时技术表可按需要CASCADE。

# 25. 数据库约束红线

1. 不用count生成编号；
2. 不只靠前端防并发；
3. 不用物理删除解决重复；
4. 不用手机号做Person主键；
5. 不用JSON替代核心外键；
6. 不把金额存Double；
7. 不靠坐标决定area；
8. 不通过关闭数据库约束解决Migration报错；
9. 不在业务代码散落raw unsafe SQL；
10. 任何唯一性规则都要有并发测试。

## 25. M3-005 数据库约束

- `ImportRow(batch_id,row_number)` 唯一；`ImportCommandIdempotency(actor_person_id,action,key_hash)` 唯一。
- 所有 staging、快照、幂等和源附件外键使用 `ON DELETE RESTRICT`。
- Confirm 锁定 `ImportBatch` 并在一个事务内写全部正式实体、Version、业务 Audit、逻辑快照、结果和幂等记录。
- 企业信用代码和账号手机号继续由正式唯一约束承担并发最终防线；只捕获明确目标冲突。
- 无 Account 人员的手机号不对 `Person.contactPhone` 盲目加 UNIQUE；Apply 先锁定 `person_import_identity_locks(phone_hash)`，再以 locking current read 调用共享 Person Matcher 复核，跨批竞争 loser 整批回滚。
- 人员 exact phone 必须覆盖 ACTIVE/ARCHIVED；ARCHIVED 以及 DISABLED/MERGED 企业不可通过 Import 创建替代档案、恢复或更新。

## C-M3-004 约束

- `MonthlyReportExportTask(created_by_person_id,idempotency_key_hash)` 唯一，`output_attachment_id` 唯一。
- month 使用 `YYYY-MM` CHECK；任务状态与 started/finished/output/error 字段形状使用 CHECK。
- batch、creator、output Attachment 均 `ON DELETE RESTRICT`；Worker 使用固定 object key 与 `monthly-report-export:{taskId}` Job 幂等键。
- Migration `20260901130000_m3_monthly_reporting` 为 expand-only，不修改历史 migration。

## 26. M3-006 Actual Apply 约束

- 每条 source aggregate 使用独立事务；业务 target、领域 Audit/Version/History 与 `LegacyMigrationMap` 同事务提交，不使用一个全量大事务。
- `(source_system, source_entity, source_id)` 唯一；既有 Map 的 target entity/ID 不得改指，immutable fingerprint 改变必须报 `MIGRATION_SOURCE_HISTORY_CHANGED`。
- `PersonImportIdentityLock` 在 Person 实际创建前锁定并重新读取当前候选；ARCHIVED Person 与 DISABLED/MERGED Enterprise 不接受通用 resolution 绕过。
- Attachment 先保留 temporary row/object；正式 Link、Map、`COPIED` result 和 `is_temporary=false` 同事务。数据库提交失败时保留 temporary 供 cleanup，不产生正式 Link。
- Actual Apply 不写历史业务 Outbox；不得在提交后删除 Outbox 来伪装无通知。

## M3-007 constraints

Setting versions and AI config versions are unique by parent/version. Calendar dates are unique. System commands are unique by actor/action/key hash. AI capability and Backup provider identifiers are unique in their scopes. `RestoreRequest.active_key` is nullable unique so at most one active restore orchestration exists. All governance history/provider metadata foreign keys use `ON DELETE RESTRICT`. High-risk services re-read current rows under `FOR UPDATE`; cloud snapshot/restore calls are never awaited inside the mutation transaction.

**DATABASE_CONSTRAINTS.md v1.1 END**
