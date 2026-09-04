# 智链宝 V2.0 — ARCHITECTURE.md

> 2026-09-04 基础设施覆盖规则：开发、测试、云 Provider、成本和部署职责以 `LOCAL_FIRST_ZERO_EXTRA_COST.md` 为准。本文中 TDSQL-C、COS、SSM、外部 AI/OCR、付费地图 SDK、GitHub CI 和独立付费运行服务的旧方案均不再作为当前实现要求。

> 版本：TECH v1.0  
> 状态：开发基线  
> 上游：PRD v1.2、PERMISSIONS v1.0、STATE_MACHINES v1.0、DATA_MODEL v1.1  
> 目标：以最低运维复杂度支撑第一阶段完整版，同时保证后续可持续迭代。

## 1. 架构结论

V2 采用：

```text
一个私有 GitHub 仓库
+ 一个 Next.js 主应用
+ 模块化单体
+ Mobile H5 / PC Admin 两套独立 UI
+ 同一套业务 Service / Permission Service
+ TDSQL-C MySQL
+ Prisma ORM / Prisma Migrate
+ 腾讯云 COS 私有对象存储
+ MySQL 持久化 Job Queue + Worker
+ AI Service / OCR Service / Search Service 适配层
+ 腾讯位置服务 + 自有版本化 GeoJSON
```

第一阶段明确**不采用微服务**，也**不为了“高级”提前引入 Redis、Kafka、RabbitMQ、Elasticsearch**。

## 2. 为什么采用模块化单体

智链宝业务复杂，但当前团队和运维规模不需要微服务。

模块化单体同时保证：

- Codex 一次能看到完整业务上下文；
- 手机、PC、API 共享规则，不复制业务逻辑；
- 一个仓库、一个主 Docker，部署简单；
- 各业务模块仍有明确边界；
- 后续真正有压力时，可单独拆 Worker / AI 等模块。

禁止“页面直接 Prisma”。

标准调用链：

```text
Page / UI
  ↓
Route Handler / Server-side Query
  ↓
Auth
  ↓
Permission Service
  ↓
Domain Service
  ↓
Repository
  ↓
Prisma
  ↓
MySQL
```

## 3. 前端组织

一个 Next.js 项目，但 UI 严格分区：

```text
src/app/
  (mobile)/
  admin/
  public/
  api/
```

组件：

```text
src/components/
  mobile/
  admin/
  shared/
```

原则：

- Mobile 与 Admin 不共用布局；
- 不做“一张响应式页面同时当手机和后台”；
- `shared` 只放真正可共用的状态标签、头像、文件预览、业务编号等；
- 底层 Domain Service 共享。

## 4. 后端模块边界

```text
src/modules/
  identity/
  organization/
  permissions/
  member/
  enterprise/
  demand/
  talent/
  policy/
  presence/
  trip/
  reimbursement/
  help/
  announcement/
  notification/
  attachment/
  ai/
  map/
  reporting/
  import-export/
  migration/
  audit/
  system/
  jobs/
```

每个模块内部建议：

```text
domain/
service/
repository/
schemas/
events/
tests/
```

禁止模块间直接跨表写数据库。

跨模块写操作通过 Service 调用或 Business Event 协作。

## 5. 数据库

### 5.1 数据库

继续使用腾讯云 TDSQL-C MySQL。

开发、测试、生产完全分库：

```text
LOCAL
TEST
PROD
```

V1 正式数据库在 V2 开发期间禁止作为开发库。

### 5.2 ORM

使用 Prisma ORM。

正式环境：

```bash
prisma migrate deploy
```

禁止：

```bash
prisma db push
```

直接作用生产库。

应用启动时禁止 `CREATE TABLE IF NOT EXISTS` 自动升级数据库。

### 5.3 Migration 原则

数据库变更：

```text
设计
→ Migration
→ 本地测试
→ CI
→ TEST
→ 验收
→ 发布前快照
→ PROD migrate deploy
```

破坏性改动使用：

```text
Expand → Migrate Data → Contract
```

避免一个版本直接删除旧字段造成无法回滚代码。

## 6. 主键、时间、金额

- 内部主键：UUID；
- 业务编号：独立 human-readable 编号；
- 时间业务解释：Asia/Shanghai；
- 数据库存储须保持统一约定；
- 金额：Decimal；
- 禁止 Float 保存金额；
- 不用手机号、姓名、单位名称作为业务外键。

## 7. 登录与 Session

自建手机号密码认证。

密码：

```text
Argon2id
```

Session：

```text
DB-backed Session
+ HttpOnly Cookie
+ Secure
+ SameSite=Lax
```

默认登录保持 30 天。

同账号最多 2 台有效设备。

第 3 台登录：

> 失效最早有效 Session。

账号 / 权限变化通过 `permission_version` 使权限立即重新计算。

不使用“长期纯 JWT + 无法主动撤销”的方案。

## 8. 权限

统一 Permission Service。

顺序：

```text
账号状态
→ 角色动作权限
→ 数据范围
→ 业务状态
→ 敏感权限
```

任何关键 API 必须服务端鉴权。

禁止：

```text
ADMIN = 万能 true
```

报销、审计、备份等专属权限单独控制。

## 9. 输入校验与接口契约

统一使用 Zod 或等价 TypeScript Schema 库。

每个写接口：

1. 解析 body；
2. Schema 校验；
3. Auth；
4. Permission；
5. Domain transition；
6. Transaction；
7. Outbox；
8. Audit；
9. 返回标准响应。

禁止将 `req.body` 直接传给 Prisma。

## 10. 事务与并发

以下必须使用数据库事务与约束：

- 需求认领；
- 办事求助认领；
- 同镇同人才发起对接；
- 主要企业联系人切换；
- 报销撤回 / 核对竞争；
- 批量导入；
- 高风险负责人转交。

对需要抢占的任务可在基础设施层使用 MySQL 行锁 / `FOR UPDATE` 等机制。

Prisma 无法表达的少量数据库能力允许封装 `$queryRaw`，但仅限 Repository / infrastructure 层并必须有测试。

## 11. Business Event 与 Transactional Outbox

业务写操作在同一事务中写：

```text
业务数据
+ State History
+ Audit（按需要）
+ OutboxEvent
```

事务提交后 Worker 消费 Outbox。

用途：

- 消息；
- 待办；
- AI推荐；
- Vector 索引；
- 导出；
- 异步提醒。

避免：

> 业务成功了，但消息因为网络失败永久没发。

## 12. Worker

第一阶段使用：

```text
MySQL Job Queue
+ 独立 Worker 进程
```

不引入 Redis。

任务需支持：

```text
WAITING
RUNNING
SUCCEEDED
FAILED
CANCELED
```

必须有：

- idempotency_key；
- retry_count；
- max_retries；
- scheduled_at；
- locked_at；
- locked_by；
- last_error。

任务领取须防止多个 Worker 重复执行。

适合异步的任务：

- AI；
- OCR；
- 语义索引；
- 文件扫描；
- 缩略图；
- Excel/PDF 导入导出；
- 月度归档；
- 临时文件清理；
- 提醒扫描；
- 迁移。

## 13. 文件与 COS

所有二进制文件进入腾讯云 COS 私有桶。

MySQL 只存元数据。

上传：

```text
客户端请求上传许可
→ 服务端鉴权
→ 返回短期上传凭证/签名
→ 客户端直传 COS
→ 服务端确认登记
→ 安全处理
```

下载：

```text
用户请求
→ 父业务权限校验
→ 生成短时签名 URL
```

不得返回长期公开 URL。

单文件上限 50MB。

支持分片 / 断点续传。

正式文件：

- SHA-256；
- MIME / magic bytes 校验；
- 恶意文件扫描；
- 敏感访问日志。

普通照片可生成缩略图和压缩版本；政策原件、票据原件等保留原文件。

## 14. 文件恶意扫描

第一阶段采用 `FileScanAdapter`。

优先实现：

```text
Worker 内 ClamAV / 等价受控扫描服务
```

同时：

- 明确白名单文件类型；
- 可执行文件直接拒绝；
- 扫描中不可对普通用户下载；
- 异常文件隔离。

若部署资源不适合内置扫描，替换 Adapter，不修改业务模块。

## 15. AI / OCR / Search

业务模块禁止直接调用具体模型。

统一：

```text
AIService
OCRService
SearchService
```

AI 能力名：

```text
CHAT
DEMAND_MATCH
DEMAND_CLASSIFY
POLICY_EXTRACT
POLICY_INTERPRET
TALENT_EXTRACT
SIMILAR_DEMAND
SIMILAR_TRIP
ENTERPRISE_TAG_SUGGEST
```

供应商通过 Adapter。

第一阶段可通过腾讯 AI 网关复用腾讯模型能力，但业务代码不写死模型名。

正式业务事实以 MySQL 为唯一真源。

VectorDB 只做语义索引。

## 16. 报销 OCR

票据识别使用专业票据 OCR / 解析。

OCR 负责：

- 票据类别；
- 日期；
- 金额；
- 销售方；
- 发票号码等事实字段。

规则引擎负责：

- 是否允许；
- 差旅 / 活动归类；
- 补助；
- 重复判断；
- 状态。

交通补助和伙食补助不得由 OCR 自动生成。

## 17. 地图

底图：

```text
腾讯位置服务 JavaScript API GL
```

地址解析通过后端 `MapService` 调用。

业务边界：

```text
AdministrativeArea
+ 版本化 GeoJSON
+ COS
```

企业正式归属：

```text
responsible_area_id
```

坐标：

```text
latitude / longitude
```

二者独立。

地图坐标不得自动覆盖正式区域归属。

团员地图展示派出单位地域，不读取实时定位。

## 18. 缓存

第一阶段不部署 Redis。

优先靠：

- 正确索引；
- 分页；
- 批量查询；
- 避免 N+1；
- 异步任务；
- 缩略图；
- 结构化聚合；
- Vector 索引。

禁止缓存敏感权限结果而无法及时失效。

低风险基础字典可以短时缓存并支持主动失效。

## 19. 日志

使用结构化 JSON 日志，建议 Pino 或等价库。

关键字段：

```text
timestamp
level
request_id
user_id
module
route
duration_ms
result
error_code
```

禁止日志：

- 密码；
- Session token；
- AI私人对话正文；
- 完整票据正文；
- Secret；
- 完整个人隐私数据。

## 20. 审计

AuditLog 与应用日志分离。

AuditLog：

- 追加；
- 不允许业务删除；
- 记录 before / after；
- 原因；
- actor；
- request_id；
- IP / device。

完整审计仅超级管理员可见。

## 21. 监控

至少监控：

- HTTP 5xx；
- P95/P99响应；
- DB连接；
- Worker积压；
- Job失败率；
- Outbox积压；
- AI/OCR成功率；
- COS失败；
- 导入失败；
- 备份结果；
- 系统健康。

提供：

```text
/health
/ready
```

## 22. 性能基线

初期工程目标：

- 普通结构化列表首屏接口 P95 < 800ms（TEST正常网络与正常负载下）；
- 关键写操作服务端响应 P95 < 1.5s（不包含 AI/OCR/大文件异步任务）；
- 大导出、AI、OCR 不阻塞同步请求；
- 列表默认服务端分页；
- 禁止页面下载全量数据再筛选。

具体容量在上线前按真实数据量压测后固化。

## 23. 备份与恢复

数据库：

- 每晚增量，30天；
- 每周全量，12周；
- 发布 / 迁移 / 批量导入 / 批次切换前额外快照；
- 关键快照默认180天。

COS：

- 版本保护 / 等效防误删；
- 版本窗口覆盖数据库备份窗口。

目标：

```text
RPO ≤ 24h
RTO ≤ 8h
```

恢复：

```text
维护模式
→ 禁止写入
→ DB恢复
→ COS版本/文件关系恢复
→ 一致性校验
→ 业务抽查
→ 解除维护
```

代码回滚与数据恢复严格分开。

## 24. 测试

```text
Vitest
+ Integration Tests
+ Playwright
```

CI 至少执行：

```text
lint
typecheck
unit
integration
build
critical-e2e
```

权限、状态机、并发必须重点覆盖。

## 25. 部署环境

```text
LOCAL
TEST
PROD
```

各环境：

- 数据库隔离；
- COS隔离；
- Secret隔离；
- AI配置隔离；
- URL隔离。

V1 在 V2开发期保持运行，不触碰其正式库。

## 26. 发布链路

```text
feature branch
→ Codex开发
→ CI
→ Pull Request
→ merge main
→ WorkBuddy部署 TEST
→ UAT
→ tag v2.x.x
→ 发布前快照
→ migrate deploy
→ WorkBuddy部署 PROD
→ health check
→ smoke test
```

GitHub 是唯一代码真源。

不得把服务器上临时改过的代码当“最新版”。

## 27. 包管理和工程约定

为降低运维复杂度：

> 第一阶段统一使用 `npm` + `package-lock.json`。

正式构建使用：

```bash
npm ci
npm run build
```

不要开发人员各自混用 npm / pnpm / yarn。

## 28. 推荐基础库

可在 Codex 开工时确认兼容版本后固定：

- Prisma；
- Zod；
- Argon2；
- Pino；
- date-fns / date-fns-tz；
- Vitest；
- Playwright；
- 官方腾讯云 COS SDK；
- 官方 / 稳定腾讯位置服务接入。

原则：

> 不为一个简单需求安装大而无人维护的第三方库。

## 29. Secret 管理

`.env` 不入 Git。

仓库只保留：

```text
.env.example
```

Secret 通过 TEST / PROD 环境变量或腾讯云安全配置注入。

至少包括：

- DATABASE_URL；
- SESSION_SECRET；
- COS凭证；
- AI网关凭证；
- OCR凭证；
- 地图服务凭证。

## 30. 架构红线

1. 禁止微服务提前拆分；
2. 禁止业务页面直接 Prisma；
3. 禁止应用启动自动建表；
4. 禁止生产 db push；
5. 禁止纯前端权限；
6. 禁止 ADMIN 万能权限；
7. 禁止长期公开附件 URL；
8. 禁止模型直接连接数据库；
9. 禁止 AI/OCR 成为核心流程必需条件；
10. 禁止 VectorDB 成为正式业务真源；
11. 禁止 Redis / MQ 在无真实瓶颈时提前引入；
12. 禁止代码回滚触发数据库恢复；
13. 禁止生产 Secret 进入 Git；
14. 禁止跨模块直接修改对方数据库表；
15. 禁止用坐标推断并覆盖企业正式所属区域。

**ARCHITECTURE.md TECH v1.0 END**
# M3-008 release-gate architecture

Release evidence is layered rather than collapsed into one health flag: code/static checks, CI service proof, production configuration, real cloud operations, source-data rehearsal, UAT and cutover each retain their own status. The readiness aggregator is read-only and cannot deploy, change repository policy, create backups or execute restores.

Security, performance and browser automation run as independent required jobs. MySQL-backed correctness/performance jobs use real 8.4 service instances; scanner integration uses a real ClamAV daemon. The official CynosDB backup adapter reconciles a deterministic backup name before creating, fails on ambiguous matches, and leaves retention unknown when the provider does not return evidence. Restore is deliberately separated into a TEST-only new-cluster drill with manual validation and cleanup.

Phase 1 adds no Redis and no long-lived permission cache. Home correctness uses bounded aggregate queries without a 50-row prefilter that could hide urgent older Todos. AI Chat calls authorized domain services rather than accessing the database as a privilege bypass.
