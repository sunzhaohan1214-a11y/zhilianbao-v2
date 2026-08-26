# 智链宝 V2.0 开发基线包

该包已经完成 V2.0 第一阶段进入 Codex 开发前所需的产品/技术规格化。

## 正确开工方式

1. GitHub 建私有仓库。
2. 把本包根目录 `AGENTS.md` 与 `docs/` 放入仓库。
3. 把 `CODEX-FIRST-PROMPT.md` 作为 Codex 第一个任务。
4. 只实现 M0-001，不要一次开发全部系统。
5. 每个功能 branch → CI → PR → TEST → 验收 → merge。
6. WorkBuddy 只部署 GitHub 中已合并/打Tag的版本。

## 核心技术

- 单仓库模块化单体
- Next.js + React + TypeScript
- Mobile / PC Admin 双 UI
- TDSQL-C MySQL + Prisma Migrate
- DB Session + 五层权限
- COS 私有对象存储
- Transactional Outbox
- MySQL Job Queue + Worker
- AI/OCR/Search Adapter
- 腾讯地图 + 自有 GeoJSON
- 第一阶段不微服务、不Redis
- Vitest + Playwright

## 当前唯一明确待财务制度补充

交通补助 / 伙食补助精确计发天数规则。

在制度明确前：
- 保留80元/天、100元/天参考标准；
- 由用户按真实制度手工填写天数和金额；
- Codex不得自行编计算公式。
