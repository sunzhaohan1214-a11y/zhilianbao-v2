# 智链宝 V2.0 — SECURITY_SPEC.md

> 版本：v1.0  
> 状态：安全基线

## 1. 安全边界

所有内部业务访问：

```text
HTTPS
→ Session
→ Account
→ Permission
→ Scope
→ State
→ Sensitive Grant
```

公开企业填报页除外，但只能创建线索，不能访问内部数据。

## 2. 密码

- Argon2id；
- 初始手机号后6位是已确认运营规则；
- 首登强制修改；
- 新密码>=8位；
- 不得等于手机号后8位；
- 重置后全部设备退出；
- 密码明文永不日志/审计/导出。

## 3. Session

Cookie：

```text
HttpOnly
Secure
SameSite=Lax
Path=/
```

Session token在DB存摘要，不保存可直接复用的明文。

敏感变更立即撤销Session或permission version失效。

## 4. CSRF

写请求：

- SameSite Cookie；
- Origin/Referer校验；
- 对高风险命令使用CSRF token/双重保护或等价框架机制；
- 公开表单另走独立防滥用流程。

## 5. Rate Limit

不做可见验证码/锁号，但服务端限速。

至少按：

```text
phone
IP
device
route
```

登录失败递增退避。

公开填报：

- IP；
- 设备；
- 频率；
- 重复内容指纹；
- 行为验证 Adapter。

达到阈值返回429，不泄露账号是否存在。

## 6. Authorization

所有关键写 API 服务端 Permission。

数据库查询阶段带 Scope。

禁止全量返回后前端过滤。

## 7. IDOR

任何：

```text
GET /resource/:id
```

都必须做对象级授权。

UUID不是权限。

## 8. SQL

Prisma参数化为默认。

`$queryRawUnsafe` 禁止。

确需 raw：

> `$queryRaw` + 参数绑定 + Repository内封装。

## 9. XSS

用户文本默认按纯文本展示。

富文本如公告需要：

- 白名单HTML；
- Sanitizer；
- 禁止script；
- 禁止危险URL协议。

不要为了格式直接 `dangerouslySetInnerHTML` 未清洗内容。

## 10. 文件

- 白名单类型；
- 扩展/MIME/magic联合；
- 50MB；
- 私有COS；
- 短签名；
- 恶意扫描；
- 禁止可执行；
- 文件名只作为展示，不作为对象key；
- 敏感附件访问审计。

## 11. 导出

使用字段白名单。

创建任务时鉴权。

下载时再次鉴权。

文件：

- 仅发起者可下载；
- 短时过期；
- 自动清理；
- 下载日志。

导出不得包含：

- password_hash；
- token；
- Secret；
- 有效Session；
- 原始系统备份。

## 12. AI

- 最小化数据；
- Sanitizer；
- 不发无关电话；
- 不发密码/Session；
- 不给模型DB/COS永久凭证；
- 输出再授权；
- 私人对话正文隔离。

## 13. 审计

高风险操作全部审计。

AuditLog追加。

防止业务用户删除。

## 14. 安全Headers

部署设置至少：

```text
Content-Security-Policy
X-Content-Type-Options: nosniff
Referrer-Policy
Permissions-Policy
frame-ancestors / X-Frame-Options
HSTS（正式HTTPS稳定后）
```

CSP按腾讯地图/COS等真实域名逐项白名单，禁止 `*` 偷懒。

## 15. CORS

同域优先。

API默认不开放跨域。

公开页面也从同一应用域提供。

如未来跨域：

> 精确 allowlist，不允许 `*` + credentials。

## 16. 错误信息

外部响应不返回：

- SQL；
- stack；
- 文件系统路径；
- Secret；
- 内网地址。

日志可记录安全的内部错误码。

## 17. 账号枚举

登录错误统一文案：

> 账号或密码错误 / 当前无法登录。

不要明确告诉攻击者：

- 手机号存在；
- 手机号不存在；
- 该账号是管理员。

## 18. 高权限操作

要求：

```text
Permission
+ reason
+ impact preview
+ confirmation
+ current version check
+ transaction
+ audit
```

Restore、负责人转交、企业合并、批次切换等不能仅一个按钮直接执行。

## 19. Public Form

公开企业需求填报：

- 只写线索；
- 无内部读取；
- 随机/固定镇区公开入口按产品配置；
- Rate limit；
- 重复检测；
- 附件白名单；
- 输入长度限制；
- 不允许HTML；
- 不向企业展示内部处理过程。

## 20. Secret扫描

CI建议检查：

- `.env`；
- AccessKey格式；
- DATABASE_URL；
- private key。

发现Secret commit：

> 立即轮换，不只是删除Git最新行。

## 21. 依赖

- 锁定 package-lock；
- 定期依赖审计；
- 高危漏洞优先升级；
- 不使用无人维护认证/加密库。

## 22. 安全放行门槛

上线前：

- 权限越权自动测试100%通过；
- AI越权评测100%通过；
- 无生产Secret进仓库；
- 公共表单限速有效；
- 文件下载无IDOR；
- 报销/求助可见性测试通过；
- Restore权限测试通过。

## 23. M3-005 Excel 安全

- Import 源文件必须经 Attachment 完成、真实类型识别、恶意扫描 `PASSED` 后绑定 `IMPORT_BATCH/SOURCE_FILE`，并永久私有。
- 关键身份字段公式单元格阻断；普通公式仅可使用缓存值并产生 warning。
- 导出文本以 `= + - @` 开头时前置单引号，防止 Formula Injection。
- Preview 手机号默认脱敏，结构化日志和批次 Audit 不记录 raw row 或完整手机号。

**SECURITY_SPEC.md v1.0 END**
