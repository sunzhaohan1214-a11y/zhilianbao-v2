# 智链宝 V2.0

智链宝 V2.0 的模块化单体工程。本分支只实现 M0-001 Project Skeleton，不包含数据库与正式业务逻辑。

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
docker build -t zhilianbao-v2:m0-001 .
docker run --rm -p 3000:3000 zhilianbao-v2:m0-001
```

容器内服务监听 `0.0.0.0:3000`。

## 开发规范

开始任何任务前必须阅读 [AGENTS.md](./AGENTS.md) 及其指定的开发基线。后续任务继续遵守一个任务、一个分支、一个可审查 PR 的工作方式。
