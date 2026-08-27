# 智链宝 V2.0 — DATA_DICTIONARY.md

> 版本：v1.1
> 状态：开发基线  
> 上游：PRD v1.3、PERMISSIONS v1.3、STATE_MACHINES v1.1、DATA_MODEL v1.2
> 说明：本文件固定核心字段、校验、默认值、敏感等级与统计语义。最终 Prisma 字段长度可在不改变业务语义的前提下微调。

## 0. 通用约定

### 0.1 类型

| 记法 | 数据库建议 |
|---|---|
| UUID | `String @db.Char(36)` 或 Prisma原生兼容UUID方案 |
| TEXT-S | `VarChar(100~255)` |
| TEXT-L | `Text` |
| DATETIME | `DateTime` |
| DATE | `DateTime @db.Date` |
| DECIMAL | `Decimal(18,2)` 默认 |
| BOOL | `Boolean` |
| JSON | `Json`，仅用于快照/非核心动态元数据 |

### 0.2 通用正式表字段

正式业务主表统一至少：

| 字段 | 含义 | 必填 |
|---|---|---:|
| `id` | 不可变内部ID | 是 |
| `created_at` | 创建时间 | 是 |
| `created_by_person_id` | 创建人，系统任务可为空 | 条件 |
| `updated_at` | 当前版本更新时间 | 是 |
| `source_system` | `V2` / `V1_MIGRATION` 等 | 是 |
| `source_record_id` | 旧系统ID，迁移时填写 | 否 |

禁止把 `name/phone/org_name` 当外键。

### 0.3 敏感等级

| 等级 | 定义 | 示例 |
|---|---|---|
| S0 | 普通系统元数据 | 状态代码 |
| S1 | 内部业务信息 | 企业、需求、政策 |
| S2 | 内部联系信息 | 手机号、联系人 |
| S3 | 专属敏感业务 | 报销、求助、人才原始材料 |
| S4 | 安全机密 | 密码哈希、Session、Secret、备份 |

S4 不进入普通业务导出。

---

# 1. Person / Account

## 1.1 Person

| 字段 | 类型 | 必填 | 规则 |
|---|---|---:|---|
| `id` | UUID | 是 | 永久不变 |
| `name` | VARCHAR(80) | 是 | 不作为主键 |
| `contact_phone` | VARCHAR(30) | 否 | 无 Account 的历史往届联系方式；存在 Account 时以 `Account.phone` 为当前电话真源 |
| `gender` | ENUM/nullable | 否 | 如业务确需 |
| `avatar_attachment_id` | UUID | 否 | 团员照片 |
| `person_status` | ENUM | 是 | `ACTIVE/ARCHIVED`，不等于账号状态 |
| `created_at` | DATETIME | 是 | 北京时间语义统一 |
| `updated_at` | DATETIME | 是 |  |

历史往届可有 Person 但无 Account。

## 1.2 Account

| 字段 | 类型 | 必填 | 规则 |
|---|---|---:|---|
| `id` | UUID | 是 |  |
| `person_id` | UUID | 是 | 唯一 |
| `phone` | VARCHAR(20) | 是 | 当前有效唯一；登录账号 |
| `password_hash` | VARCHAR(255) | 是 | Argon2id，S4 |
| `status` | ENUM | 是 | `PENDING_ENABLE/UNACTIVATED/NORMAL/DISABLED` |
| `force_password_change` | BOOL | 是 | 默认false；重置后true |
| `first_password_changed_at` | DATETIME | 否 | 判断是否完成过首次改密 |
| `confidentiality_confirmed_at` | DATETIME | 否 | 首次激活必填 |
| `permission_version` | BIGINT | 是 | 初始1；权限变化递增 |
| `last_login_at` | DATETIME | 否 |  |
| `created_at` | DATETIME | 是 |  |
| `updated_at` | DATETIME | 是 |  |

密码规则：

- 初始密码 = 手机号后6位；
- 新密码 >= 8 位；
- 新密码不得等于本人手机号后8位；
- 不保存明文。

## 1.3 AccountPhoneHistory

记录：

```text
old_phone
new_phone
reason
changed_by
changed_at
```

高权限账号手机号仅超级管理员可变更。

## 1.4 Session

| 字段 | 规则 |
|---|---|
| `id` | UUID |
| `account_id` | 外键 |
| `token_hash` | 只存服务端不可逆摘要，S4 |
| `device_id` | 稳定设备标识的受控值 |
| `device_name` | “iPhone / Edge”等展示名 |
| `user_agent` | 限长 |
| `ip_last` | 安全日志使用 |
| `permission_version` | 创建/刷新时版本 |
| `expires_at` | 默认30天 |
| `revoked_at` | 失效时填 |
| `created_at` |  |

同账号最多2条未撤销且未过期 Session。

---

# 2. Organization / AdministrativeArea

## 2.1 Organization

| 字段 | 规则 |
|---|---|
| `id` | UUID |
| `name` | 正式组织名称 |
| `type` | `TOWNSHIP_ORG/DEPARTMENT/DISPATCH_UNIT/POST_UNIT/OTHER_INTERNAL` |
| `parent_id` | 可空 |
| `status` | `ACTIVE/INACTIVE` |
| `phone` | 组织电话，可空 |
| `address` | 可空 |
| `latitude/longitude` | 派出单位地图可用；不是实时定位 |

## 2.2 AdministrativeArea

| 字段 | 规则 |
|---|---|
| `id` | UUID |
| `name` | 宝应县、安宜镇、高新区等 |
| `type` | `COUNTY/TOWNSHIP/PARK/HIGH_TECH_ZONE/DEVELOPMENT_ZONE/OTHER_AREA` |
| `parent_id` | 行政层级 |
| `status` | ACTIVE/INACTIVE |
| `sort_order` | UI稳定排序 |

## 2.3 OrganizationAreaMapping

```text
organization_id
area_id
effective_at
expired_at
```

组织与行政区域不混表。

## 2.4 Appointment

| 字段 | 规则 |
|---|---|
| `person_id` | 内部人员 |
| `organization_id` | 任职组织 |
| `position_title` | 岗位/职务 |
| `effective_at` | 必填 |
| `expired_at` | 可空 |
| `is_primary` | 可选 |

旧任职不覆盖。

## 2.5 DepartmentTownshipRelation

实际字段：

```text
department_organization_id
area_id
effective_at
expired_at
```

`area_id` 可指镇区/园区/高新区等负责区域。

---

# 3. Role / Permission

## 3.1 RoleAssignment

| 字段 | 规则 |
|---|---|
| `person_id` |  |
| `role_code` | 固定产品角色；包含独立 `GROUP_LEADER` 与 `MINISTER` |
| `effective_at` |  |
| `expired_at` |  |
| `granted_by_person_id` | 高权限必填 |
| `reason` | 高权限必填 |

核心角色代码以 PERMISSIONS.md 为准。

第一阶段固定角色枚举包含：

```text
MEMBER_CURRENT
MEMBER_ALUMNI_PLATFORM
GROUP_LEADER
MINISTER
TOWNSHIP_STAFF
DEPARTMENT_STAFF
ADMIN
SUPER_ADMIN
LEADER_STAGE2
```

`MINISTER` 属于显式高权限角色，`effective_at`、`granted_by_person_id` 和 `reason` 必填，`expired_at` 表示授权失效时间。职位文本“部长”不等于角色授权。

## 3.2 SpecialPermissionGrant

| 字段 | 规则 |
|---|---|
| `person_id` |  |
| `permission_code` | 如 `reimbursement.manage` |
| `effective_at` |  |
| `expired_at` |  |
| `reason` | 必填 |
| `granted_by_person_id` | 必填 |

---

# 4. Batch / Member

## 4.1 Batch

| 字段 | 规则 |
|---|---|
| `id` | UUID |
| `name` | 批次展示名 |
| `year` | 数值/文本 |
| `start_date` |  |
| `end_date` | 可空 |
| `status` | `PLANNED/ACTIVE/CLOSED` |
| `is_current` | 同时仅一个 true；也可由状态+系统参数实现 |

## 4.2 BatchMembership

| 字段 | 规则 |
|---|---|
| `person_id` |  |
| `batch_id` |  |
| `dispatch_organization_id` | 派出单位 |
| `post_organization_id` | 挂职单位 |
| `position_title` | 挂职职务 |
| `start_date/end_date` | 任期 |
| `status` |  |

唯一：`person_id + batch_id`。

一人最多3个批次为 Service 规则。

## 4.3 MemberCapabilityProfile

| 字段 | 规则 |
|---|---|
| `person_id` | 唯一 |
| `professional_direction` | TEXT |
| `familiar_industries` | 结构化标签关系优先 |
| `coordinatable_resources` | TEXT |
| `preferred_demand_types` | 结构化多选 |
| `updated_by_person_id` |  |
| `updated_at` |  |

这些字段可参与需求推荐。

结构化多选正式落表：

- `MemberIndustry(id, name, status)`：行业字典，`name` 唯一；
- `MemberCapabilityIndustry(person_id, industry_id)`：联合主键；
- `MemberPreferredDemandType(person_id, demand_type)`：联合主键，类型为 `TECHNICAL/TALENT/PROJECT/OTHER`。

不得以逗号拼接字符串作为行业或意向需求类型真源。

---

# 5. Enterprise

## 5.1 Enterprise

| 字段 | 类型 | 必填 | 规则 |
|---|---|---:|---|
| `id` | UUID | 是 |  |
| `name` | VARCHAR(200) | 是 | 正式名称 |
| `responsible_area_id` | UUID | 是 | 正式所属镇区/园区 |
| `address` | VARCHAR(500) | 是 |  |
| `credit_code` | VARCHAR(32) | 否 | 有值时优先唯一去重 |
| `legal_representative` | VARCHAR(80) | 否 |  |
| `introduction` | TEXT | 否 |  |
| `main_products` | TEXT | 是/业务要求 | 列表核心 |
| `qualifications_honors` | TEXT | 否 |  |
| `latitude` | DECIMAL | 否 | 地图展示 |
| `longitude` | DECIMAL | 否 | 地图展示 |
| `geocode_status` | ENUM | 是 | `UNRESOLVED/RESOLVED/MANUAL/FAILED` |
| `status` | ENUM | 是 | `NORMAL/DISABLED/MERGED` |
| `merged_into_id` | UUID | 否 | MERGED时必填 |
| `primary_contact_id` | UUID | 否 | 受控冗余 |

行业标签使用 `EnterpriseTagRelation` 多对多，不用逗号拼接作为正式筛选真源。

## 5.2 EnterpriseContact

| 字段 | 必填 | 规则 |
|---|---:|---|
| `enterprise_id` | 是 |  |
| `name` | 是 |  |
| `position_title` | 否 |  |
| `phone` | 是 | 内部可见，S2 |
| `is_primary` | 是 | 默认false |
| `status` | 是 | `ACTIVE/INACTIVE` |
| `created_by_person_id` | 是 |  |
| `inactive_reason` | 条件 | 停用时 |

禁止物理删除。

## 5.3 EnterpriseChangeRequest

```text
request_type: CREATE/CORRECTION
proposed_area_id
target_enterprise_id
payload_snapshot
submitter_person_id
status
reviewer_person_id
review_reason
approved_enterprise_id
```

---

# 6. DemandLead

业务编号：

```text
XS-YYYY-###### 
```

## 6.1 核心字段

| 字段 | 必填 | 说明 |
|---|---:|---|
| `business_no` | 是 | 唯一 |
| `source_type` | 是 | `ENTERPRISE_PUBLIC/MEMBER_VISIT/OTHER` |
| `responsible_area_id` | 是 | 负责镇区 |
| `enterprise_id` | 否 | 未建档时为空 |
| `raw_enterprise_name` | 条件 | 未关联企业时保存 |
| `raw_contact_name` | 否 | 原来源 |
| `raw_contact_phone` | 否 | 原来源，受权限控制 |
| `raw_content` | 是 | 原始内容永久保留 |
| `source_person_id` | 否 | 团员走访等 |
| `source_channel` | 否 |  |
| `source_at` | 是 | 来源时间 |
| `trip_id` | 否 |  |
| `visit_id` | 否 |  |
| `status` | 是 | 线索状态机 |
| `converted_demand_id` | 否 | 转正式后 |
| `merged_into_lead_id` | 否 | 合并后 |
| `close_reason` | 条件 | 关闭时 |

原始附件通过 AttachmentLink 永久关联，不因转换覆盖。

---

# 7. Demand

业务编号：

```text
XQ-YYYY-######
```

## 7.1 核心字段

| 字段 | 类型 | 必填 | 规则 |
|---|---|---:|---|
| `business_no` | VARCHAR | 是 | 唯一 |
| `enterprise_id` | UUID | 是 | 正式企业 |
| `responsible_area_id` | UUID | 是 | 正式责任区域 |
| `selected_contact_id` | UUID | 是 | 本次需求联系人 |
| `contact_snapshot_id` | UUID | 是 | 历史快照 |
| `title` | VARCHAR(200) | 是 | AI不得自动生成 |
| `original_description` | TEXT | 是 | 企业/镇区原始需求，不由AI改写 |
| `demand_type` | ENUM | 是 | `TECHNICAL/TALENT/PROJECT/OTHER` |
| `urgency` | ENUM | 是 | `NORMAL/URGENT` |
| `status` | ENUM | 是 | 状态机定义 |
| `creation_batch_id` | UUID | 是 | 创建批次 |
| `current_follow_batch_id` | UUID | 是 | 当前跟进批次 |
| `is_cross_batch` | BOOL | 是 | 默认false，派生/受控 |
| `first_published_at` | DATETIME | 否 | 首次发布后永久不改 |
| `current_owner_person_id` | UUID | 否 | 查询冗余，历史真源另表 |
| `merged_into_id` | UUID | 否 | 已合并 |
| `canceled_reason` | TEXT | 条件 | 已取消 |

## 7.2 DemandProvenance

```text
demand_id
source_type
demand_lead_id?
trip_id?
visit_id?
legacy_source_id?
source_snapshot
created_at
```

## 7.3 DemandContactSnapshot

```text
enterprise_name
contact_name
contact_position
contact_phone
snapshot_at
```

## 7.4 DemandOwnerHistory

```text
demand_id
person_id
effective_at
expired_at
change_reason
changed_by
```

同一时刻最多一个 active。

## 7.5 DemandCollaborator

```text
demand_id
person_id
source: INVITED/APPLIED
status: ACTIVE/LEFT/REMOVED
effective_at
ended_at
end_reason
```

## 7.6 DemandAlumniHelper

```text
demand_id
person_id
helper_type: PLATFORM_ALUMNI/HISTORICAL_ALUMNI
response: WILLING/DECLINED/CONTACTED_OFFLINE
effective_at
ended_at
```

不得写成正式 owner。

## 7.7 DemandProgress

| 字段 | 说明 |
|---|---|
| `current_progress` | 本次进展描述 |
| `next_step` | 下一步 |
| `submitter_person_id` |  |
| `submitter_role_context` | 主责/协同/往届/镇区代录 |
| `created_at` |  |

追加式，不覆盖历史。

## 7.8 DemandReview

```text
decision: APPROVE/RETURN
return_category?
return_reason?
reviewer_person_id
reviewed_at
```

普通：3个工作日；紧急：1个工作日。时限由 WorkCalendar + 配置计算。

## 7.9 DemandRecommendationRun / Item

Run：

```text
demand_id
candidate_stage: CURRENT/ALUMNI
rules_version
prompt_version
model_metadata
created_at
```

Item：

```text
person_id
rank
reason
evidence_snapshot
user_response
responded_at
```

最多3名当前阶段候选。

---

# 8. Demand Outcome

## 8.1 DemandOutcomePlan

```text
demand_id
tracking_mode: NONE/TRACKING
first_tracking_date?
next_tracking_date?
status: NOT_TRACKED/PENDING/IN_PROGRESS/ENDED
```

## 8.2 DemandOutcomeRound

| 字段 | 口径 |
|---|---|
| `contract_amount_increment` | **本轮新增值** |
| `investment_amount_increment` | **本轮新增值** |
| `policy_fund_increment` | **本轮新增值** |
| `cost_reduction_increment` | **本轮新增值** |
| `talent_introduced_increment` | **本轮新增人数** |
| `patent_increment` | **本轮新增数量** |
| `qualitative_result` | 本轮定性成效 |
| `enterprise_feedback` | 本轮反馈 |
| `next_tracking_date` | 可空 |
| `end_tracking` | 是否结束 |
| `review_status` | `DRAFT/PENDING_REVIEW/RETURNED/APPROVED` |
| `verified_note` | 无附件时管理员线下核实说明 |

为什么使用“本轮新增”：

> 防止多轮跟踪时把同一累计值重复相加。

若未来需要“当前累计值 / 时点值”，必须新建明确后缀字段，不得复用 increment 字段。

正式统计只计算 `APPROVED`。

---

# 9. Talent

## 9.1 Talent

| 字段 | 必填 | 说明 |
|---|---:|---|
| `name` | 是 |  |
| `scope_type` | 是 | `DOMESTIC/OVERSEAS` |
| `organization_name` | 是 | 人才所在单位 |
| `title` | 是 | 职务/职称 |
| `professional_direction` | 是 |  |
| `work_education_experience` | 否 | 可AI提取后人工确认 |
| `representative_achievements` | 否 | 可AI提取后人工确认 |
| `original_recommender_person_id` | 是 | 永久来源 |
| `current_contact_person_id` | 是 | 可变当前联系人 |
| `status` | 是 | `ACTIVE/DISABLED/MERGED` |
| `merged_into_id` | 否 |  |

**禁止字段：**

```text
talent_phone
talent_email
```

不建设结构化人才本人联系方式。

## 9.2 TalentContactPersonHistory

```text
talent_id
person_id
effective_at
expired_at
change_reason
changed_by
```

## 9.3 TalentTownshipRound

```text
talent_id
area_id
round_no
status: IN_PROGRESS/COMPLETED/WITHDRAWN
started_by_person_id
current_handler_person_id?
started_at
completed_at?
withdrawn_at?
result_summary?
```

同人才+区域最多一个 IN_PROGRESS。

---

# 10. Policy

## 10.1 Policy

```text
title
issuing_department
publication_date
level
publication_status: DRAFT/PUBLISHED/WITHDRAWN
effect_status: CURRENT/REPLACED
current_version_id
published_at
withdrawn_at
```

每条政策必须有：

```text
primary_policy_attachment_id
```

补充附件可多份。

## 10.2 PolicyContentVersion

保存每次实质内容版本：

```text
policy_id
version_no
title
structured_fields_snapshot
primary_attachment_id
created_by
created_at
```

## 10.3 PolicyReplacementRelation

```text
new_policy_id
old_policy_id
reason
confirmed_by
confirmed_at
ended_at?
```

新政策撤回不得自动让旧政策变 CURRENT。

---

# 11. PresenceReport

```text
person_id
arrival_at           必填
expected_departure_at 必填
origin                可空
transport_mode        可空
train_flight_no       可空
note                  可空
canceled_at           可空
cancel_reason         条件
```

校验：

```text
expected_departure_at > arrival_at
```

同 Person 的未取消时间区间不得重叠。

状态派生，不保存 `is_in_baoying` 作为真源。

---

# 12. Trip / Visit

## 12.1 Trip

```text
business_no?          可选；若运营需要可增加 XC 编号
date                  必填
summary               必填
overall_end_at        可空
note                  可空
status                PLANNED/IN_PROGRESS/PENDING_RESULT/COMPLETED/CANCELED
creator_person_id
canceled_reason?
```

保存后即发布，不走审核。

## 12.2 TripParticipant

```text
trip_id
person_id
is_creator
joined_at
left_at?
```

同 `trip_id + person_id` 唯一。

## 12.3 TripNode

```text
trip_id
sequence_no
node_at
enterprise_id?       企业节点
location_name        活动地点/企业显示
address?
work_content
```

每个节点：时间、企业或活动地点、工作内容必填。

## 12.4 TripResult

```text
trip_id
summary
submitted_by_person_id
submitted_at
```

任一参与人提交一次共享结果。

## 12.5 EnterpriseVisit

```text
trip_id
trip_node_id
enterprise_id
visit_at
overall_result
created_from_trip_result_id
```

一条完成行程中每个企业生成一条走访。

---

# 13. Reimbursement

业务编号：

```text
BX-YYYY-######
```

## 13.1 Reimbursement

| 字段 | 必填 | 规则 |
|---|---:|---|
| `business_no` | 是 | 唯一 |
| `applicant_person_id` | 是 |  |
| `type` | 是 | `TRAVEL/ACTIVITY` |
| `reason` | 是 | 报销事由 |
| `trip_id` | 否 | 仅已完成行程 |
| `trip_snapshot` | 条件 | 关联行程提交时固化 |
| `status` | 是 | 报销状态机 |
| `total_amount` | 是 | Decimal，服务端重新计算 |
| `submitted_at` | 否 |  |
| `paper_received_at` | 否 |  |
| `finance_submitted_at` | 否 |  |

## 13.2 差旅固定四类

### 交通费 `TRAVEL_TRANSPORT_ACTUAL`

- 飞机票、高铁票等符合规则的实际交通费用；
- 不包含出租车、网约车打车费。

### 交通补助 `TRAVEL_TRANSPORT_SUBSIDY`

- 参考 80 元/天；
- 原则人工填写；
- 不从 OCR 生成。

### 伙食补助 `TRAVEL_MEAL_SUBSIDY`

- 参考 100 元/天；
- 原则人工填写；
- 不从餐饮发票生成。

### 住宿费 `TRAVEL_ACCOMMODATION_ACTUAL`

- 符合规则的实际住宿费用。

实际餐饮消费不进入差旅报销。

## 13.3 补助计算字段

```text
subsidy_type
reference_rate
claimed_days
claimed_amount
calculation_note
rule_version?
```

**当前禁止自动推导 claimed_days。**

原因：

> PRD 尚未确定当天往返、跨日、特殊情形等精确计发规则。

Codex 不得自行编公式。

## 13.4 活动报销费用

常用类型建议：

```text
DINING
VENUE
MATERIAL_PRODUCTION
SUPPLIES
ACCOMMODATION
TRANSPORT_RELATED
OTHER
```

这是方便录入的常用集合，不是封闭财务科目。

`OTHER` 必须：

```text
expense_name
```

活动 OCR 类别只是建议，允许人工调整。

## 13.5 ReimbursementExpenseItem

```text
reimbursement_id
expense_type
expense_name?
expense_date?
amount
seller?
invoice_no?
source: OCR/MANUAL
confirmed_by_applicant
```

## 13.6 Invoice/OCR

```text
attachment_id
ocr_task_id
detected_type
invoice_date
amount
seller
invoice_no
confidence_json
confirmed_snapshot
```

系统只做明确票号精确重复校验，不宣称验真。

---

# 14. HelpRequest

业务编号：

```text
QZ-YYYY-######
```

字段：

```text
business_no
submitter_person_id
category: ACCOMMODATION/TRANSPORT/DINING/WORK/LIFE/OTHER
title
description
status: PENDING/IN_PROGRESS/COMPLETED/WITHDRAWN
current_owner_person_id?
current_transferred_org_id?
expected_complete_at?
completed_at?
withdraw_reason?
reopen_reason?
```

唯一当前主办人由 AssignmentHistory 真源维护。

---

# 15. Announcement / Message / Todo

## 15.1 Announcement

```text
title
publication_status
need_confirmation
is_pinned
current_version_id
publisher_person_id
published_at
withdrawn_at
```

## 15.2 AnnouncementVersion

```text
announcement_id
version_no
title
body
created_at
```

标题/正文/附件实质变化创建新版本。

## 15.3 AnnouncementRecipientState

```text
announcement_version_id
person_id
read_at?
confirmed_at?
access_revoked_at?
```

范围移除后失去当前访问，但历史 read/confirm 保留。

## 15.4 Message

```text
recipient_person_id
event_type
business_type
business_id
title
summary
read_at?
created_at
aggregation_key?
```

## 15.5 Todo

```text
assignee_person_id
todo_type
business_type
business_id
priority
due_at?
status: OPEN/COMPLETED/CLOSED_INVALID
action_code
created_at
closed_at?
dedupe_key
```

首页只取 OPEN 且当前可立即执行的前3条。

---

# 16. Attachment

```text
id
original_filename
extension
mime_type
detected_file_type
size_bytes
sha256
cos_bucket
cos_object_key
upload_status
scan_status
is_temporary
permission_level
uploaded_by_person_id
created_at
```

单文件：

```text
size_bytes <= 50MB
```

禁止：

- 可执行文件；
- 文件名与真实类型明显不符；
- 扫描未通过文件直接下载。

---

# 17. AI / OCR

## 17.1 AICall

```text
capability
actor_person_id
provider
model
prompt_version
started_at
finished_at
duration_ms
status
estimated_cost
feedback
error_code
```

普通日志不存私人完整 prompt/response。

## 17.2 AIConversation / AIMessage

正文只本人可访问。

建议正文单独表并对数据库访问层设置专用 Repository。

## 17.3 SemanticIndexRecord

```text
business_type
business_id
business_version
index_status
indexed_at
last_error
```

VectorDB index key = 稳定业务ID + 版本。

---

# 18. Audit / State / Outbox / Job

## 18.1 AuditLog

```text
actor_person_id
actor_account_id
action_code
entity_type
entity_id
before_json
after_json
reason
ip
device
request_id
created_at
```

追加写。

## 18.2 StateTransitionHistory

```text
entity_type
entity_id
from_state
to_state
action_code
actor_person_id
reason
metadata_json
request_id
created_at
```

## 18.3 OutboxEvent

```text
event_type
aggregate_type
aggregate_id
payload_json
dedupe_key
occurred_at
published_at?
attempts
last_error?
```

## 18.4 JobTask

```text
job_type
payload_json
status
priority
idempotency_key
scheduled_at
locked_at?
locked_by?
retry_count
max_retries
finished_at?
last_error?
```

`idempotency_key` 对同一逻辑任务唯一。

---

# 19. Import / Export / Migration

## 19.1 ImportTask

```text
type
source_attachment_id
mapping_json
status
created_by
snapshot_id?
started_at?
finished_at?
```

## 19.2 ImportRowResult

```text
row_no
raw_snapshot
match_result
action
target_entity_id?
validation_errors
```

## 19.3 ExportTask

```text
export_type
query_snapshot
scope_snapshot
status
output_attachment_id?
expires_at
created_by
downloaded_at?
```

## 19.4 LegacyMigrationMap

唯一：

```text
source_system
source_entity
source_id
```

映射：

```text
target_entity
target_id
migration_batch_id
migrated_at
```

---

# 20. Map

## 20.1 MapBoundaryVersion

```text
area_id
version
geojson_attachment_id
effective_at
status
change_note
created_by
```

## 20.2 Enterprise coordinate

```text
latitude
longitude
geocode_status
geocode_provider
geocoded_at
coordinate_updated_by
```

坐标变化不更新 `responsible_area_id`。

---

# 21. 统计数据字典

全系统：

```text
timezone = Asia/Shanghai
period = natural month
```

## 21.1 需求

| 指标 | 统计时点 | 去重键 | 规则 |
|---|---|---|---|
| 本月新增需求 | `first_published_at` | demand.id | 首次正式发布落在本月 |
| 本月办结 | 办结审核通过时间 | demand.id | 跨批次归实际办结批次 |
| 月末待审核 | 月末状态 | demand.id | PENDING_REVIEW |
| 月末退回修改 | 月末状态 | demand.id | RETURNED |
| 月末待对接 | 月末状态 | demand.id | PENDING_CLAIM |
| 月末对接中 | 月末状态 | demand.id | IN_PROGRESS |
| 月末待办结审核 | 月末状态 | demand.id | PENDING_CLOSE_REVIEW |
| 久未更新 | 月末/查询时点 | demand.id | IN_PROGRESS子集，不重复加入主状态总和 |
| 待成效跟踪 | 月末 | demand.id | 已到计划日期且 PENDING/IN_PROGRESS |

## 21.2 资源

| 指标 | 去重 |
|---|---|
| 企业总数 | Enterprise.id |
| 有效企业数 | Enterprise.id 且 status=NORMAL |
| 当前批次团员人数 | Person.id 去重 |
| 月末在宝人数 | Person.id 去重 |
| 本月到宝人次 | PresenceReport.id |

## 21.3 行程

| 指标 | 规则 |
|---|---|
| 行程次数 | Trip.id |
| 参与人次 | TripParticipant活动记录数 |
| 去重参与人数 | Person.id |
| 去重走访企业数 | Enterprise.id |
| 形成需求线索数 | DemandLead.id 且来源为走访 |

## 21.4 人才

| 指标 | 规则 |
|---|---|
| 本月新增人才 | 正式入库时间 |
| 本月完成对接 | Round completed_at |
| 月末对接中 | Round status=IN_PROGRESS |
| 国内/海外 | Talent.scope_type |

## 21.5 成效

只统计：

```text
DemandOutcomeRound.review_status = APPROVED
```

金额指标汇总本轮 increment 字段。

---

# 22. 字段修改权限原则

- 用户能力画像：本人可改允许字段；
- 人员任职/角色：管理员或超级管理员按权限；
- 正式企业/人才/需求核心字段：普通提交人不能发布后覆盖；
- 管理员正式纠错：必须原因 + 版本；
- 报销已提交后：按状态机退回再改；
- 线索原始来源：永久不可覆盖；
- 人才原推荐人：永久来源，不静默替换；
- 历史联系人快照：不可随当前联系人变化。

---

# 23. 明确的“待制度确定”项

当前只有一个会直接影响计算的关键未定规则：

> 差旅交通补助、伙食补助的精确计发天数规则。

包括但不限于：

- 当天往返；
- 跨日；
- 部分日；
- 特殊出差；
- 与其他补助互斥。

技术处理：

```text
第一阶段保留 reference_rate
+ claimed_days
+ claimed_amount
+ calculation_note
```

先人工按实际财务制度填写。

**Codex不得自行推断公式。**

制度明确后：

```text
新增 REIMBURSEMENT_RULES vX
→ 更新数据字典
→ 实现 Rule Engine
→ 保留 rule_version
```

**DATA_DICTIONARY.md v1.1 END**
