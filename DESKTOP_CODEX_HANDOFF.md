# 智链宝 V2：桌面 Codex 阶段 B 交接单

> 交接时间：2026-09-02
>
> 任务性质：V1 发布收口，不是继续扩充新功能
>
> 当前结论：第一阶段代码已经完成；下一步是 V2 TEST 部署、数据准备、smoke 和具名 UAT。完成这些工作前始终保持 `RELEASE_READY=NO`。

## 1. 给接手 Codex 的直接指令

你现在接手 `sunzhaohan1214-a11y/zhilianbao-v2` 的阶段 B。请实际执行任务，不要只给计划或重新审计已经完成的 M0–M3。

工作方式：

1. 先只读核验代码与腾讯云 TEST 资源身份。
2. 只操作专用 V2 TEST；不得触碰 V1 PROD、V2 PROD 或未能确认身份的资源。
3. 在授权范围内连续推进；普通技术细节自行判断。
4. 只有遇到登录/凭据缺失、资源身份不清、需要新增持续计费资源、真实数据授权缺失、产品规则变化或独立审批时才停下找用户。
5. 对用户用大白话汇报：已经做了什么、现在卡在哪里、用户只需做什么。
6. 不得把密码、Token、数据库地址、真实手机号、源资料包或运行证据提交到 Git，也不得在聊天或日志中回显。

这份交接文件位于临时交接分支。读取完成后，不要在交接分支开发；所有代码修改都必须从最新 `origin/main` 新建单一任务分支并走 PR。

## 2. 冻结的代码事实

- 唯一代码真源：`https://github.com/sunzhaohan1214-a11y/zhilianbao-v2`
- 当前 `main`：`d78c9ca6d9bab844ccfbe6a9ee3e07bc9deead08`
- 提交说明：`docs: sync first-stage current truth (#51)`
- `main` CI：GitHub Actions run `33580869147`，结论 `success`
- CI 链接：`https://github.com/sunzhaohan1214-a11y/zhilianbao-v2/actions/runs/33580869147`
- 当前 open PR：0
- 当前 open Issue：0
- required checks：`quality`、`database`、`critical-e2e`、`docker-build`、`security`、`performance`、`browser-compat`
- 仓库当前为 public；不要在本任务中改变可见性。`AGENTS.md` 中“私有仓库”是已知旧描述，当前事实以 live GitHub 与 `docs/RELEASE_READINESS.md` 为准。

开始前必须验证：

```bash
git fetch origin --prune
git switch main
git pull --ff-only
test "$(git rev-parse HEAD)" = "d78c9ca6d9bab844ccfbe6a9ee3e07bc9deead08"
test -z "$(git status --porcelain)"
```

如果 `origin/main` 已前进，不要强行退回；先核对新提交和同一提交的精确 CI，再把本交接单中的候选 SHA 更新为新 `main`。

## 3. 已经完成，不要重复做

- M0–M3 第一阶段主体代码已经合入。
- 生产迁移防误操作、FULL evidence 校验、目标库绑定、幂等和附件对账硬化已经合入。
- V1 参考资料包适配器已经合入，但其输出仍固定为 `SAMPLE`。
- TEST 内部导入所需的备份门槛调整和 TEST-only 行政区域初始化接口已经合入。
- 首阶段 UI、权限、数据库、关键 E2E、Docker、安全、性能和浏览器兼容检查已经通过。
- 阶段 A 的旧 PR 已清理，不要重新合并旧分支。

不要从 M0 重启，不要开展大规模重构，不要提前做 M4。只有 TEST/UAT 发现的明确缺陷或确定缺口才创建 Issue/PR。

## 4. 当前真实阻塞

此前执行环境没有成功登录腾讯云，浏览器最终仍停留在腾讯云登录页。因此：

- 尚未确认任何 V2 TEST CloudBase 环境、服务、数据库、COS、SSM 或 IAM 角色；
- 尚未部署本候选提交；
- 尚未执行 TEST `prisma migrate deploy`；
- 尚未导入 TEST 数据；
- 尚未创建/确认 UAT 账号；
- 尚未做真实 TEST smoke；
- 没有对腾讯云资源做任何修改。

接手环境若已有腾讯云登录态，可以继续；否则只要求用户在当前桌面 Codex 使用的浏览器/终端完成登录。不要让用户把密码或验证码发到聊天里。

## 5. 阶段 B 的执行顺序

### B1. 只读确认 V2 TEST 资源

先列出并记录以下资源的非敏感身份：

- 专用 V2 TEST CloudBase environment 和 service；
- 专用 V2 TEST TDSQL-C/CynosDB MySQL cluster、database、VPC、subnet；
- TEST 私有 COS bucket 或隔离前缀；
- TEST SSM secret 的 name、region、固定 version；
- CloudBase 实例角色及其最小 `ssm:GetSecretValue` 授权；
- Web、Worker、attachment-scan 三个运行进程的部署位置；
- TEST 域名/URL及 HTTPS 状态。

必须证明这些资源属于 V2 TEST。不得因为名称相似就复用旧 V1 环境；不得让 TEST 连接任何 PROD 数据库。若只能看到旧 V1/PROD 或身份不明资源，立即停止写操作并汇报。

若缺少资源且创建会产生新的持续费用，先给用户一份最小资源清单和费用影响，不得自行购买高规格资源。

### B2. 核对运行配置

代码入口：

- 镜像：`Dockerfile.cloudbase`
- 统一入口：`deploy/cloudbase/runtime-entrypoint.sh`
- Node.js：24+
- npm：11+
- 数据库发布命令：`npm run db:migrate:deploy`

部署的关键规则：

- `APP_ENV=test`
- `APP_VERSION` 必须是实际部署的完整 40 位 commit SHA
- deployed TEST 必须使用 COS，不能开启 memory attachment storage
- `FILE_SCAN_PROVIDER=clamav`
- attachment-scan 进程必须使用镜像内私有 ClamAV：`127.0.0.1:3310`
- Web、Worker、attachment-scan 分别设置 `ZLB_PROCESS=web|worker|attachment-scan`
- Secret 由实例角色在运行时从 SSM 读取，不把 Secret 直接写进 CloudBase 明文变量
- SSM JSON 只允许 `DATABASE_URL`、`AUTH_RATE_LIMIT_SECRET`、`COS_SECRET_ID`、`COS_SECRET_KEY`
- 非敏感定位信息使用 `ZLB_RUNTIME_SECRET_NAME`、`ZLB_RUNTIME_SECRET_REGION`、`ZLB_RUNTIME_SECRET_VERSION`
- COS 必须保持私有；下载继续走权限校验和短时签名 URL

以 `.env.example`、`docs/OPERATIONS.md` 和 `src/runtime/runtime-secret.ts` 为准。缺项必须 fail closed，不要用假 provider 冒充真实 TEST 验收。

### B3. 首个 TEST 超级管理员

先确认专用 TEST 数据库是否已有可登录、有效的 `SUPER_ADMIN`，以及是否存在仓库规定的安全初始化路径。

如果全新数据库没有首个管理员，而仓库也没有受控初始化命令：

1. 不要手工直接改表、不要提交固定账号密码、不要新增公开 bootstrap API；
2. 新建一个独立安全任务分支；
3. 实现 TEST-only、一次性、幂等、可审计、输入不落日志的 CLI/运维入口；
4. 强制校验 `APP_ENV` 为 TEST 别名，拒绝 PROD/未知环境；
5. 复用正式密码哈希和账号状态机，初始密码登录后必须修改；
6. 补单元/数据库/安全测试，走 PR、CI 和独立审批；
7. 合并后重新部署最新精确 `main`。

不要为了赶进度把测试 fixture 账号直接复制到真实 TEST。

### B4. 构建、迁移与部署

在干净的精确候选上执行：

```bash
npm ci
npm run db:validate
npm run db:generate
npm run build
```

随后：

1. 再次确认 `DATABASE_URL` 指向专用 V2 TEST；
2. 使用 migration 账号执行 `npm run db:migrate:deploy`，禁止 `prisma db push`；
3. 用 `Dockerfile.cloudbase` 部署同一候选镜像；
4. 启动 Web、Worker、attachment-scan；
5. 检查三者 `/health` 和 `/ready`；
6. 任一步失败就停止，不得带错误数据库结构继续启动新代码。

### B5. TEST 基础数据与内部导入

行政区域初始化接口：

```text
POST /api/v2/test/migration-foundation
```

它只在 TEST/testing/UAT/staging 暴露，并要求已登录且具有系统高权限的账号。调用时使用真实页面同源请求，不要绕过 origin/session/permission 校验。

必须区分两条数据链：

1. `migration:prepare-v1-package` 的参考资料包输出固定为 `SAMPLE`、`applyEligible=false`，只可做受控 dry-run 和治理检查；不得改标签、强行 FULL 或当作正式迁移证据。
2. 经用户批准用于 TEST 的脱敏 Excel/内部资料，可走现有 Admin Import 正式流程：上传、映射、预览、人工解决阻塞行、确认执行、结果对账。不得把源文件提交 Git。

如果没有经过批准的 TEST 数据源，只建立最小的合成 UAT 数据；必须明确写“synthetic TEST data”，不能声称真实数据已经迁移。

历史项目记录曾出现约 138 个组织候选、221 个人员候选、842 家企业、30 个照片来源和 59 个派出单位位置候选。这些数字只能作为待复核线索，不是导入成功证据；必须以本次打开的受控源包、导入报告和数据库查询重新计算。

地图候选始终需要人工治理：不得自动激活边界，不得把坐标当作正式行政归属，也不得把派出单位坐标解释为团员当前位置。

### B6. TEST 账号与 smoke

先创建最小的合成自动化账号，覆盖：

- `SUPER_ADMIN`
- `ADMIN`
- `GROUP_LEADER`
- `MINISTER`
- `MEMBER_CURRENT`
- `TOWNSHIP_STAFF`
- `DEPARTMENT_STAFF`
- `LEADER_STAGE2`
- 必要时 `MEMBER_ALUMNI_PLATFORM`

账号口令不得进入 Git或日志；所有初始账号遵循首次登录修改密码规则。真实人员账号名单由用户确认后再建立，Codex不能代替真实人员签署 UAT。

smoke 至少验证：

- 登录、首次改密、退出、会话撤销；
- 首页和角色导航；
- 团员、行程、企业、需求、人才、通讯录、政策、报销、后台；
- 附件上传、ClamAV clean 接受、EICAR 拒绝、授权下载、越权拒绝；
- Worker/Outbox/Job 能正常消费；
- 普通 ADMIN 不能获得 SUPER_ADMIN 专属能力；
- 普通用户不能读取他人私人 AI 正文或报销正文；
- 关键写操作幂等，失败事务不留下半条数据；
- 手机 Safari/WebKit 路径和弱网络行为。

导入后执行只读一致性核验并保存脱敏报告：

```bash
npm run audit:data-consistency
```

不要把真实 TEST 数据明细或敏感 evidence 提交到 public 仓库。

### B7. 具名 UAT 交付

自动 smoke 通过后，给用户一份大白话手机验收单和测试网址。UAT 必须记录：

- 精确候选 commit；
- TEST URL；
- 测试人、角色、设备/浏览器、时间；
- 每条业务路径结果；
- 缺陷编号与处理结论；
- P0/P1 为 0；
- 业务负责人和运维负责人签字。

自动测试或 Codex 自己点击不能代替具名 UAT。未签字继续保持 `BLOCKED_BY_UAT`。

## 6. 阶段 B 完成标准

只有以下全部成立，才能宣布阶段 B 完成：

- 精确 `main` 候选 CI 全绿；
- V2 TEST 资源身份已确认且与 PROD 隔离；
- TEST `prisma migrate deploy` 成功；
- 同一候选镜像部署成功；
- Web、Worker、attachment-scan 健康；
- ClamAV 与私有 COS 真实可用；
- TEST 基础数据和获批数据完成导入/对账，或明确记录为 synthetic-only；
- 各角色 smoke 与负向权限检查通过；
- 用户拿到 TEST URL、账号说明和手机 UAT 清单。

阶段 B 完成仍不等于上线。以下属于后续阶段，禁止在本交接任务中自动执行：

- V1 正式 FULL 迁移或 PROD cutover；
- V1 数据冻结；
- V2 PROD 数据库写入；
- 生产备份/恢复；
- 正式域名切换；
- `RELEASE_READY=YES` 签署。

## 7. Git 和审批边界

任何代码或文档修改必须：

```text
最新 main
→ 单一任务分支
→ 精确测试
→ PR
→ exact-head required CI
→ 独立审批
→ squash merge
→ main CI 复核
```

禁止直接 push `main`、force push、关闭保护规则、删除失败测试或绕过第二人审批。部署配置调整若不改变代码，也要记录候选 SHA 和变更前后非敏感配置差异。

## 8. 接手后的第一次汇报格式

请先完成只读核验，然后只给用户以下四项：

1. **已经确认**：代码 SHA、CI、登录状态、看到了哪些 V2 TEST 资源。
2. **现在能做**：可立即执行的部署/迁移步骤。
3. **当前阻塞**：仅列真实阻塞，不把“尚未检查”写成失败。
4. **用户只需做**：最多一个明确动作，例如“在当前桌面窗口完成腾讯云登录”。

不要把这份交接单本身当成阶段 B 完成证据。
