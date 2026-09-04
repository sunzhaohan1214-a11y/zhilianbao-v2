# 智链宝 V2.0 — OPERATIONS.md

> 2026-09-04 覆盖规则：以 `LOCAL_FIRST_ZERO_EXTRA_COST.md` 为当前运维基线。GitHub 云端 CI、CynosDB/SSM/COS 专用接入、外部付费 AI/OCR 和 WorkBuddy 构建职责已取消；本文后续相关段落仅保留为历史设计背景。

> 版本：v1.2
> 状态：第一阶段代码已合入，TEST/UAT 与真实运维证据待执行
> 继承 V1 已验证 CloudBase / Docker / VPC 经验，但 V2 环境必须独立。

## 当前运维事实（2026-09-02）

- `main@b97588e721d954ae7590ffd6f70dab5dc99e4480` 已受保护，required checks 为 `quality`、`database`、`critical-e2e`、`docker-build`、`security`、`performance`、`browser-compat`；该提交的 CI #482 全部通过。
- M0–M3 代码和运维编排已经合入，但本事实同步不声称已部署真实 V2 TEST/PROD，也不声称真实 CynosDB、COS、ClamAV、Maintenance Provider 或 AI provider 已完成环境验收。
- 仓库当前为 public，且不得包含 Secret、真实业务数据、V1 原始资料包或运行证据。生产上线前须再次确认是否维持公开。
- PR #42 的参考资料包输出仍为 `SAMPLE`，不能进入正式 FULL/cutover 口径。
- 当前运维顺序是 TEST 配置与部署、smoke、具名 UAT、专用迁移库 FULL 演练、真实备份/恢复演练、PROD preflight；完成前 `RELEASE_READY=NO`。

## 1. 环境隔离

至少：

```text
V1 PROD       原系统，开发期继续运行
V2 TEST       V2验收
V2 PROD       V2正式
```

V2 TEST / PROD：

- 独立数据库；
- 独立COS前缀或桶；
- 独立Secret；
- 独立AI配置；
- 独立CloudBase service。

禁止 V2 TEST 连 V1 PROD DB。

## 2. Docker

继续使用 Next.js：

```text
output: "standalone"
```

Docker：

```text
deps
→ builder
→ runner
```

最终：

```text
node worker-dist/runtime-entrypoint.js
0.0.0.0:3000
```

统一入口先使用实例角色读取 SSM 运行凭据，再按 `ZLB_PROCESS=web|worker|attachment-scan`
启动 `server.js`、常驻 Worker 或单次附件扫描入口。Web 继续由 Next.js 监听端口；Worker
由入口提供 `/health` 与 `/ready`；附件扫描入口提供探针与 `POST /run`，并拒绝并发运行。

Node版本在 Dockerfile 显式固定兼容LTS，不依赖WorkBuddy宿主机。

## 3. WorkBuddy 已知环境坑

V1已经验证：

### NODE_OPTIONS safe-delete

WorkBuddy 可能注入 safe-delete hook。

若出现依赖安装/构建清理失败：

```bash
NODE_OPTIONS="" npm ci
NODE_OPTIONS="" npm run build
```

### 大批量 rm

不要在 WorkBuddy 环境依赖：

```bash
rm -rf node_modules .next
```

被安全钩子阻止时：

> 使用 `mv` 移出工作目录。

### VPC

CloudBase部署必须确保服务处于正确VPC/子网，否则数据库内网连接失败。

V1曾出现部署后VPC配置丢失问题。

V2发布脚本必须把 VPC 检查作为发布步骤，而不是“部署完再猜”。

## 4. 数据库

数据库只开放内网连接。

不要为了排障把 MySQL 暴露公网。

应用使用最小权限账号。

建议：

```text
runtime app user
migration user
```

可以是两套权限：

- runtime：正常DML，不拥有高危DDL；
- migration：仅发布时使用。

若早期运维复杂度不允许拆账号，也至少保证凭证只在Secret中并严格发布控制。

## 5. Secret

生产环境变量由CloudBase/安全配置管理。

CloudBase 运行时只以普通环境变量提供非敏感定位信息：

```text
ZLB_RUNTIME_SECRET_NAME
ZLB_RUNTIME_SECRET_REGION
ZLB_RUNTIME_SECRET_VERSION
ZLB_PROCESS
```

入口使用实例角色读取显式固定的 SSM 版本（例如 TEST 的 `v2`），且只接受以下完整 JSON 白名单；缺项、空值、未知键
或读取失败都必须在启动阶段 fail closed：

```text
DATABASE_URL
AUTH_RATE_LIMIT_SECRET
COS_SECRET_ID
COS_SECRET_KEY
```

不得把上述四项回填为 CloudBase 明文环境变量。实例角色只授予指定凭据的
`ssm:GetSecretValue`，不得使用账户级通配资源。

CloudBase 部署使用仓库内的 `Dockerfile.cloudbase`。它只在
`ZLB_PROCESS=attachment-scan` 时启动绑定 `127.0.0.1:3310` 的 ClamAV，并要求显式配置
`FILE_SCAN_PROVIDER=clamav`、`CLAMAV_HOST=127.0.0.1`、`CLAMAV_PORT=3310`；病毒库在镜像构建阶段由
`freshclam` 下载并校验，运行时不依赖临时下载。Web 和 Worker 不启动 ClamAV。

仓库：

```text
.env.example
```

不含真实值。

禁止：

- `.env` commit；
- 聊天复制生产密码进代码；
- 日志打印DATABASE_URL；
- 构建产物暴露Secret。

## 6. 部署角色

推荐责任：

```text
ChatGPT / 产品技术规格  → 定义
Codex                   → 修改代码/测试
GitHub                  → 唯一代码真源
WorkBuddy               → TEST/PROD部署执行
```

WorkBuddy不得绕过GitHub永久修改线上源码。

## 7. Branch / Release

GitHub 是唯一代码真源。仓库当前为 public，`main` 受保护且所有改动继续通过 PR；公开可见性不降低 Secret、业务数据和迁移资料的隔离要求。

```text
feature/*
fix/*
main
```

发布 Tag：

```text
v2.0.0
v2.0.1
v2.1.0
```

PRD/UI/TECH文档版本独立，不和应用版本混用。

## 8. TEST部署

```text
merge main
→ CI通过
→ WorkBuddy构建
→ TEST migrate deploy
→ TEST deploy
→ /health
→ /ready
→ smoke
→ UAT
```

TEST可使用脱敏/专用测试数据。

## 9. PROD部署

前置：

- UAT通过；
- P0/P1=0；
- Migration已在TEST执行；
- 发布变更清单；
- 回滚版本明确；
- DB/COS快照完成。

流程：

```text
维护公告（需要时）
→ PROD快照
→ migrate deploy
→ deploy Docker
→ /health
→ /ready
→ 登录smoke
→ 核心查询
→ 关键业务只读抽查
→ 放行
```

## 10. Migration失败

数据库Migration失败：

> 停止部署。

不要继续带错误结构启动新代码。

先：

- 查 Migration；
- 查DB状态；
- 决定修复 Migration / 回退代码。

不使用 `db push` 救火。

## 11. Code rollback

应用新版本异常：

```text
选择上一个已验证 Git Tag
→ 重新构建
→ 重新部署
```

前提是数据库变更遵守向后兼容。

**代码回滚不恢复数据库。**

## 12. Data restore

只有数据损坏 / 灾难才进入 Restore。

流程：

```text
SUPER_ADMIN二次确认
→ 维护模式
→ 禁止写
→ DB恢复
→ COS版本恢复/校验
→ 关系一致性检查
→ 业务抽查
→ 解除维护
```

## 13. 备份

数据库：

```text
每晚增量 30天
每周完整 12周
```

额外：

- 发布；
- 正式迁移；
- 批量导入；
- 批次切换；

前创建快照。

关键快照默认180天。

COS开启版本保护/等效机制。

## 14. 监控

告警至少：

```text
Service down
5xx rate
P95 latency
DB connection
DB saturation
Worker backlog
Outbox backlog
Job repeated failure
AI/OCR failure rate
COS error
Backup failure
Migration job failure
```

## 15. Health

`/health`

只表示进程活着。

`/ready`

验证：

- DB；
- 必要配置；
- 关键依赖初始化。

AI/OCR/Map属于可降级依赖：

> 失败可在 ready details 中标告警，但原则上不让核心Web被判死。

## 16. 日志留存

应用日志不等于审计。

日志需要：

- request_id；
- 时间；
- 模块；
- level；
- error_code。

禁止敏感正文。

## 17. Worker

建议 V2 第一阶段：

```text
Web Service
Worker Service
```

来自同一仓库/镜像，可用不同启动命令。

例如：

```bash
npm run start:web
npm run start:worker
```

Worker水平扩容时依赖 DB lock/idempotency 防重复。

## 18. Maintenance mode

系统参数：

```text
NORMAL
READ_ONLY_MAINTENANCE
FULL_MAINTENANCE
```

Restore时：

> FULL_MAINTENANCE。

重大迁移可：

> READ_ONLY_MAINTENANCE。

维护状态必须由服务端写接口统一拦截。

## 19. 季度运维

至少每季度：

- 备份恢复演练；
- 权限高风险授权复核；
- 未激活账号清单；
- 停用/离岗关系检查；
- AI供应商数据留存配置复核；
- COS异常/孤立文件检查；
- Worker失败任务复盘；
- Secret轮换评估。

## 20. 发布后观察

发布后重点：

```text
登录失败率
403异常增长
DB错误
Migration异常
5xx
Worker积压
消息待办异常
附件访问失败
```

## 21. V1经验继承但不照搬

保留：

- CloudBase；
- Docker；
- standalone；
- VPC内网；
- WorkBuddy部署经验。

明确废弃：

> 应用启动 `CREATE TABLE IF NOT EXISTS` 自动建表。

V2所有DB结构改动走 Migration。

## 22. 运维红线

1. 不开放DB公网；
2. 不在服务器直接手改正式代码；
3. 不将Secret写Git；
4. 不TEST连PROD；
5. 不生产db push；
6. 不构建失败继续发布；
7. 不Migration失败继续切流量；
8. 不代码bug就恢复数据库；
9. 不直接下载原始完整系统备份到业务电脑；
10. 不绕过维护模式执行恢复。

## 23. 附件服务

COS bucket 必须保持 private。应用只向浏览器签发限定单个 staging object、短期有效的 STS 上传凭证；`COS_SECRET_ID`、`COS_SECRET_KEY` 只存在于服务端 Secret 管理中。下载与预览使用短时 signed URL，禁止记录 URL 或凭证正文。

环境变量：

```text
ATTACHMENT_STORAGE_PROVIDER
COS_REGION
COS_BUCKET
COS_SECRET_ID
COS_SECRET_KEY
INVOICE_OCR_ENDPOINT
INVOICE_OCR_API_KEY
ATTACHMENT_SIGNED_URL_TTL_SECONDS
ATTACHMENT_UPLOAD_TTL_SECONDS
```

`ATTACHMENT_STORAGE_PROVIDER` has no default. Deployed TEST and PROD must set it to `cos`; missing COS bucket, region or credentials fails closed during attachment runtime construction. `memory` is restricted to explicit local/unit/integration/E2E use with `ENABLE_TEST_MEMORY_ATTACHMENT_STORAGE=true`, a local/test application identity, and a non-production Node runtime. `APP_ENV=test` alone never selects memory, and a production-built TEST deployment cannot enable it. The protected test upload routes also require this explicit memory configuration.

`INVOICE_OCR_ENDPOINT` 必须指向专业票据 OCR/电子票据解析服务，`INVOICE_OCR_API_KEY` 只通过服务端 Secret 注入。任一项未配置时，报销票据识别任务进入可解释的人工录入降级状态；不得改用通用大模型猜测金额、票号或费用分类。

V2 TEST 首次连接真实 COS 前必须检查：bucket 访问控制为 private；地域、bucket 名与 CORS 来源正确；服务账号仅有 staging 上传、服务端 HEAD/COPY/GET/DELETE 和签名所需的最小权限；浏览器分片上传及断点续传可用；staging 到 immutable final 的复制、源对象清理和短时访问 URL 均已验证。

扫描器未配置、超时或失败时必须 fail closed，`scanStatus` 不得自动变为 `PASSED`。M0-005 只创建 `ATTACHMENT_SCAN` JobTask 并提供单任务扫描与过期清理服务；通用 Worker loop、claim scheduler 与 cron 从 M0-006 开始。

## 24. M0 Worker / Outbox 运行

Web Service 与 Worker Service 使用同一镜像、不同启动命令：

```bash
npm run start:web
npm run start:worker
```

Worker 配置见 `.env.example`。必须保持 `WORKER_HEARTBEAT_SECONDS` 明显小于 `WORKER_JOB_LOCK_TIMEOUT_SECONDS`。滚动发布发送 `SIGTERM` 后，Worker 停止领取新任务并在 graceful timeout 内等待当前任务；超时退出的任务由 stale lease recovery 接管。

运维单轮检查使用：

```bash
WORKER_RUN_ONCE=true npm run start:worker
```

单轮模式执行 stale recovery、有限批次 Outbox consume 和当前可领取 Job 后退出。Outbox handler 只允许短事务内 DB side effect 或幂等转 Job，外部网络调用必须交给 Job handler。监控至少区分 WAITING backlog、stale RUNNING、FAILED Job、未发布 Outbox 和 `failed_at` 毒消息。

## M3-007 backup and restore operations

Expected policy remains nightly incremental/30 days, weekly full/12 weeks, critical pre-operation snapshots/180 days, RPO <=24h and RTO <=8h. The web process never runs `mysqldump` or exposes snapshot bytes. Without a real cloud `BackupProvider`, backup health is NOT_CONFIGURED/UNKNOWN and manual/pre-operation backup returns 503. Compliance is a five-part PASS/FAIL/UNKNOWN matrix; missing retention/policy evidence is UNKNOWN, never compliant. Provider catalog sync ingests metadata only.

Restore is same-environment, same-provider, exact-schema only. Preview captures runtime environment, app version, Provider readiness and schema `20260901140000_m3_system_admin`; confirmation rechecks each value and reruns Provider preview. Backup and restore starts use stable Provider idempotency keys so an unknown network result remains resumable rather than being declared failed.

Restore confirmation also requires a durable deployment/ingress `MaintenanceProvider`; a database boolean is not accepted as the write lock. After Provider success, automatic validation performs `SELECT 1`, checks the required Prisma migration is finished/not rolled back/without failure logs, enforces exactly one current ACTIVE batch and at least one NORMAL account, probes up to three formal PASSED attachment objects through the configured storage adapter, and proves Job/Outbox queries execute. Any required failure keeps the restore active and maintenance enabled. Manual completion is reentrant, requires successful validation and explicit inspection, releases only the matching maintenance operation, and invalidates all sessions. The official CynosDB adapter was added in M3-008. Real deployment identity/configuration, successful backup evidence and a controlled restore-to-new-TEST-cluster drill remain external and unverified until the corresponding immutable evidence is attached.

**OPERATIONS.md v1.2 END**
# M3-008 release operations addendum

The operational source of truth is `docs/RELEASE_READINESS.md`, with detailed checklists in `UAT_CHECKLIST.md`, `PROD_RELEASE_CHECKLIST.md`, `RESTORE_DRILL_RUNBOOK.md`, `MONITORING_RUNBOOK.md`, `GITHUB_RELEASE_GATES.md`, and `DB_PRIVILEGE_RUNBOOK.md`.

The official CynosDB adapter may create/list/reconcile snapshots. It does not expose credentials/private endpoints and does not enable web-triggered restore. Restore drills use `RollbackToNewCluster` only, require TEST identity, fixed confirmation, cost acknowledgment, target prefix and manual cleanup. In-place source restoration remains an approved production runbook action outside application code.

Production release requires `backupReady`, a successful backup no older than 24 hours, production scanner readiness, protected main, exact-head checks, UAT, V1 full rehearsal/reconciliation and restore evidence. Missing external evidence remains BLOCKED and must not be converted into a code pass.

For the current code baseline, PR #50 exact-head CI #481 and post-merge `main` CI #482 passed. Those runs prove the repository automation for `b97588e721d954ae7590ffd6f70dab5dc99e4480`; they do not substitute for TEST deployment, named UAT, real provider acceptance, FULL migration rehearsal or production cutover evidence. Every later release candidate must repeat exact-candidate review and CI binding.

## 25. On-demand attachment scan job

New uploads remain private temporary attachments with `scanStatus=PENDING`; the application creates no business `AttachmentLink` and issues no preview/download URL until the status is `PASSED`. `REJECTED` and exhausted/failed scans remain fail-closed and cannot be referenced.

The normal Worker remains available for steady traffic. A scale-to-zero scheduler may instead run the same application image with this command:

```bash
node worker-dist/attachment-scan-main.js
```

The command recovers only stale `ATTACHMENT_SCAN` leases, claims at most one due scan JobTask with `FOR UPDATE SKIP LOCKED`, runs the existing handler, persists success or retry/backoff, and exits. It does not consume Outbox or unrelated jobs. An idle invocation exits successfully. Multiple invocations remain safe because JobTask enqueue and claim are idempotent/lease-protected.

Deployment TEST and PROD Web/scan-job processes must both explicitly inject `ATTACHMENT_STORAGE_PROVIDER=cos` and the same COS bucket/region identity, plus `FILE_SCAN_PROVIDER=clamav`, `CLAMAV_HOST`, `CLAMAV_PORT` and `CLAMAV_TIMEOUT_MS`; `APP_ENV=test` is not a storage or scanner provider identity. Keep database, COS credentials and scanner endpoint configuration in deployment Secret/runtime configuration, never in the image. The scheduler, private network path, ClamAV endpoint or sidecar, retry cadence, alerts and minimum-instance setting remain cloud wiring; prefer minimum instances zero where cold-start latency is acceptable. Before enabling traffic, prove a Web-uploaded object is readable by a separate scan-job process, clean acceptance, EICAR rejection, retry after scanner outage, and zero business links/signed URLs for non-passed attachments in the real TEST environment.
