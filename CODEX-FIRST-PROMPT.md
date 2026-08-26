# CODEX_FIRST_PROMPT.md

把下面内容作为新仓库第一次交给 Codex 的任务。

---

请先完整阅读根目录 `AGENTS.md`，并按其要求阅读 `docs/` 下全部开发基线文档。

本次**只执行 `docs/IMPLEMENTATION_PLAN.md` 的 M0-001 Project Skeleton**，不要实现企业、需求、人才、报销等业务功能。

目标：

1. 初始化一个 Next.js + React + TypeScript 项目；
2. 使用 npm + package-lock.json；
3. 建立 Mobile H5 与 PC Admin 两套独立 layout 骨架；
4. 建立 `src/modules` 模块目录骨架，但不要实现业务逻辑；
5. 配置 ESLint、TypeScript strict、Vitest、Playwright；
6. 配置 `next.config` standalone 输出；
7. 创建三阶段 Dockerfile，可在 3000 端口运行；
8. 创建 `/health` 与 `/ready` 基础接口；此阶段 `/ready` 可只检查应用基础配置，不要假装已接数据库；
9. 创建 `.env.example`，不得写任何真实Secret；
10. 建立基础CI命令：
   - `npm run lint`
   - `npm run typecheck`
   - `npm run test:unit`
   - `npm run test:integration`
   - `npm run test:e2e:critical`
   - `npm run build`
11. 创建最小README，说明本地启动和测试命令；
12. 不连接V1正式数据库；
13. 不创建任何应用启动自动建表代码；
14. 不使用 `prisma db push`；
15. 不添加 Redis、微服务、Kafka、RabbitMQ、Elasticsearch。

页面骨架只需验证：

```text
/
  手机首页空骨架

/demands
  手机需求空骨架

/resources
  手机资源空骨架

/me
  手机我的空骨架

/admin
  PC管理后台空骨架
```

手机底部导航必须只有：

```text
首页 / 需求 / 资源 / 我的
```

不要做完整视觉，不要添加全局悬浮“+”。

完成后：

1. 运行全部当前可运行的 lint/typecheck/test/build；
2. 修复失败；
3. 输出新增/修改文件清单；
4. 输出所有命令结果摘要；
5. 明确指出下一步应该是 M0-002，而不要自行继续开发；
6. 不要直接修改 main，使用 `feature/m0-project-skeleton` 分支并准备 PR。
