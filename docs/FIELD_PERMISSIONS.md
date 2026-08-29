# 智链宝 V2.0 — FIELD_PERMISSIONS.md

> 版本：v1.1
> 状态：字段级权限基线  
> 说明：动作权限详见 PERMISSIONS；这里锁定容易误改/误看的核心字段组。

符号：

```text
R  可读
W  可直接修改
S  可提交申请/补充
C  可正式纠错（需原因/版本/审计）
—  无
```

# 1. 正式公共内部资源

所有有效内部用户原则上可 R：

- 正式企业；
- 企业联系人完整电话；
- 团员与联系方式；
- 正式人才及内部推荐/对接联系人；
- 政策；
- 已发布需求；
- 正式需求附件。

报销、求助、AI私人正文除外。

## 1.1 团队协调角色字段边界

`GROUP_LEADER` 与 `MINISTER` 共享 `TEAM_COORDINATOR_CAPABILITIES`，可读取全团概览、当前在宝、今日行程和全县月度工作台账，并可创建全团共享行程、对久未更新需求发出协调提醒。

该能力包不授予字段级业务写权限。仅持 `MINISTER` 时：

- 需求主责、协同、进展和办结字段无写权限；
- 镇区正式需求、审核、取消和负责人转交字段无写权限；
- 他人报销、求助、AI 私人正文、完整审计与备份字段无读取或写入权限；
- 通过同时持有的 `MEMBER_CURRENT`、`ADMIN` 等其他有效角色获得的字段权限按多角色合并计算。

页面身份标签和审计字段必须保存实际角色代码，部长不得显示或记录为团长。

---

# 2. Demand

| 字段组 | 在任团员 | 镇区 | 部门 | ADMIN | SUPER |
|---|---:|---:|---:|---:|---:|
| 已发布核心内容 | R | R | R | R/C | R/C |
| 企业原始描述 | R | 草稿W/发布后S | R/S | 发布前不得静默W；发布后C | C |
| 企业/联系人 | R | 草稿W | R | 发布前退回；发布后C | C |
| 标题 | R | 草稿W | R | 发布前退回；发布后C | C |
| 类型/紧急/标签 | R | 草稿W | R | 审核时W | W |
| 主责 | 本人可认领 | R/往届路径经办 | R | 运营R，不可强制转交 | W(正式转交) |
| 进展 | 主责/协同S | 往届路径S | R | C/运营补充按规则 | C |
| 状态 | 动作触发 | 合法动作 | — | 审核动作 | 高风险纠正 |
| AI推荐名单 | 被推荐本人R | 本区R | — | R/W人工管理 | R/W |

客户端永远不能直接 W `status/current_owner_id`。

## 2.1 M1-006 生命周期字段边界

| 字段/事实 | MEMBER_CURRENT | MEMBER_ALUMNI_PLATFORM | 负责镇区 staff | ADMIN | SUPER |
|---|---|---|---|---|---|
| Progress 正文 | 对象级 owner/collaborator S | 仅 active PLATFORM helper S | 本区 S | S | S |
| Progress 历史 | R | R | R | R | R |
| 历史往届代理字段 | — | — | current handler 可 S | S | S |
| CloseRequest | 仅 current owner S | — | 仅 current handler S | R | R |
| CloseReview 核验结果 | R | R | R | W（审核动作） | W（审核动作） |
| OwnerExitRequest | 仅 current owner S | — | — | R/W（审核） | R/W（审核） |
| current owner / OwnerHistory | 只读；认领/退出动作触发 | R | R | R，不可强制转交 | preview+confirm 正式转交 |
| completed/canceled facts | R | R | 合法取消动作触发 | 审核/取消动作触发 | 审核/取消动作触发 |

表中 capability 仍需与状态、责任模式、active relation 和数据范围合并校验，不能解释为对任意 Demand 的字段写权限。

`DemandProgress`、`DemandCloseRequest`、`DemandCloseReview` 和 `DemandOwnerExitRequest` 均为历史事实，不提供普通字段覆盖。Progress/Close 附件为 Private Attachment；只有 `scanStatus=PASSED` 后可正式 link，每次下载重新执行 Demand parent visibility，不能暴露永久对象存储 URL。

## 2.2 M1-007 Outcome 字段边界

| 字段/事实 | 普通内部/往届协助 | 负责镇区 staff | 其他镇区 | ADMIN/SUPER | ADMIN/SUPER + 负责镇区角色 |
|---|---|---|---|---|---|
| Plan 策略/日期 | R | R | R | 仅办结 APPROVE 或历史补建时 W 一次 | 同左 |
| APPROVED Round/合计 | R | R | R | R | R |
| 活动 Round 正文/退回原因 | — | R/W（仅 DRAFT/RETURNED） | — | R/审核动作 | R；镇区身份可按规则 W |
| increment/trackingDate/end/next | — | 创建/显式保存 W | — | 不可代填 | 镇区身份 W |
| trackingBatchId/roundNo/status | R正式值 | 服务端生成，只读 | R正式值 | 审核动作触发状态 | 同左 |
| verifiedNote | R（APPROVED） | 只读 | R（APPROVED） | APPROVE 时 W | APPROVE 时 W |
| evidence | APPROVED R | 活动/历史 R，可在 DRAFT/RETURNED 新增 | 仅 APPROVED R | 活动/历史 R，不可新增 | 镇区身份可新增 |

客户端不得写累计总额、`trackingBatchId`、审核字段、接收人或 Plan 状态。APPROVED Round、旧 evidence、Audit/Transition 均不可普通覆盖或删除。

---

# 3. Demand Lead

| 字段 | 来源人/团员 | 负责镇区 | 部门 | ADMIN |
|---|---|---|---|---|
| 原始来源正文/附件 | 创建时S，之后只读 | R | 按范围R | R |
| 核验补充内容 | —/补充按入口 | W | R | W/接管 |
| 类型/紧急 | 团员线索不填 | 转正式草稿时W | — | 审核辅助W |
| 来源人/来源时间 | 只读 | 只读 | 只读 | C仅错误纠正 |
| 合并/关闭 | — | 合法动作 | — | 合法动作 |

原始来源不得覆盖。

---

# 4. Enterprise

| 字段组 | 普通内部 | 本区镇区 | 部门 | ADMIN | SUPER |
|---|---|---|---|---|---|
| 正式企业 | R | R/S纠错 | R/S纠错 | W/C | W/C |
| 企业正式区域 | R | S | S | W/C | W/C |
| 坐标 | R | S纠错 | S | W | W |
| 联系人 | R | W本区 | R | W/C | W/C |
| 主联系人 | R | W本区 | R | W | W |
| 合并 | — | — | — | W | W/可恢复错误合并 |

联系人不物理删除。

---

# 5. Member

| 字段组 | 本人 | 其他内部 | ADMIN | SUPER |
|---|---|---|---|---|
| 基础档案 | R | R | W/C | W/C |
| 联系方式 | R | R | W(普通账号规则) | W |
| 能力画像 | W | R | W/C | W/C |
| 批次 | R | R | W | W |
| 派出/挂职 | R | R | W | W |
| 团长 | R | R | — | W |
| 部长 | R | R | — | W |
| 管理员/高权限 | R本人 | — | — | W |

---

# 6. Talent

| 字段组 | 团员 | 镇区 | 部门 | ADMIN |
|---|---|---|---|---|
| 正式人才 | R/S新增纠错 | R/S | R/S | W/C |
| 原推荐人 | R | R | R | 形成正式后只能C，不静默替换 |
| 当前对接联系人 | R | R | R | W并保留历史 |
| 人才本人结构化电话 | 不存在 | 不存在 | 不存在 | 不得创建 |
| 本镇对接轮次 | R | W | 协助R | R/C |
| 其他镇对接轮次 | R正式可见范围 | R | R | R/C |

---

# 7. Policy

| 字段组 | 普通内部 | ADMIN | SUPER |
|---|---|---|---|
| 已发布政策 | R | R/W版本 | R/W |
| 原始主文件 | R | W版本 | W |
| AI解读 | R且明确AI | W确认 | W |
| 效力/替代 | R | W需依据 | W |
| 撤回 | — | W | W |

AI建议不能直接W效力关系。

---

# 8. Presence

| 字段 | 本人 | 其他内部 | ADMIN |
|---|---|---|---|
| 当前在宝时间 | W本人记录 | R当前 | W纠错 |
| 历史本人记录 | R | — | R |
| 历史他人记录 | — | — | R |
| 实时位置 | 不存在 | 不存在 | 不存在 |

---

# 9. Trip

| 字段 | 创建人 | 参与人 | 其他内部 | ADMIN |
|---|---|---|---|---|
| 核心行程 | W | R | R | C |
| 参与关系 | W添加 | 可退出规则 | R | C |
| 共享结果 | W/可提交 | 任一可提交 | R | C |
| 他人补充 | 不覆盖 | 不覆盖 | R | C |

---

# 10. Reimbursement

| 字段组 | 申请人 | 普通ADMIN | 报销管理 | SUPER |
|---|---|---|---|---|
| 本人报销 | R/W按状态 | 无权 | R | R |
| 他人报销 | — | — | R | R |
| 票据 | R | — | R | R |
| OCR确认字段 | W本人提交前 | — | R核对 | R |
| 核对状态 | — | — | W动作 | W |
| 纸质材料状态 | — | — | W动作 | W |
| 状态纠正 | — | — | C | C |
| “已付款” | 不存在 | 不存在 | 不存在 | 不得创建 |

报销管理权限不赋予其他ADMIN能力。

补充：

- `ADMIN` 可按人开启/关闭平台注册往届的 `reimbursement.apply`；
- 该动作不赋予 `ADMIN` 对该人员报销内容的读取权限；
- `reimbursement.manage` 只能由 `SUPER_ADMIN` 授予。

---

# 11. Help

| 字段组 | 提交人 | 当前主办人 | 被转交单位 | ADMIN |
|---|---|---|---|---|
| 内容 | R | R | R | R |
| 提交前撤回 | W动作 | — | — | R |
| 预计完成日期 | R | W受理时 | 接手后W | W/C |
| 进展 | R | W追加 | 主办人以外R | W/C |
| 办结结果 | R | W | — | C |
| 重新打开原因 | W动作 | R | R | R |
| 分派 | — | — | 可接手 | W |

其他普通用户全无权。

---

# 12. Announcement

| 字段 | 目标用户 | ADMIN | SUPER |
|---|---|---|---|
| 当前可见版本 | R | R/W版本 | R/W |
| 已读 | W本人状态 | 汇总R | 汇总R |
| 确认 | W本人 | 汇总R | 汇总R |
| 目标范围 | 仅知道自身可见 | W | W |
| 历史确认审计 | 本人可见自身 | R | R |

被移除目标后失去当前内容访问，但历史审计保留。

---

# 13. AI

| 数据 | 本人 | ADMIN | SUPER |
|---|---|---|---|
| 本人完整对话 | R | — | — |
| 他人完整对话 | — | — | — |
| 调用次数/失败/耗时 | 本人可不显示 | R汇总 | R |
| 供应商配置 | — | 按产品限制只读/运营 | W高权限 |

这是绝对隐私边界。

---

# 14. System

| 字段/能力 | ADMIN | SUPER |
|---|---|---|
| 普通运营参数 | W允许项 | W |
| 核心状态定义 | — | 也不得后台自由改 |
| 角色核心语义 | — | 也不得后台自由改 |
| 完整审计 | — | R |
| 备份 | — | R/W |
| 恢复 | — | W高风险 |
| 需求负责人转交 | — | W高风险 |
| 高权限授权 | — | W高风险 |

产品版本规则即使 SUPER 也不能在后台自由修改。

## M3-005 批量字段边界

- Import Field Registry 不提供管理员、超级管理员、团长、部长、敏感权限、账号状态或业务状态 canonical target。
- 企业匹配后只更新正式管理端允许编辑字段；团员重导不得更新账号密码或状态；人才不导入结构化本人电话/邮箱。
- Export 使用显式字段白名单，不包含附件 URL、Resume、Session、Audit 全量 JSON 或 Import staging。

## C-M3-004 月报字段边界

- 五表不含联系人电话、Talent 本人电话/email、报销、求助、私人 AI 对话、附件永久 URL。
- Demand 责任人、人才处理人仅输出内部安全姓名；区域 Trip 只输出 in-scope EnterpriseVisit/企业节点，结果摘要不拼接县外节点内容。
- 所有字符串写 Excel 前转义 `= + - @`；金额统计保持 Prisma.Decimal，工作簿显示两位小数。

**FIELD_PERMISSIONS.md v1.1 END**
