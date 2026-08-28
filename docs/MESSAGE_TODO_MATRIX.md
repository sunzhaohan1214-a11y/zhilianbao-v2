# 智链宝 V2.0 — MESSAGE_TODO_MATRIX.md

> 版本：v1.1
> 状态：开发基线  
> 定义：消息 = 发生了什么；待办 = 当前用户现在需要做什么。

## 1. 通用规则

1. 同一业务 + 同一消息类型可聚合为一条最新消息；
2. 批量操作发送一条汇总消息；
3. 同一业务 + 同一 TodoType + 同一人最多一个 OPEN；
4. 业务状态变化后失效待办自动 `CLOSED_INVALID`；
5. 自动提醒每一轮状态事件只发一次，不按天刷屏；
6. 团长或部长通过团队协调能力手动提醒“久未更新”需求，同一需求 7 天限频；
7. “需确认公告”同时产生消息 + 待办；
8. 被加入行程只产生消息，不产生待办；
9. 首页只展示 OPEN、当前可执行的前3条待办；
10. 旧消息链接到取消/合并/撤回/无权记录时必须给明确状态页。

---

# 2. Event 命名

统一：

```text
DOMAIN_ENTITY_ACTION
```

例如：

```text
DEMAND_REVIEW_RETURNED
TRIP_PARTICIPANT_ADDED
REIMBURSEMENT_RETURNED
```

Event 由 Domain Service 产生。

Message / Todo 由 Notification Worker 消费 Event 产生。

---

# 3. 需求线索

| Event | 消息接收人 | 待办接收人 | TodoType | 关闭条件 |
|---|---|---|---|---|
| `LEAD_CREATED_PUBLIC` | 负责镇区可选汇总消息 | 负责镇区业务池 | `LEAD_VERIFY` | 转正式/合并/关闭 |
| `LEAD_CREATED_VISIT` | 负责镇区 | 负责镇区业务池 | `LEAD_VERIFY` | 同上 |
| `LEAD_NEEDS_MORE_INFO` | 负责镇区 | 负责镇区业务池 | `LEAD_SUPPLEMENT` | 补充完成 |
| `LEAD_ENTERPRISE_PENDING` | 负责镇区、管理员 | 管理员企业新增池（如已提交申请） | `ENTERPRISE_CREATE_REVIEW` | 企业建档/关闭 |
| `LEAD_MERGED` | 相关镇区经办 | 无 | — | — |
| `LEAD_CLOSED` | 原相关经办 | 无 | — | — |
| `LEAD_CONVERTED` | 负责镇区 | 负责镇区（若草稿待继续） | `DEMAND_DRAFT_COMPLETE` | 提交审核 |

---

# 4. 正式需求审核

| Event | 消息 | 待办 | 规则 |
|---|---|---|---|
| `DEMAND_SUBMITTED_REVIEW` | 提交镇区收到“已提交”可省略个人消息 | 管理员 `DEMAND_REVIEW` | 管理员池 |
| `DEMAND_REVIEW_RETURNED` | 负责镇区 | 负责镇区 `DEMAND_REVISE` | 返回原因 |
| `DEMAND_PUBLISHED` | 负责镇区；被推荐人后续单独 | 无通用待办 | 进入需求中心 |
| `DEMAND_REVIEW_OVERDUE` | 管理员/运营关注 | 管理员 `DEMAND_REVIEW_OVERDUE` | 每轮一次 |
| `DEMAND_DIRECT_PUBLISHED` | 负责镇区 | 无 | 管理员代录直接发布 |

审核待办在：

```text
APPROVE
RETURN
CANCEL/MERGE
```

导致不再待审核时关闭。

---

# 5. 推荐与认领

| Event | 消息接收人 | 待办 | 说明 |
|---|---|---|---|
| `DEMAND_RECOMMENDED_CURRENT` | 被推荐在任团员 | 无 | 可查看详情、暂不参与；认领不是强制任务 |
| `DEMAND_RECOMMENDED_ALUMNI` | 平台内往届 | `DEMAND_ALUMNI_RESPONSE` | 愿意协助/暂不参与 |
| `DEMAND_ALUMNI_RESPONSE_RECORDED` | 无新增消息 | 精确关闭本人 `DEMAND_ALUMNI_RESPONSE` | 历史往届线下代录无站内 Todo |
| `DEMAND_ALUMNI_HELP_ACTIVATED` | 当前属地经办人；平台内往届 helper 本人 | 无 | 历史往届无账号不发消息；本阶段不生成进展 Todo |
| `DEMAND_CLAIMED` | 负责镇区、其他有效协同/推荐相关人员按规则 | 主责 `DEMAND_PROGRESS` 由业务节奏产生 | 需求进入对接中 |
| `DEMAND_CLAIM_CONFLICT` | 不生成持久消息 | 无 | API即时409提示 |
| `DEMAND_CLAIM_PERIOD_EXPIRED` | 管理员、负责镇区 | 管理员/镇区 `DEMAND_CLAIM_EXPIRED` | 每轮一次，触发往届补充推荐 |
| `DEMAND_RECOMMENDATION_DECLINED` | 管理员/负责镇区可在详情查看 | 无 | 不重复提醒该人 |

首页“最新需求”不是 Todo。

ALUMNI 新 current run 会将被替换人员尚未处理的 `DEMAND_ALUMNI_RESPONSE` 标记为 `STALE`；同一需求、人员与 TodoType 最多一个 OPEN。人工 add/replace 只通知新加入人员，不给 retained items 重复发消息。

---

# 6. 协同

| Event | 消息 | Todo |
|---|---|---|
| `COLLABORATION_APPLIED` | 主责 | 主责 `COLLABORATION_REVIEW` |
| `COLLABORATION_INVITED` | 被邀请人 | 被邀请人 `COLLABORATION_INVITE_RESPONSE`（若产品采用确认） |
| `COLLABORATION_APPROVED` | 申请人 | 无 |
| `COLLABORATION_REJECTED` | 申请人 | 无 |
| `COLLABORATOR_LEFT` | 主责、相关人员 | 无 |
| `COLLABORATOR_REMOVED` | 被移除人 | 无 |

如果最终 UI 采用“邀请后直接加入”而不要求确认，则 `INVITE_RESPONSE` 不生成；以实际产品动作实现为准，不能自行新增确认流程。

---

# 7. 需求进展与团队协调角色提醒

| Event | 消息 | Todo |
|---|---|---|
| `DEMAND_PROGRESS_ADDED` | 无 generic Message，避免通知噪声 | stale 当前 Demand 的 `DEMAND_UPDATE_STALE`、`DEMAND_CONTINUE` |
| `TEAM_COORDINATOR_STALE_REMINDER` | current owner 或 current township handler | 同一责任接收人 `DEMAND_UPDATE_STALE`；同 Demand 7 个上海自然日限频且最多一个 OPEN |

久未更新是 `IN_PROGRESS` 的上海自然日派生条件，不改 DemandStatus，也不使用每日 cron 自动催促。无 Progress 时基线分别为 active OwnerHistory.effectiveAt 或 active TownshipHandler.effectiveAt。

---

# 8. 办结

| Event | 消息 | Todo |
|---|---|---|
| `DEMAND_CLOSE_SUBMITTED` | active ADMIN / SUPER | active ADMIN / SUPER `DEMAND_CLOSE_REVIEW`；同时 stale `DEMAND_UPDATE_STALE`、`DEMAND_CONTINUE` |
| `DEMAND_CLOSE_RETURNED` | current responsibility、active collaborators/PLATFORM helpers、负责镇区相关人 | current owner 或 current handler `DEMAND_CONTINUE` |
| `DEMAND_COMPLETED` | current responsibility、active collaborators/PLATFORM helpers、负责镇区相关人，去重 | 无；stale `DEMAND_UPDATE_STALE`、`DEMAND_CONTINUE`、`DEMAND_CLOSE_REVIEW`、`DEMAND_OWNER_EXIT_REVIEW` |
| `DEMAND_CANCELED` | 当前责任相关人、负责镇区相关人 | 无；stale 全部上述生命周期 Todo |
| `DEMAND_MERGED` | 主责、协同、负责镇区 | 关闭非主记录Todo |
| `DEMAND_OWNER_EXIT_REQUESTED` | active ADMIN / SUPER | active ADMIN / SUPER `DEMAND_OWNER_EXIT_REVIEW` |
| `DEMAND_OWNER_EXIT_REJECTED` | 原 owner | 无；stale `DEMAND_OWNER_EXIT_REVIEW` |
| `DEMAND_OWNER_EXIT_APPROVED` | former owner、former collaborators、负责镇区相关人，去重 | 无；stale 全部生命周期 Todo |
| `DEMAND_OWNER_TRANSFERRED` | old owner、new owner、active collaborators、负责镇区相关人，去重 | 新 owner 无接受 Todo；只 stale old owner 的 `DEMAND_UPDATE_STALE`、`DEMAND_CONTINUE` |

M1-006 Message 使用：

```text
dedupeKey = eventType + Demand + person
```

同 business、event type、person 聚合；随机 `eventKey` 不进入 Message dedupeKey。Todo 使用：

```text
dedupeKey = Demand + todoType + person
eventKey = 当前业务轮次
```

因此同 Demand、Person、TodoType 最多一个 OPEN，新的业务轮次可 reopen 已 stale 的 Todo，但 Worker 重放不会重复创建 Message/Todo。

---

# 9. 成效

| Event | 消息 | Todo |
|---|---|---|
| `OUTCOME_TRACKING_DUE` | 负责镇区 | 负责镇区 `OUTCOME_FILL` |
| `OUTCOME_SUBMITTED` | 镇区 | 管理员 `OUTCOME_REVIEW` |
| `OUTCOME_RETURNED` | 负责镇区 | 负责镇区 `OUTCOME_REVISE` |
| `OUTCOME_APPROVED_CONTINUE` | 负责镇区 | 下次日期到达再生成 |
| `OUTCOME_TRACKING_ENDED` | 负责镇区 | 关闭相关Todo |

---

# 10. 企业 / 人才申请

通用：

| Event | 消息 | Todo |
|---|---|---|
| `CHANGE_REQUEST_SUBMITTED` | 提交人可不额外打扰 | 管理员 `CHANGE_REQUEST_REVIEW` |
| `CHANGE_REQUEST_RETURNED` | 提交人/负责组织 | 对应 `CHANGE_REQUEST_REVISE` |
| `CHANGE_REQUEST_APPROVED` | 提交人 | 无 |
| `CHANGE_REQUEST_CLOSED` | 提交人 | 关闭待办 |

组织草稿允许同组织在岗人员接续，因此 Todo 可分配到“组织业务池”而非锁死最初个人。

---

# 11. 人才对接

| Event | 消息 | Todo |
|---|---|---|
| `TALENT_ROUND_STARTED` | 当前对接联系人、镇区相关人 | 镇区/联系人 `TALENT_FOLLOW_UP` |
| `TALENT_PROGRESS_ADDED` | 当前相关责任人 | 原Todo更新时间，不重复新建 |
| `TALENT_ROUND_COMPLETED` | 镇区、相关联系人 | 关闭 |
| `TALENT_ROUND_WITHDRAWN` | 镇区、相关联系人 | 关闭 |
| `TALENT_CONTACT_PERSON_CHANGED` | 原联系人、新联系人、发起镇区 | 新联系人 `TALENT_FOLLOW_UP` |

---

# 12. 行程 / 走访

| Event | 消息 | Todo |
|---|---|---|
| `TRIP_CREATED` | 被加入参与人 | 无 |
| `TRIP_PARTICIPANT_ADDED` | 新参与人 | 无 |
| `TRIP_UPDATED` | 全部参与人 | 无 |
| `TRIP_CANCELED` | 全部参与人 | 关闭 `TRIP_RESULT` |
| `TRIP_RESULT_DUE` | 全部参与人 | 每人可见同一共享 `TRIP_RESULT` |
| `TRIP_RESULT_SUBMITTED` | 全部参与人 | 所有参与人的该Trip Todo同时关闭 |
| `VISIT_CREATED` | 不必额外消息 | 无 |
| `VISIT_LEAD_CREATED` | 负责镇区 | `LEAD_VERIFY` |

自动 `TRIP_RESULT_DUE` 每轮只产生一次。

---

# 13. 来离宝

来离宝原则上不做高频提醒。

| Event | 消息 | Todo |
|---|---|---|
| `PRESENCE_CREATED` | 本人可不发 | 无 |
| `PRESENCE_UPDATED` | 本人可不发 | 无 |
| `PRESENCE_CANCELED` | 本人可不发 | 无 |

不做签到 / 离宝确认 Todo。

---

# 14. 报销

| Event | 消息 | Todo |
|---|---|---|
| `REIMBURSEMENT_SUBMITTED` | 申请人可显示状态即可 | 报销管理 `REIMBURSEMENT_REVIEW` |
| `REIMBURSEMENT_RETURNED` | 申请人 | 申请人 `REIMBURSEMENT_REVISE` |
| `REIMBURSEMENT_VERIFIED` | 申请人 | 无（不做纸质材料催交） |
| `REIMBURSEMENT_PAPER_RECEIVED` | 申请人 | 报销管理 `REIMBURSEMENT_SUBMIT_FINANCE` 可在工作池体现 |
| `REIMBURSEMENT_PAPER_INCOMPLETE` | 申请人 | 无系统催交；状态回待交材料 |
| `REIMBURSEMENT_FINANCE_SUBMITTED` | 申请人 | 关闭全部当前报销Todo |
| `REIMBURSEMENT_WITHDRAWN` | 报销管理可收到状态消息 | 关闭审核Todo |
| `REIMBURSEMENT_STATE_CORRECTED` | 申请人、相关报销管理 | 按新状态重建合法Todo |

**明确：不设置纸质材料催交提醒。**

---

# 15. 办事求助

| Event | 消息 | Todo |
|---|---|---|
| `HELP_CREATED` | 管理员 | 管理员 `HELP_ACCEPT_OR_ASSIGN` |
| `HELP_TRANSFERRED_ORG` | 被转交单位有效人员 | 单位池 `HELP_CLAIM` |
| `HELP_ASSIGNED_PERSON` | 被指派主办人 | 主办人 `HELP_PROCESS` |
| `HELP_CLAIMED` | 提交人、管理员 | 主办人 `HELP_PROCESS` |
| `HELP_PROGRESS_UPDATED` | 提交人 | 原 `HELP_PROCESS` 保持 |
| `HELP_OVERDUE` | 主办人、管理员 | 主办人 `HELP_OVERDUE_PROCESS`; 管理员关注 | 每轮一次 |
| `HELP_COMPLETED` | 提交人 | 关闭处理Todo |
| `HELP_REOPENED` | 原/新主办人、管理员 | 主办人 `HELP_PROCESS` |
| `HELP_REASSIGNED` | 原主办人、新主办人、提交人 | 新主办人 `HELP_PROCESS` |
| `HELP_WITHDRAWN` | 管理员/当前相关人 | 关闭所有 |

---

# 16. 公告

| Event | 消息 | Todo |
|---|---|---|
| `ANNOUNCEMENT_PUBLISHED_NORMAL` | 目标用户站内消息 | 无 |
| `ANNOUNCEMENT_PUBLISHED_CONFIRM` | 目标用户 | 每人 `ANNOUNCEMENT_CONFIRM` |
| `ANNOUNCEMENT_CONTENT_UPDATED_NORMAL` | 当前目标用户“公告已更新” | 无 |
| `ANNOUNCEMENT_CONTENT_UPDATED_CONFIRM` | 当前目标用户 | 关闭旧确认Todo，新版本创建 `ANNOUNCEMENT_CONFIRM` |
| `ANNOUNCEMENT_AUDIENCE_ADDED` | 新增目标用户 | 若需确认则Todo |
| `ANNOUNCEMENT_AUDIENCE_REMOVED` | 可不发消息 | 立即失去当前访问；关闭相关Todo |
| `ANNOUNCEMENT_WITHDRAWN` | 可选汇总消息 | 关闭确认Todo |

首页公告优先级由 Home Query 实时计算，不用 Todo 顺序替代：

```text
本人待确认的重要公告
→ 置顶
→ 最新
```

---

# 17. 账号 / 权限

| Event | 消息 | Todo |
|---|---|---|
| `ACCOUNT_ENABLED` | 运营通常线下统一通知登录，站内尚不能收 | 无 |
| `PASSWORD_RESET` | 当前 Session 已全部退出，线下通知 | 强制改密通过Auth Guard实现，不建Todo |
| `ROLE_CHANGED` | 被授权人可收到“权限已更新” | 无 |
| `HIGH_PRIVILEGE_CHANGED` | 被授权人 + 超级管理员审计 | 无 |
| `PHONE_CHANGED` | 原Session退出 | 无 |

---

# 18. 导入 / 导出 / 系统任务

| Event | 消息 | Todo |
|---|---|---|
| `IMPORT_COMPLETED` | 发起人 | 无 |
| `IMPORT_FAILED` | 发起人 | 可进入任务详情，不建业务Todo |
| `EXPORT_READY` | 发起人 | 无 |
| `EXPORT_FAILED` | 发起人 | 无 |
| `AI_TASK_FAILED` | 普通用户只在原页面看到降级；管理员看健康 | 无 |
| `INDEX_REFRESH_FAILED` | 超级管理员/技术运营异常池 | 系统异常工作项，可不进入普通Todo |

---

# 19. 优先级

Todo：

```text
P0 紧急且立即处理
P1 有明确截止
P2 普通业务处理
P3 低频维护
```

首页排序：

```text
priority
→ due_at
→ created_at
```

不要用AI决定待办优先级。

---

# 20. 去重键示例

```text
todo:
DEMAND_REVIEW:{demandId}:{adminPool}
DEMAND_REVISE:{demandId}:{areaId}
TRIP_RESULT:{tripId}:{personId}
ANNOUNCEMENT_CONFIRM:{versionId}:{personId}

message:
DEMAND_STALE:{demandId}:{recipient}
TRIP_UPDATED:{tripId}:{recipient}
```

消息聚合更新 `latest_event_at`，不无限刷同类列表。

---

# 21. 红线

1. 不把“被加入行程”变待办；
2. 不把一般状态通知变待办；
3. 不每日重复发送自动催促；
4. 不新增纸质报销材料催交提醒；
5. 不通过消息泄露无权限业务标题/联系人；
6. 不在业务结束后留下可点击执行的旧 Todo；
7. 不向历史往届无账号人员生成站内消息；
8. 不给企业公开填报人生成平台消息；
9. 不因为AI推荐就强制分配需求；
10. 不让消息生成失败回滚已经成功的业务事务；使用Outbox补偿。

**MESSAGE_TODO_MATRIX.md v1.1 END**
