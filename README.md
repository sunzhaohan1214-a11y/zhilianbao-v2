# 智链宝 V2.0

智链宝 V2.0 的模块化单体工程。全部开发、编译、测试和完整浏览器交互验收在本地完成；GitHub 只用于公开代码版本管理、PR 审阅和代码中转；WorkBuddy 只部署本地已经验证的 exact-SHA 产物。

除已批准的 CloudBase 固定套餐外，仓库不启用任何额外付费云能力。CynosDB、SSM、COS SDK、外部 AI/OCR 和付费地图 SDK 已从可执行依赖中移除或硬关闭。CloudBase 套餐内存储、Secret 和备份适配器在完成独立确认与实现前保持 fail closed。

## 当前事实快照

截至 2026-09-04：

| 项目 | 当前事实 |
| --- | --- |
| `main` | 零额外云成本整改已由 PR #54 合并至 `beba53c2f6d7cf43308316af8dc1d9abf6aa0db3`；后续工作必须重新抓取并以实时 `origin/main` 为准 |
| 第一阶段代码 | M0–M3 已合入；PR #22、#24、#28、#29、#35、#36、#39、#40、#41、#42、#50 等均已合并 |
| 主线治理 | 当前提交不含 `.github/workflows`；GitHub Actions 云端 CI 已取消，合并依据为 exact-SHA 本地验证清单和人工 Review；仓库级 Actions 开关仍须在每次交付时只读复核 |
| 仓库可见性 | public（已确认保留）；严禁提交 Secret、真实业务数据、迁移原包和敏感运行证据 |
| V1 数据 | PR #42 只完成参考资料包的 `SAMPLE` 适配，不能替代受控 `FULL` 演练、正式迁移或对账 |
| 发布结论 | `RELEASE_READY=NO`；TEST 部署与 smoke、具名 UAT、真实 FULL 演练、生产备份/恢复及 PROD preflight 尚未形成完整证据 |

## 技术栈

- Next.js 16、React 19、TypeScript strict
- Tailwind CSS 4
- Vitest、Playwright
- npm + `package-lock.json`
- Next.js standalone 本地预构建 OCI 镜像

## 本地启动

需要 Node.js 24 LTS 与 npm 11。

```bash
npm ci
npm run dev
```

浏览器访问：

- Mobile H5：`http://localhost:3000/`
- PC Admin：`http://localhost:3000/admin`
- 健康检查：`http://localhost:3000/health`
- 就绪检查：`http://localhost:3000/ready`

## 检查、测试与构建

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:worker
npm run test:security
npm run test:e2e:critical
npm run release:check -- --mode=ci
npm run build
npm run verify:local
# 配置独立本地 MySQL 8.4 后执行完整验证：
npm run verify:local:full
```

Playwright 首次运行前需要安装浏览器：

```bash
npx playwright install chromium
```

## Docker

当前阶段不部署。仓库没有默认 `Dockerfile` 或 `Dockerfile.cloudbase`，防止 GitHub、CloudBase 或其他远端构建器自动编译源码；只保留可在未来本地验证的腾讯云兼容容器结构：

```bash
docker build --file Dockerfile.local --tag zhilianbao-v2:local .
```

`Dockerfile.local` 固定 Node、Next.js standalone、`0.0.0.0:3000`、Web/Worker/扫描进程入口和本地 ClamAV 结构。当前电脑未安装 Docker，因此容器构建为 `NOT_RUN`；这不影响 Node + 本地 MySQL 的平台开发与验收。未来部署前必须先在本地完成镜像验证，不能从 GitHub 源码触发远端应用编译。

## 附件服务配置

独立 COS SDK、STS 和浏览器直传已经取消。本地测试可显式启用内存存储：

```text
APP_ENV=test
NODE_ENV=test
ATTACHMENT_STORAGE_PROVIDER=memory
ENABLE_TEST_MEMORY_ATTACHMENT_STORAGE=true
ATTACHMENT_BUCKET=local-private-attachments
ATTACHMENT_REGION=local
ATTACHMENT_SIGNED_URL_TTL_SECONDS
ATTACHMENT_UPLOAD_TTL_SECONDS
```

生产构建不能启用内存存储。CloudBase 套餐内存储适配器完成并通过私有访问、短时授权、恶意文件扫描和恢复验证前，部署环境附件保持不可用（fail closed），不会回退到额外付费 COS 或公开文件。

## Worker / Outbox

Web 与 Worker 来自同一仓库和镜像，但使用独立进程：

```bash
npm run start:web
npm run start:worker
```

Worker 使用 MySQL 8 `FOR UPDATE SKIP LOCKED` 领取 Job，通过 `locked_at` / `locked_by` 维护 lease 和 heartbeat。崩溃后的 stale Job 会按重试上限恢复；`ATTACHMENT_SCAN` 同时把仍处于 `SCANNING` 的附件恢复为 `FAILED / STALE_SCAN_RECOVERED`，随后可安全重试。Outbox consumer 只允许短事务内的 DB 操作或幂等转 Job，禁止在持锁事务内调用网络服务。

本地运维检查可执行单轮模式：

```bash
WORKER_RUN_ONCE=true npm run start:worker
```

横向扩容依赖数据库行锁、owner 条件写回以及 `idempotency_key` / `dedupe_key` 唯一约束，不依赖 Redis 或其他消息队列。

## 开发规范

开始任何任务前必须阅读 [AGENTS.md](./AGENTS.md) 及其指定的开发基线。后续任务继续遵守一个任务、一个分支、一个可审查 PR 的工作方式。
