# 智链宝 V2.0 — API_SPEC.md

> 版本：v1.1
> 状态：开发基线  
> 原则：API 只暴露业务动作，不允许客户端自由写 status / owner / audit 字段。

## 1. 总则

基础前缀：

```text
/api/v2
```

接口类型：

```text
Query      GET
Command    POST
Correction POST
```

不使用：

```text
PATCH /demand/:id { status: "COMPLETED" }
```

直接改业务状态。

使用明确动作：

```text
POST /demands/:id/submit-close
POST /demands/:id/review-close
```

## 2. 标准响应

成功：

```json
{
  "ok": true,
  "data": {},
  "requestId": "..."
}
```

失败：

```json
{
  "ok": false,
  "error": {
    "code": "DEMAND_ALREADY_CLAIMED",
    "message": "该需求已被其他团员认领",
    "details": {}
  },
  "requestId": "..."
}
```

生产环境不得返回数据库堆栈。

## 3. HTTP 语义

| 状态 | 含义 |
|---|---|
| 200/201 | 成功 |
| 400 | 输入校验失败 |
| 401 | 未登录 / Session无效 |
| 403 | 已登录但无权限 |
| 404 | 不存在或按安全策略不可发现 |
| 409 | 并发冲突 / 状态冲突 / 重复 |
| 422 | 业务规则不满足 |
| 429 | 请求过快 |
| 500 | 服务异常 |
| 503 | 可降级第三方服务不可用 |

## 4. 幂等

关键写接口支持：

```text
Idempotency-Key
```

至少：

- 公开填报；
- 正式提交；
- 认领；
- 需求进展新增；
- 需求办结提交；
- 主责退出申请；
- SUPER 主责转交执行；
- 行程结果；
- 人才发起；
- 报销提交；
- 求助认领；
- 导入执行。

同 key + 同 actor + 同 action 返回同一业务结果。

---

# 5. Auth

```text
POST /auth/login
POST /auth/first-password-change
POST /auth/change-password
POST /auth/logout
POST /auth/logout-all
GET  /auth/sessions
POST /auth/sessions/:id/revoke
GET  /auth/me
```

管理员：

```text
POST /admin/accounts/:id/enable
POST /admin/accounts/:id/disable
POST /admin/accounts/:id/reset-password
POST /admin/accounts/:id/change-phone
POST /admin/people/:personId/reimbursement-apply/enable
POST /admin/people/:personId/reimbursement-apply/disable
```

平台注册往届报销申请权限允许 `ADMIN` / `SUPER_ADMIN` 按人开启或关闭，但管理员因此**不会获得报销内容查看权**。

管理员、超级管理员、报销管理、团长、部长、第二阶段领导等高权限账号授权动作仍由服务端要求 `SUPER_ADMIN`。部长必须以独立 `MINISTER` 授权，不得由职位名称或 `GROUP_LEADER` 代替。

---

# 6. Home / Workbench

```text
GET /home
GET /workbench
GET /todos
GET /messages
POST /messages/:id/read
POST /messages/read-all
```

`GET /home` 由服务端按用户权限直接返回可见模块：

```text
announcement
groupOverview?
currentPresence
todayTrips
topTodos
latestDemands
```

前端不自行拼接越权数据。

---

# 7. Demand

## 7.1 Query

```text
GET /demands
GET /demands/:id
GET /demands/:id/timeline
GET /demands/:id/progress
GET /demands/:id/recommendations
GET /demand-leads
GET /demand-leads/:id
```

筛选：

```text
status
type
areaId
batchId
keyword
mine
page
pageSize
```

## 7.2 Demand Lead commands

```text
POST /demand-leads
POST /demand-leads/:id/add-info
POST /demand-leads/:id/link-enterprise
POST /demand-leads/:id/merge
POST /demand-leads/:id/close
POST /demand-leads/:id/restore
POST /demand-leads/:id/convert-to-draft
```

## 7.3 Formal demand commands

```text
POST /demands
POST /demands/:id/submit-review
POST /demands/:id/review
POST /demands/:id/direct-publish
POST /demands/:id/claim
POST /demands/:id/collaboration/apply
POST /demands/:id/collaboration/invite
POST /demands/:id/collaboration/:personId/approve
POST /demands/:id/collaboration/leave
POST /demands/:id/collaboration/:personId/remove
POST /demands/:id/progress
POST /demands/:id/submit-close
POST /demands/:id/review-close
POST /demands/:id/cancel
POST /demands/:id/owner-exit
POST /demands/:id/owner-exit/review
POST /demands/:id/transfer-owner/preview
POST /demands/:id/transfer-owner
POST /demands/:id/formal-correction
POST /demands/:id/merge
POST /demands/:id/group-leader-remind
```

高风险：

```text
transfer-owner
merge
formal-correction（根据字段）
```

必须 reason / impact token / confirm token。

## 7.4 Recommendations

```text
GET  /demands/:id/recommendations
POST /demands/:id/recommendations/run
POST /demands/:id/recommendations/manual-add
POST /demands/:id/recommendations/:itemId/respond
POST /demands/:id/alumni-help/activate
```

AI运行可返回：

```text
202 Accepted + jobId
```

`run` 必须提供 `Idempotency-Key`，且只允许 ADMIN / SUPER_ADMIN。`GET`
按对象级权限过滤：管理员以及同时具备有效 `TOWNSHIP_STAFF` 角色和负责区域范围的镇区人员可见完整名单，有账号的被推荐人只可见本人项。只有 Appointment/area mapping 而无有效角色的账号不得获得完整可见或历史往届代录能力。
往届正式协助激活不写入 `currentOwnerPersonId`，必须同时建立有效的镇区经办关系。

## 7.5 Progress / Close / Responsibility lifecycle

当前正式路由与命令约束：

| Route | 身份与对象级规则 | `Idempotency-Key` | 关键请求约束 |
|---|---|---:|---|
| `GET /demands/:id/progress` | 有效内部账号且通过 `demand.view` | 否 | 返回进展、办结、退出、责任与 stale 派生概览 |
| `POST /demands/:id/progress` | `demand.progress.add`，并通过当前责任关系校验 | 必须 | `currentProgress`、`nextStep` 必填；可带 `attachmentIds`、受控 `representedPersonId` |
| `POST /demands/:id/group-leader-remind` | 有效 `GROUP_LEADER` / `MINISTER` 且 `demand.team_coordinator.remind` | 否 | body 为 `{}`；仅真正 stale 的 `IN_PROGRESS` Demand |
| `POST /demands/:id/submit-close` | `demand.close.submit`；仅 current owner 或 current township handler | 必须 | `solution`、`connectedResources` 必填，可带 `attachmentIds` |
| `POST /demands/:id/review-close` | ADMIN / SUPER 且 `demand.close.review` | 否 | `townshipVerificationResult` 必填；RETURN 时 `reason` 必填 |
| `POST /demands/:id/owner-exit` | `demand.owner.exit_request`；仅 CURRENT_OWNER 本人 | 必须 | `reason` 必填 |
| `POST /demands/:id/owner-exit/review` | ADMIN / SUPER 且 `demand.owner.exit_review` | 否 | `decision=APPROVE/REJECT`；REJECT 时 `reviewReason` 必填 |
| `POST /demands/:id/transfer-owner/preview` | 仅 SUPER 且 `demand.owner.transfer` | 否 | `newOwnerPersonId`、`reason`；返回 10 分钟 HMAC `impactToken` |
| `POST /demands/:id/transfer-owner` | 仅 SUPER 且 `demand.owner.transfer` | 必须 | 同一目标/原因、`impactToken`、`confirmation="CONFIRM"` |
| `POST /demands/:id/cancel` | 负责镇区 staff 或 ADMIN / SUPER 且 `demand.cancel` | 否 | `reason` 必填；只允许规定的非终态 |

`progress`、`submit-close`、`owner-exit` 和正式 `transfer-owner` 复用 `DemandCommandIdempotency`。同 actor、action、key、Demand 与 payload 可重放；同 key 跨 Demand 或 payload 不同返回稳定冲突。Preview、审核、提醒和取消依靠事务锁与当前状态校验，不声明幂等 key。

责任模式只允许：

```text
CURRENT_OWNER
ALUMNI_TOWNSHIP
```

关键 mutation 会在事务中重新解析责任结构；主责指针、唯一 active OwnerHistory、唯一 active TownshipHandler 或 active AlumniHelper 互相矛盾时 fail-safe，不猜责任人。

---

# 8. Outcomes

```text
GET  /demands/:id/outcomes
POST /demands/:id/outcome-plan
POST /demands/:id/outcomes
POST /demand-outcomes/:id/submit-review
POST /demand-outcomes/:id/review
```

服务端计算统计，不接受客户端提交“累计总额”。

---

# 9. Enterprise

```text
GET /enterprises
GET /enterprises/:id
GET /enterprises/map-summary
GET /enterprises/map-points
```

申请：

```text
POST /enterprise-change-requests
GET  /enterprise-change-requests
POST /enterprise-change-requests/:id/review
```

管理员：

```text
POST /enterprises
POST /enterprises/:id/formal-correction
POST /enterprises/:id/disable
POST /enterprises/:id/restore
POST /enterprises/:id/merge
```

联系人：

```text
POST /enterprises/:id/contacts
POST /enterprise-contacts/:id/update
POST /enterprise-contacts/:id/set-primary
POST /enterprise-contacts/:id/disable
```

地图：

```text
POST /enterprises/:id/geocode
POST /enterprises/:id/coordinate
```

坐标接口不得修改 responsible_area。

---

# 10. Member / Batch / Organization

```text
GET /members
GET /members/:id
GET /members/map-summary
POST /members/me/capability-profile

GET /batches
POST /admin/batches
POST /admin/batches/:id/activate
POST /admin/batches/:id/close
POST /admin/batches/:id/group-leader

GET /organizations
GET /organizations/:id
POST /admin/appointments
POST /admin/appointments/:id/end
POST /admin/department-area-relations
POST /admin/department-area-relations/:id/end
```

高风险批次切换接口必须走 impact preview。

---

# 11. Talent

```text
GET /talents
GET /talents/:id
POST /talent-change-requests
GET /talent-change-requests
POST /talent-change-requests/:id/review

POST /talents/:id/contact-rounds
GET  /talents/:id/contact-rounds
POST /talent-rounds/:id/progress
POST /talent-rounds/:id/complete
POST /talent-rounds/:id/withdraw

POST /admin/talents/:id/current-contact
POST /admin/talents/:id/merge
POST /admin/talents/:id/disable
```

---

# 12. Policy

```text
GET /policies
GET /policies/:id

POST /admin/policies
POST /admin/policies/:id/ai-extract
POST /admin/policies/:id/publish
POST /admin/policies/:id/update-content
POST /admin/policies/:id/withdraw
POST /admin/policies/:id/replacement-relations
DELETE/POST /admin/policy-replacement-relations/:id/end
```

AI替代关系只返回建议，正式关系必须管理员命令确认。

---

# 13. Presence

```text
GET  /presence/current
GET  /presence/me
POST /presence
POST /presence/:id/update
POST /presence/:id/cancel
GET  /admin/presence/history
POST /admin/presence/:id/correct
```

---

# 14. Trip / Visit

```text
GET  /trips
GET  /trips/:id
POST /trips
POST /trips/:id/update
POST /trips/:id/cancel
POST /trips/:id/participants
POST /trips/:id/participants/leave
POST /trips/:id/result

GET  /visits
GET  /visits/:id
POST /visits/:id/supplements
POST /visits/:id/demand-leads
POST /admin/visits/:id/correct
```

`POST /trips/:id/result` 必须幂等，重复提交不得生成重复走访。

---

# 15. Reimbursement

```text
GET /reimbursements
GET /reimbursements/:id
POST /reimbursements
POST /reimbursements/:id/update
POST /reimbursements/:id/submit
POST /reimbursements/:id/withdraw

POST /reimbursements/:id/invoices
POST /reimbursement-invoices/:id/ocr
POST /reimbursement-invoices/:id/confirm

POST /reimbursement-admin/:id/return
POST /reimbursement-admin/:id/verify
POST /reimbursement-admin/:id/paper-received
POST /reimbursement-admin/:id/paper-incomplete
POST /reimbursement-admin/:id/finance-submitted
POST /reimbursement-admin/:id/correct-state

POST /reimbursement-admin/export
GET  /reimbursement-admin/export/:taskId
```

总金额服务端根据费用明细与补助重新计算。

客户端传 `totalAmount` 只能作为展示值，不可信任。

---

# 16. Help

```text
GET  /help-requests
GET  /help-requests/:id
POST /help-requests
POST /help-requests/:id/withdraw
POST /help-requests/:id/reopen

POST /admin/help-requests/:id/assign-person
POST /admin/help-requests/:id/transfer-org
POST /help-requests/:id/claim
POST /help-requests/:id/progress
POST /help-requests/:id/complete
POST /admin/help-requests/:id/reassign
```

claim 使用事务防并发。

---

# 17. Announcement

```text
GET /announcements
GET /announcements/:id
POST /announcements/:id/read
POST /announcements/:id/confirm

POST /admin/announcements
POST /admin/announcements/:id/update
POST /admin/announcements/:id/publish
POST /admin/announcements/:id/withdraw
POST /admin/announcements/:id/pin
POST /admin/announcements/:id/audience
GET  /admin/announcements/:id/confirmation-status
```

内容更新和 audience 更新必须分开命令。

---

# 18. Attachment

```text
POST /attachments/upload-intent
POST /attachments/:id/complete
GET  /attachments/:id/access
POST /attachments/:id/abort
```

`access`：

- 再次鉴权；
- 返回短时签名地址；
- 敏感附件写访问日志。

---

# 19. AI / Search

```text
POST /ai/chat
GET  /ai/conversations
GET  /ai/conversations/:id
POST /ai/feedback

POST /search
```

`/search` 服务端决定：

```text
STRUCTURED
SEMANTIC
HYBRID
```

模型不得直接得到 DB 凭证。

管理：

```text
GET  /admin/ai/metrics
GET  /admin/ai/jobs
GET  /admin/ai/index-health
POST /super-admin/ai/config/test
POST /super-admin/ai/config/activate
```

---

# 20. Map

```text
GET /map/areas
GET /map/boundaries/:areaId
POST /admin/map/boundaries
POST /admin/map/boundaries/:id/activate
POST /map/geocode
```

导航由前端 Navigation Adapter 唤起外部地图。

---

# 21. Import / Export / Report

```text
POST /admin/imports
POST /admin/imports/:id/mapping
POST /admin/imports/:id/preview
POST /admin/imports/:id/execute
GET  /admin/imports/:id
GET  /admin/imports/:id/errors

POST /exports
GET  /exports/:id
GET  /exports/:id/download

GET  /reports/monthly
POST /reports/monthly/archive
GET  /reports/monthly/archives
```

导出创建和下载分别鉴权。

---

# 22. System / Audit / Backup

```text
GET /super-admin/audit
GET /super-admin/system/health
GET /super-admin/backups
POST /super-admin/backups/snapshot
POST /super-admin/restores/preview
POST /super-admin/restores/execute
```

Restore 必须进入维护模式。

---

# 23. Command body 统一字段

高风险命令：

```json
{
  "reason": "...",
  "impactToken": "...",
  "confirmation": "CONFIRM"
}
```

`impactToken` 由 preview 接口生成，短时有效，绑定：

- actor；
- object；
- action；
- 当前版本。

防止用户预览后数据已变化还执行旧操作。

---

# 24. 分页

统一：

```text
page=1
pageSize=20
```

最大 pageSize 建议 100。

大数据导出必须走 ExportTask，不能传 `pageSize=999999`。

---

# 25. 搜索

手机号等精确敏感搜索只在权限允许的管理场景开放。

普通列表 keyword 需：

- 限长；
- 参数化查询；
- 防通配符滥用；
- 服务端分页。

---

# 26. API 红线

1. 不接受客户端自由修改 status；
2. 不接受客户端自由修改 owner；
3. 不接受客户端传 role 来决定权限；
4. 不接受客户端传 area scope 来扩大数据范围；
5. 不相信客户端 totalAmount；
6. 不让客户端选择“是否写审计”；
7. 不让客户端决定消息接收人；
8. 不让客户端直接传 COS 长期公开 URL；
9. 不返回密码哈希 / Session token / Secret；
10. 不暴露他人 AI 对话正文；
11. 不以 200 + `"success":false` 隐藏真实HTTP错误；
12. 不做全量数据返回后前端过滤权限。

**API_SPEC.md v1.1 END**
