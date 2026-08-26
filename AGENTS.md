# AGENTS.md — 智链宝 V2.0 Codex 总规则

你正在开发“智链宝 V2.0”。

在任何编码前，必须按顺序阅读：

```text
docs/PRD-v1.2.md
docs/ARCHITECTURE.md
docs/PERMISSIONS.md
docs/STATE_MACHINES.md
docs/DATA_MODEL.md
docs/DATA_DICTIONARY.md
docs/FORM_SPEC.md
docs/FIELD_PERMISSIONS.md
docs/DATABASE_CONSTRAINTS.md
docs/API_SPEC.md
docs/MESSAGE_TODO_MATRIX.md
docs/UI_SPEC.md
docs/AI_OCR_SPEC.md
docs/MAP_SPEC.md
docs/REIMBURSEMENT_RULES.md
docs/SECURITY_SPEC.md
docs/TEST_PLAN.md
docs/OPERATIONS.md
docs/MIGRATION_PLAN.md
docs/IMPLEMENTATION_PLAN.md
```

如果代码与文档冲突：

> 不要擅自“优化产品规则”，停止并指出冲突。

## 1. 项目原则

- 一个私有GitHub仓库；
- Next.js + React + TypeScript；
- 模块化单体；
- Mobile与Admin两套UI；
- MySQL + Prisma；
- Prisma Migrate；
- COS私有文件；
- DB Session；
- Permission Service；
- MySQL Job Queue + Worker；
- 第一阶段不微服务；
- 第一阶段不Redis。

## 2. 永久红线

你不得：

1. 修改PRD来迁就实现；
2. 在生产使用 `prisma db push`；
3. 应用启动自动建表；
4. 绕过Permission Service；
5. 只靠前端隐藏按钮做权限；
6. 把ADMIN写成万能权限；
7. 让管理员查看他人私人AI正文；
8. 让普通管理员看他人报销；
9. 让普通管理员转交需求负责人；
10. 直接修改正式业务status字段；
11. 直接修改正式owner字段；
12. 把往届协助写成正式主责；
13. 新增“需求暂停”状态；
14. 物理删除正式业务历史；
15. 覆盖需求原始来源；
16. 覆盖人才原推荐人；
17. 给人才增加结构化本人电话/邮箱；
18. 新政策撤回后自动恢复旧政策；
19. 把“已提交财务”写成“已付款”；
20. 把出租车/网约车自动归差旅交通费；
21. 用餐饮发票生成差旅伙食补助；
22. 用OCR生成交通/伙食补助；
23. 自行猜补助天数公式；
24. 让AI发布/审核/办结/转负责人；
25. 给AI数据库凭证；
26. 把VectorDB当正式业务数据源；
27. 公开COS永久链接；
28. Secret进入Git；
29. 生产日志记录密码/Token/AI私人正文；
30. TEST连接PROD数据库；
31. 因代码bug恢复正式数据库；
32. 使用坐标自动改企业正式区域；
33. 把Organization和AdministrativeArea混表；
34. 删除失败测试来让CI通过。

## 3. Git工作方式

每个任务：

```text
创建 feature/fix branch
→ 只做本任务
→ 测试
→ PR
→ Review
→ Merge main
```

禁止直接在 main 开发大功能。

Commit应描述业务：

```text
feat(demand): add atomic claim flow
fix(auth): revoke sessions after phone change
```

## 4. 开发前检查

每个任务先回答：

```text
涉及哪个Domain?
需要什么Permission?
涉及哪个State transition?
需要消息/待办吗?
需要Audit吗?
需要Outbox吗?
是否涉及附件?
是否涉及敏感数据?
是否需要Migration?
需要哪些测试?
```

## 5. 模块边界

Page不得直接Prisma。

标准：

```text
Route
→ Auth
→ Permission
→ Service
→ Repository
→ Prisma
```

跨Domain写操作不得直接import对方Prisma repository偷偷改表。

## 6. Prisma

Schema变更：

```text
修改schema
→ migration
→ migration review
→ tests
```

不要手工改已发布Migration。

生产用：

```text
prisma migrate deploy
```

## 7. API

写操作使用命令式动作。

错误：

```text
PATCH demand {status}
```

正确：

```text
POST demand/:id/claim
POST demand/:id/submit-close
```

所有输入Zod校验。

## 8. Transaction

业务状态 + 关系 + StateHistory + Outbox 必须同事务。

并发场景必须写集成测试。

## 9. Idempotency

提交、认领、行程结果、导入等支持幂等。

不要用“按钮disabled”替代服务端幂等。

## 10. 前端

Mobile底部永远：

```text
首页 / 需求 / 资源 / 我的
```

不加第五栏，不加全局悬浮+。

iOS式轻量视觉。

一个页面一个主操作。

## 11. UI状态

每个重要页实现：

```text
loading
empty
error
forbidden
not-found
merged/canceled if applicable
```

禁止白屏。

## 12. 文件

任何下载：

```text
Permission
→ Attachment parent authorization
→ short signed URL
```

敏感文件记AccessLog。

## 13. AI

所有模型调用经 AIService。

所有票据经 OCRService。

AI输出：

> 建议，不是正式事实。

正式写入必须通过人工确认/业务Service。

## 14. Time

所有自然日/月按：

```text
Asia/Shanghai
```

不要依赖服务器本地时区猜测。

## 15. Money

只用 Decimal。

禁止 JS 浮点直接作为财务最终金额。

服务端重新合计。

## 16. Logging

每个请求有 request_id。

错误日志：

> 可排查但脱敏。

不打印完整 request body，尤其报销/AI/求助。

## 17. 测试要求

任何新状态动作：

> 至少单元 + 集成。

任何权限改动：

> 必须负向测试。

任何并发动作：

> 必须并发集成测试。

关键流程：

> Playwright。

## 18. 修改文档

如果实现发现规格有无法实现/自相矛盾：

1. 不擅自改规则；
2. 写出具体冲突；
3. 提交规格变更建议；
4. 等产品规格形成新版本；
5. 再编码。

## 19. Definition of Done

任务完成必须同时：

```text
代码完成
类型检查通过
Lint通过
测试通过
Build通过
权限检查完成
状态机一致
Audit/Outbox按需完成
无Secret
文档需要时更新
```

“页面看起来能用”不算Done。

**AGENTS.md END**

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
