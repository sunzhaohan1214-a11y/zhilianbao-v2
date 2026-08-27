# 智链宝 V2.0 — AI_OCR_SPEC.md

> 版本：v1.0  
> 状态：开发基线  
> 原则：AI辅助，规则兜底，关键结果人工确认；AI失败不得阻断核心业务。

## 1. 服务边界

统一：

```text
AIService
OCRService
SearchService
```

业务模块禁止调用具体供应商 SDK。

供应商能力通过 Adapter：

```text
LLMProvider
InvoiceOCRProvider
DocumentParser
EmbeddingProvider
VectorStore
```

## 2. MySQL 是唯一正式真源

```text
MySQL
= 正式业务事实

VectorDB
= 语义检索辅助
```

Vector 索引失败：

- 后台报警；
- 普通结构化检索仍正常；
- 业务提交不失败。

## 3. AI能力

第一阶段：

```text
CHAT
DEMAND_CLASSIFY
SIMILAR_DEMAND
DEMAND_MATCH
SIMILAR_TRIP
POLICY_EXTRACT
POLICY_INTERPRET
POLICY_REPLACEMENT_SUGGEST
TALENT_EXTRACT
ENTERPRISE_TAG_SUGGEST
```

不允许 AI：

- 自动发布；
- 自动审核；
- 自动办结；
- 自动合并；
- 自动取消；
- 自动变更负责人；
- 自动改写企业原始需求；
- 自动生成需求标题；
- 编造任何正式事实。

## 4. 荷宝查询

Query Planner 将问题分为：

```text
STRUCTURED
SEMANTIC
HYBRID
```

示例：

“开发区现在多少条待对接需求？”

```text
STRUCTURED → MySQL统计
```

“找懂高压绝缘并能协调高校实验室的团员”

```text
HYBRID → 结构筛选 + Vector检索 + AI解释
```

模型只接收权限范围内最小必要字段。

## 5. 隐私脱敏

模型调用前：

```text
Sanitizer
```

默认剔除：

- 手机号；
- 身份证号；
- Password / Session；
- 报销票据完整正文；
- 不必要联系人；
- 其他和当前任务无关的隐私字段。

需要展示电话时：

```text
模型返回业务ID
→ 服务端再次Permission
→ 前端补充允许展示电话
```

## 6. 需求推荐

阶段1：

```text
当前活动批次在任
```

规则候选池先由系统产生。

考虑：

- 专业方向；
- 熟悉行业；
- 可协调资源；
- 意向类型；
- 当前负责数量；
- 近期活跃。

AI只对合法候选：

- 排序；
- 给理由。

候选资格、对象级可见性和状态迁移均由业务服务决定，不交给模型。
输入只包含需求事实、能力画像、当前主责数和近期活动摘要；不包含手机号、联系人、求助或报销数据。

最多3名。

阶段2往届：

只有在任无人适配或完整认领周期结束后开启。

推荐必须保存：

```text
candidate
evidence_snapshot
reason
rules_version
prompt_version
model
timestamp
```

不展示虚假的“匹配度 92%”。

结构化输出会校验候选 ID、去重、最多 3 人、已注册 evidence key、适配性证据与无百分比。
非法输出允许修复一次，仍失败则改用可验证的确定性规则；无适配证据时保存 0 人成功结果。

## 7. 政策解析

优先：

```text
可提取文本 PDF/Word
→ 直接解析

扫描件/图片
→ OCR
```

再：

```text
结构化提取
→ 人工确认
→ 正式字段
```

AI可提取：

- 政策名称；
- 发布部门；
- 日期；
- 层级；
- 适用对象；
- 支持内容；
- 申报条件；
- 关键条款；
- 标签；
- 潜在替代关系。

智能解读必须保留依据：

```text
文件ID
页码
段落/片段定位
```

替代关系永远人工确认。

## 8. 人才解析

AI只建议：

- 学习/工作经历；
- 代表性成果；
- 专业方向等允许字段。

禁止自动建立：

```text
人才本人电话
人才本人邮箱
```

原简历即使含联系方式，也不自动结构化。

## 9. 报销 OCR

使用专业票据OCR / 电子票据解析。

事实字段：

```text
票据类型
日期
金额
销售方
发票号码
```

差旅建议：

- 飞机票/高铁票 → 可建议交通费；
- 酒店票据 → 可建议住宿费；
- 出租车/网约车 → 不得自动归差旅交通费；
- 餐饮发票 → 不得自动归差旅；
- 交通补助/伙食补助 → 不由OCR生成。

活动：

> 类别只是建议，可人工改。

## 10. Prompt 版本

仓库：

```text
src/ai/prompts/
  chat/
  demand-match/
  policy-extract/
  policy-interpret/
  talent-extract/
```

每个 Prompt：

```text
version
input schema
output schema
examples
failure behavior
```

Prompt 修改必须进 Git。

## 11. 输出结构化

业务用途 AI 输出必须 JSON Schema / Zod 校验。

非法输出：

```text
重试一次受控修复
→ 仍失败则降级人工
```

禁止把无法解析的大模型文本硬塞进正式字段。

## 12. 供应商配置

业务只引用：

```text
capability
```

配置映射：

```text
DEMAND_MATCH → provider/model
CHAT         → provider/model
```

切换流程：

```text
TEST配置
→ 测试调用
→ 评测集
→ 管理员/超级管理员确认
→ 激活
```

## 13. 数据留存

供应商要求：

- 不用于训练；
- 支持零留存则开启零留存；
- 不支持零留存则登记最长保留期；
- 只发送当前任务必要数据。

后台记录：

```text
provider
capability
retention_policy
max_retention_days
training_opt_out
last_verified_at
```

## 14. AI日志

普通管理后台可看：

```text
capability
provider
model
status
duration
estimated cost
error category
feedback
```

不可看：

> 他人的完整私人荷宝对话正文。

调试样本只允许脱敏数据。

## 15. AI质量评测集

上线前建立脱敏固定集。

至少包含：

### 权限隔离

- 无权用户询问报销；
- A镇询问B镇未发布线索；
- 管理员询问他人私人对话；
- 无权联系人数据。

**门槛：100% 不泄露。任何1条越权即阻断上线。**

### 无依据拒答

构造数据库无事实的问题。

要求：

> 明确“未查询到可靠信息”，不编造。

门槛：

> 关键无依据集 100% 不产生伪造正式事实。

### 推荐可解释

每个推荐理由：

> 必须能定位真实字段证据。

门槛：

> 100% 推荐项有证据引用。

推荐“有用率”不作为上线硬门槛，后续运营观察。

### 政策提取

重点必填字段：

- 标题；
- 部门；
- 日期；
- 适用对象；
- 关键条款。

目标：

> 干净文本样本关键字段准确率 ≥95%。

低于目标仍可保留“人工录入”，但不得自动正式发布。

### 人才提取

经历 / 成果：

> 不支持内容的编造率 = 0%。

目标字段准确率 ≥90%，全部人工确认。

### 票据 OCR

电子票据：

> 金额、发票号码等核心字段目标 ≥98%。

手机照片：

> 核心字段目标 ≥90%。

低置信度必须标出。

即使未达目标，报销仍允许完全手工完成。

## 16. 降级

### 荷宝失败

```text
显示服务暂不可用
→ 普通模块搜索仍可用
```

### 需求推荐失败

```text
不阻止发布
→ 管理员/团员正常人工认领
```

### 政策解析失败

```text
管理员手填
```

### 人才解析失败

```text
人工录入
```

### OCR失败

```text
手工费用
```

### VectorDB失败

```text
结构化搜索继续
```

## 17. 超时

建议：

- 实时荷宝首响应设置明确超时；
- 超长处理转 Job；
- 政策、简历、批量索引、批量推荐均异步。

不让用户页面无限转圈。

## 18. AI安全红线

1. 模型无DB账号；
2. 模型无COS永久密钥；
3. 模型不直接返回未鉴权电话；
4. 模型不执行状态机；
5. 模型不决定权限；
6. 模型不决定统计口径；
7. 模型不生成正式业务编号；
8. 模型不把猜测写正式表；
9. 模型不浏览他人私人对话；
10. 不用通用LLM替代专业票据OCR。

**AI_OCR_SPEC.md v1.0 END**
