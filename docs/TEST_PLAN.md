# 智链宝 V2.0 — TEST_PLAN.md

> 版本：v1.1
> 状态：开发基线  
> 目标：不是“页面能打开”，而是权限、状态、并发、迁移和恢复都可验证。

## 1. 测试层级

```text
Unit
Integration
E2E
Security
AI/OCR Eval
Migration Rehearsal
Backup Restore Drill
UAT
```

## 2. CI 必跑

每个 PR：

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
npm run test:e2e:critical
```

失败不得合并 main。

## 3. Unit

重点：

- 状态机 transition；
- Permission resolver；
- 数据范围；
- 业务编号；
- 报销规则；
- Todo 去重；
- 统计口径；
- EntityMatcher；
- AI Sanitizer。

## 4. Integration

使用独立 TEST DB。

必须验证真实事务：

- 认领；
- 同镇人才唯一活动轮次；
- 求助唯一主办人；
- 企业主联系人；
- Outbox；
- Migration。

禁止大量 mock 数据库让事务测试失真。

## 5. E2E

Playwright。

关键路径：

### Auth

```text
待启用不能登录
→ 启用
→ 手机号+后6位
→ 强制改密
→ 保密确认
→ 首页
```

第三设备、退出全部、重置密码均测。

### Demand

```text
镇区正式录入
→ 管理员审核
→ 发布
→ 团员认领
→ 进展
→ 提交办结
→ 管理员核实
→ 已办结
→ 成效
```

至少1条完整端到端。

### Visit Lead

```text
行程
→ 结果
→ 走访
→ 多条线索
→ 镇区核验
→ 正式需求
```

### Reimbursement

差旅 + 活动各一条。

### Help

```text
创建
→ 转单位
→ 并发接手
→ 处理
→ 办结
→ 重新打开
```

## 6. 权限强制用例

### 全局

- 无登录 → 401；
- 无角色动作 → 403；
- 数据范围不符 → 403；
- 状态不允许 → 409/422；
- 敏感权限缺失 → 403。

### 管理员

- ADMIN不能看他人报销；
- ADMIN可给平台注册往届按人开启 `reimbursement.apply`，但开启后仍不能查看其报销内容；
- ADMIN不能授予 `reimbursement.manage`；
- ADMIN不能看他人AI正文；
- ADMIN不能看完整审计；
- ADMIN不能备份恢复；
- ADMIN不能需求负责人转交。

### 超级管理员

- 可负责人转交；
- 仍不能看他人AI私人对话正文。

### 镇区

- A镇不能修改B区域业务；
- 可以接续处理A镇组织草稿。

### 部门

- 可看负责区域；
- 不直接改镇区需求。

### 部长

- `MINISTER` 与 `GROUP_LEADER` 的全团概览、全团共享行程、月度台账和久未更新提醒能力均有效；
- `MINISTER` 不自动获得 `ADMIN`、`SUPER_ADMIN` 或敏感权限；
- `MINISTER` 不自动看到他人报销、办事求助或荷宝 AI 私人对话正文；
- `MINISTER` 不自动拥有需求负责人转交、需求审核、镇区需求修改或取消能力；
- 非 `MEMBER_CURRENT` 的部长不能仅凭部长身份认领或协同需求；
- `MINISTER + MEMBER_CURRENT` 可以通过多角色合并获得在任团员能力；
- 职位名称为“部长”但未显式授权 `MINISTER` 时，不获得团队协调能力；
- `MINISTER` 撤销或到期后，相关权限立即失效；
- 页面标签、授权历史和审计分别保留“部长／`MINISTER`”，不得写成团长。

## 7. 并发强制用例

用真正并发请求。

### 需求

两团员同一毫秒认领：

> 1成功，1冲突。

### 求助

多人接手：

> 1个current owner。

### 人才

同Talent+Area发起两次：

> 仅1个IN_PROGRESS。

### 企业联系人

并发设主要联系人：

> 最终恰好1个active primary。

### 报销

申请人撤回与管理人员核对竞争：

> 只一个合法transition。

## 7.1 M1-006 Progress / Close / Responsibility lifecycle

验收计划必须覆盖：

- Progress 同 key 20 路并发仅一条事实，不同 key 可产生多条真实进展；
- 上海自然日第 30/31 天边界与零 Progress 的 OwnerHistory/TownshipHandler baseline；
- 10 路 stale reminder 只有一条 Reminder/Outbox/Message/OPEN Todo，七天内再次提醒受限；
- 只有 `UPLOADED + PASSED + objectKey` 的附件可正式关联，跨 Demand 伪造 link 拒绝；
- close RETURN、补充、resubmit 保留多轮 immutable CloseRequest/Review/附件历史；
- completion 写入 `completedAt` 与已验证的 `completionBatchId`；
- close submit 与 owner-exit request 竞争只有一个合法结果；
- SUPER preview/confirm、过期或上下文变化 token 拒绝、目标实时 current-member eligibility；
- 同批次 `TRANSFER`、跨批次 `CROSS_BATCH_TRANSFER` 与 OwnerHistory/current pointer 一致；
- cancel 结束 current relations/requests 且生命周期 Todo 全部 stale；
- Worker 重复投递和失败重试不重复 Message/Todo。

PR #22 当前自动化事实必须与“计划”分开表述。已有覆盖来自：

```text
tests/unit/demand-lifecycle.test.ts
tests/database/demand-lifecycle.test.ts
tests/e2e/demand-lifecycle.spec.ts
```

当前已实际覆盖上海自然日边界和 payload/capability；10 路 reminder exactly-once；20 路 Progress same-key replay；PASSED attachment、无权限下载和跨 Demand 关联拒绝；close return/resubmit/completion immutable history；close 与 owner-exit race；SUPER-only preview/confirm、execute replay 与 OwnerHistory 一致；ALUMNI_TOWNSHIP 无 fake owner；cancel cleanup；Worker 双次消费幂等；以及 Progress/Close、Owner Exit、SUPER Transfer、stale reminder 和 alumni township 的浏览器链路。

当前三个文件没有单独声明“过期 transfer token”和“跨批次 transfer”的自动化 case；在补齐专门测试前，文档不得把这两项表述为已有自动化证明。

## 8. 消息待办

验证：

- Event业务事务成功；
- Outbox存在；
- Worker生成Message/Todo；
- 同类Todo不重复；
- 状态变化关闭旧Todo；
- 团长与部长的团队协调提醒均按7天限频；
- 自动提醒不按天刷；
- 行程参与消息不生成Todo；
- 需确认公告消息+Todo；
- 报销无纸质材料催交Todo。

## 9. 文件

- 0字节；
- >50MB；
- 扩展名伪装；
- 错MIME；
- 扫描中；
- 扫描失败；
- 无权下载；
- 签名URL过期；
- 敏感下载日志；
- 分片中断恢复。

## 10. AI / OCR

按照 AI_OCR_SPEC 固定脱敏评测集。

硬门槛：

> 权限越权 0 容忍。

必须测试：

- 无依据拒答；
- 推荐证据；
- 在任候选完整资格、0/2 当前批次 fail-safe、20 人池与 3 人上限；
- 非法 AI 候选 ID / evidence / 重复 / 百分比的一次修复与规则降级；
- 新 Run 原子切换、失败保留旧 current、并发 Run 和幂等 Job；
- 推荐本人 / 负责镇区 / 管理员 / 无关人员可见性；
- CURRENT decline 后重跑排除，且其他在任人员仍可 claim；
- 0 人或 30 天往届门槛、两类往届响应、激活事务与 claim 竞态；
- Provider 自由文本手机号、身份证和 email 脱敏，且正式 evidence snapshot 不被改写；
- 负责镇区完整可见、历史代录与 handler 均要求有效 `TOWNSHIP_STAFF` 角色及属地关系；
- CURRENT 推荐 Message 且 Todo=0；ALUMNI_PLATFORM Message + 响应 Todo；历史往届无站内通知；响应完成、重跑 stale 与 Worker 重试 exactly-once；
- 政策依据页；
- 人才不抽结构化电话；
- 打车票不自动差旅交通；
- 餐饮票不自动差旅；
- OCR/AI失败手工继续；
- VectorDB挂掉结构搜索正常。

## 11. Map

- GeoJSON加载；
- 边界版本切换；
- 切换不改企业responsible_area；
- 无坐标企业仍列表；
- 地图服务失败列表正常；
- 团员地图不请求GPS；
- 地图导航失败可复制地址。

## 12. 报销专项

### 差旅

必须断言独立四类：

```text
交通费
交通补助
伙食补助
住宿费
```

- 出租车不进交通费；
- 网约车不进交通费；
- 餐饮不进差旅；
- 补助不要求票据；
- 补助不由OCR生成；
- 系统不猜补助天数。

### 活动

- 同单多种费用；
- `OTHER`必须费用名称；
- OCR类别可人工改。

### 状态

- 已提交财务不显示“已付款”。

## 13. 统计

固定月末测试时钟。

验证：

- 本月新增按 first_published_at；
- 本月办结按管理员通过时间；
- 5个需求存量主状态互斥；
- stale 是IN_PROGRESS子集；
- current batch member按Person去重；
- 来离宝人数按Person去重；
- 成效只统计APPROVED；
- 无排名。

## 14. Migration

至少：

- 20–30样本；
- 1次全量演练；
- 幂等重跑；
- 重复手机号异常；
- 企业信用代码匹配；
- 附件SHA校验；
- V1需求状态映射；
- V1报销映射；
- 旧来离宝不算当前；
- 对账报告。

## 15. Backup Restore

上线前必须做完整恢复演练。

验证：

```text
进入维护模式
DB恢复
COS关联恢复
附件随机抽查
业务数量对账
登录
关键闭环
解除维护
```

目标：

```text
RPO ≤24h
RTO ≤8h
```

上线后至少季度演练。

## 16. 浏览器 / 设备

Mobile：

- 微信内置浏览器 iOS；
- 微信内置浏览器 Android；
- iOS Safari；
- Android Chrome/系统主流浏览器。

PC：

- Edge；
- Chrome。

无需第一阶段重点支持过旧IE。

## 17. 网络

测试：

- 弱网；
- 请求超时；
- 上传中断；
- 提交重复点击；
- 页面刷新；
- 手机切后台恢复。

长表单不丢草稿。

## 18. 性能

上线前使用接近真实数据量。

初期目标：

- 普通结构化API P95 < 800ms；
- 关键同步写 P95 < 1.5s；
- 列表分页；
- AI/OCR异步不拖慢同步业务；
- 大导出不超时。

若真实数据量较小，也要测试10倍预计数据作为余量。

## 19. UAT 角色

正式UAT必须至少：

```text
1 超级管理员
1 普通管理员
1 报销管理人员
1 当前团长
1 部长
2 个不同镇区代表
1 个部门代表
3–5 名普通团员
```

必要时其中部分人员可多角色，但关键权限冲突场景必须保留独立测试账号。

## 20. UAT 放行

必须：

- 所有P0/P1流程通过；
- 无权限越权；
- 无数据丢失；
- 无阻断级附件异常；
- 迁移核心数据对平；
- 备份恢复演练完成；
- TEST与PROD配置清单完成。

## 21. 缺陷等级

```text
P0 数据泄露/错权限/数据损坏/系统不可用
P1 核心闭环阻断/状态错误/并发重复
P2 重要功能错误有绕行方案
P3 UI/文案/低频问题
```

正式上线：

> P0=0，P1=0。

## 22. M3-005 专项测试

- Unit：aliases/ambiguous/required、mapping/fingerprint 版本、formula guard、三个 Matcher、ARCHIVED/DISABLED/MERGED 治理阻断、Candidate Summary 脱敏、phone/creditCode normalizer、输出公式转义与 scope resolver。
- Real MySQL：空库与重复 migrate deploy、双 Confirm、mapping/旧 preview 竞争、信用代码/有账号与无账号手机号 race、ARCHIVED 人员与 DISABLED 企业不变、晚行失败全回滚、快照和幂等。
- Critical E2E：管理员企业/团员导入与重复上传、可辨识候选摘要、首层确认不写库/取消不写库/Modal 二次确认后才 Apply；镇区/部门企业导出限域；成员导出拒绝；管理员人才导出。

## 23. M3-006 automated coverage

- Unit/sample: strict manifest/source contract, deterministic fingerprint, traversal guard, shared Person/Enterprise/Talent/Policy matchers, fixed Demand/reimbursement mapping, no historical account/high-privilege invention, presence/trip historical semantics, reconciliation formula, missing/hash-mismatch attachments, full-snapshot gate.
- Real MySQL: provider-driven dry-run with zero business/Map writes; Actual Apply creates real Person/Organization/Enterprise/Demand/Reimbursement and supported targets; Map IDs reference real rows; same-snapshot rerun preserves counts/IDs; changed DemandProgress is rejected through the real pipeline; copied Attachment/object/Link/hash/size reruns without duplication; historical Outbox delta is zero; legacy reimbursement remains private/read-only; historical COMPLETED Demand has no fake close rows. CI also applies all expand-only migrations twice through the existing database gate.
- The sanitized fixture contains 26 business records plus three attachment rows and intentionally ends `REVIEW_REQUIRED`; it is not a false all-success sample.
- Full rehearsal is not automated or claimed until a controlled real V1 full snapshot/schema is supplied.

**TEST_PLAN.md v1.1 END**
