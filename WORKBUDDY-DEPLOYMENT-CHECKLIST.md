# WORKBUDDY_DEPLOYMENT_CHECKLIST.md

> 用于后续 TEST / PROD 部署执行。  
> 当前先作为清单，不要在 M0-001 就部署 PROD。

# TEST发布前

- [ ] GitHub main 已合并
- [ ] CI全绿
- [ ] 无 `.env` / Secret commit
- [ ] Migration已在本地测试
- [ ] TEST数据库备份/快照（涉及重要数据时）
- [ ] TEST DATABASE_URL确认不是PROD
- [ ] TEST COS确认不是PROD
- [ ] AI/OCR TEST配置确认
- [ ] Docker build成功

# WorkBuddy 构建

如 safe-delete hook 干扰：

```bash
NODE_OPTIONS="" npm ci
NODE_OPTIONS="" npm run build
```

不要依赖大批量 `rm -rf`。

必要时移动目录：

```bash
mv node_modules ../cache-node_modules
mv .next ../cache-next
```

# CloudBase

必须确认：

- [ ] 地域正确
- [ ] Service正确
- [ ] 端口3000
- [ ] VPC正确
- [ ] Subnet正确
- [ ] 数据库走内网
- [ ] Environment Variables保留
- [ ] `output: standalone`

V1曾验证：

> VPC配置丢失会导致服务部署成功但数据库不可达。

所以每次发布都把VPC检查列为显式步骤。

# Database Migration

TEST：

```bash
npx prisma migrate deploy
```

禁止：

```bash
prisma db push
```

PROD Migration必须在：

> 正式发布前快照之后。

# 部署后

- [ ] `/health` 正常
- [ ] `/ready` 正常
- [ ] 登录正常
- [ ] DB连接正常
- [ ] 首页正常
- [ ] 权限Smoke
- [ ] Worker正常
- [ ] Outbox无异常积压
- [ ] 5xx无明显增长

# PROD额外

- [ ] UAT通过
- [ ] P0=0
- [ ] P1=0
- [ ] PROD DB快照
- [ ] COS版本保护正常
- [ ] 回滚Git Tag已确认
- [ ] Migration已在TEST执行成功
- [ ] 变更清单已确认

# 出问题

代码问题：

```text
回滚Git Tag
→ 重新部署旧Docker
```

不要：

> 因页面bug恢复数据库。

数据灾难才按 OPERATIONS 的 Restore Runbook。

**WORKBUDDY_DEPLOYMENT_CHECKLIST.md END**
