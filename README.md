# 智链宝 V2.0

智链宝 V2.0 的模块化单体工程。当前 `main` 已包含 M0–M3 第一阶段代码基线：数据库与权限底座、企业与需求闭环、团员/通讯录/地图/行程/人才/政策、报销/求助/消息、固定报表、导入迁移、系统管理、备份恢复编排及发布安全门。代码合并完成不等于正式上线，当前仍为内测、真实数据演练与上线验收阶段。

## 当前事实快照

截至 2026-09-02：

| 项目 | 当前事实 |
| --- | --- |
| `main` | `b97588e721d954ae7590ffd6f70dab5dc99e4480`，PR #50 合并后的代码树已通过 CI #482 |
| 第一阶段代码 | M0–M3 已合入；PR #22、#24、#28、#29、#35、#36、#39、#40、#41、#42、#50 等均已合并 |
| 主线治理 | `main` 受保护；required checks 为 `quality`、`database`、`critical-e2e`、`docker-build`、`security`、`performance`、`browser-compat` |
| 仓库可见性 | 当前为 public；这是仓库治理事实，不是发布证据，上线前仍须确认是否继续维持公开 |
| V1 数据 | PR #42 只完成参考资料包的 `SAMPLE` 适配，不能替代受控 `FULL` 演练、正式迁移或对账 |
| 发布结论 | `RELEASE_READY=NO`；TEST 部署与 smoke、具名 UAT、真实 FULL 演练、生产备份/恢复及 PROD preflight 尚未形成完整证据 |

## 技术栈

- Next.js 16、React 19、TypeScript strict
- Tailwind CSS 4
- Vitest、Playwright
- npm + `package-lock.json`
- Next.js standalone Docker 镜像

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
```

Playwright 首次运行前需要安装浏览器：

```bash
npx playwright install chromium
```

## Docker

```bash
docker build -t zhilianbao-v2:m3-008 .
docker run --rm -p 3000:3000 zhilianbao-v2:m3-008
```

容器内服务监听 `0.0.0.0:3000`。

## 附件服务配置

附件服务只支持 private 腾讯云 COS bucket。服务端使用 `COS_SECRET_ID` 和 `COS_SECRET_KEY` 换取仅限单一 staging object、短期有效的 STS 凭证，永久密钥不会下发浏览器。配置项见 `.env.example`：

```text
COS_REGION
COS_BUCKET
COS_SECRET_ID
COS_SECRET_KEY
ATTACHMENT_SIGNED_URL_TTL_SECONDS
ATTACHMENT_UPLOAD_TTL_SECONDS
```

TEST 连接真实 COS 前须确认 bucket 为 private、地域与 bucket 名一致、服务账号仅有必需的对象权限、CORS 只允许 TEST 来源，并验证分片上传、同一 SDK 实例内的 task 级暂停/恢复与 multipart 重试、staging 清理和短时下载 URL。该能力不等同于浏览器关闭后的无限期跨会话续传。未配置扫描器或扫描器不可用时，附件保持不可访问（fail closed），Worker 会按安全退避重试。

## Worker / Outbox

Web 与 Worker 来自同一仓库和镜像，但使用独立进程：

```bash
npm run start:web
npm run start:worker
```

Worker 使用 MySQL 8 `FOR UPDATE SKIP LOCKED` 领取 Job，通过 `locked_at` / `locked_by` 维护 lease 和 heartbeat。崩溃后的 stale Job 会按重试上限恢复；`ATTACHMENT_SCAN` 同时把仍处于 `SCANNING` 的附件恢复为 `FAILED / STALE_SCAN_RECOVERED`，随后可安全重试。Outbox consumer 只允许短事务内的 DB 操作或幂等转 Job，禁止在持锁事务内调用网络服务。

运维和 CI 可执行单轮模式：

```bash
WORKER_RUN_ONCE=true npm run start:worker
```

横向扩容依赖数据库行锁、owner 条件写回以及 `idempotency_key` / `dedupe_key` 唯一约束，不依赖 Redis 或其他消息队列。

## 开发规范

开始任何任务前必须阅读 [AGENTS.md](./AGENTS.md) 及其指定的开发基线。后续任务继续遵守一个任务、一个分支、一个可审查 PR 的工作方式。
