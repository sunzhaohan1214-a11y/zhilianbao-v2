# 本地优先与零额外云成本基线

> 生效日期：2026-09-04  
> 基线提交：`6f3c22d352676ed1838d85c9324207170b05048c`  
> 状态：基础设施与交付流程的强制覆盖规则

本文件只覆盖开发、验证、云 Provider、成本和部署职责；不改变 PRD、权限、状态机、字段、审计、迁移和数据安全规则。

## 固定职责

- 本地电脑：唯一开发、编译、自动化测试和完整浏览器交互验收现场。
- Codex：在干净独立工作树修改代码、运行本地检查、修复缺陷并生成 exact-SHA 部署产物。
- GitHub：公开代码仓库、PR 审阅、版本历史和代码中转；不运行 Actions、云端编译、云端测试或云端制品构建。
- WorkBuddy：核对 exact SHA，接收本地已验证产物，只执行 CloudBase 部署和部署后 smoke；不生成代码、不编译、不修 Bug、不决定 migration。
- CloudBase：只允许使用已经确认属于固定套餐的能力。套餐外能力默认拒绝。

## 已取消的能力

- GitHub Actions 自动或手工云端编译、测试和制品上传。
- Tencent CynosDB SDK、自动快照和恢复到新集群。
- Tencent SSM SDK 和运行时 Secret 拉取。
- 独立 COS SDK、STS 与浏览器直传。
- 外部 HTTP 票据 OCR。
- 需要 Key 的腾讯地图 Web SDK；地图改为浏览器本地绘制版本化 GeoJSON。

代码中保留的 `Unavailable*Provider` 是安全阻断器，不会调用云 API。测试用 Fake/Memory Provider 只允许 `APP_ENV=local/test` 且非生产运行时。

## 本地验证

基础检查：

```bash
npm run verify:local
```

配置独立本地 MySQL 8.4 与扫描器后执行完整检查：

```bash
npm run verify:local:full
```

本地验证摘要必须记录 commit SHA、命令、开始/结束时间和结果，不得包含密码、Token、数据库连接串、真实业务数据或原始附件。

## 部署门禁

以下任一项不明确即停止部署：

1. 产物不是由 Codex 在本地从 exact SHA 构建并验证；
2. WorkBuddy 需要现场安装依赖、编译或修改代码；
3. 某数据库、附件存储、Secret、备份、AI/OCR、地图、日志、监控、CDN 或短信能力无法证明包含在固定 CloudBase 套餐内；
4. 为降低成本需要改用明文 Secret、公开附件、跳过恶意文件扫描、连接非隔离数据库或取消可恢复性；
5. TEST、UAT、V1 FULL、恢复演练或 PROD 门禁被 GitHub 历史记录替代。

## 当前限制

- 已移除额外付费对象存储，因此部署环境附件功能保持 fail closed；在实现并批准 CloudBase 套餐内存储适配器前不能发布依赖附件的完整版本。
- 已移除外部 OCR，报销继续使用人工录入和人工确认。
- 已移除真实云备份 Provider，备份/恢复就绪度为 `NOT_CONFIGURED`；在套餐内方案通过恢复验证前 `RELEASE_READY=NO`。
- GitHub 仓库保持公开；严禁提交 Secret、真实业务数据、V1 原包、真实附件和敏感运行证据。

## 变更控制

新增或恢复任何外部服务必须同时提供：服务名称、用途、是否属于固定 CloudBase 套餐、最坏月成本、停用方式、数据范围、安全方案和用户明确批准。缺一项不得合入。
