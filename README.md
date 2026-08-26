# 智链宝 V2.0

智链宝 V2.0 的模块化单体工程。当前基线包含 M0 阶段的数据库、认证、组织权限与附件服务底座，不包含正式业务模块。

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
npm run test:e2e:critical
npm run build
```

Playwright 首次运行前需要安装浏览器：

```bash
npx playwright install chromium
```

## Docker

```bash
docker build -t zhilianbao-v2:m0-005 .
docker run --rm -p 3000:3000 zhilianbao-v2:m0-005
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

TEST 连接真实 COS 前须确认 bucket 为 private、地域与 bucket 名一致、服务账号仅有必需的对象权限、CORS 只允许 TEST 来源，并验证分片上传、断点续传、staging 清理和短时下载 URL。未配置扫描器或扫描器不可用时，附件保持不可访问（fail closed）。本里程碑只创建 `ATTACHMENT_SCAN` 任务和处理服务；通用扫描 Worker 从 M0-006 开始。

## 开发规范

开始任何任务前必须阅读 [AGENTS.md](./AGENTS.md) 及其指定的开发基线。后续任务继续遵守一个任务、一个分支、一个可审查 PR 的工作方式。
