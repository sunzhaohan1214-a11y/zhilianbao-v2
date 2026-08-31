# V1 参考资料包适配器

## 1. 用途与边界

`migration:prepare-v1-package` 将经校验的 V1 本地参考资料包转换为现有 `V1_SOURCE_CONTRACT` 目录。适配器固定输出：

```text
snapshotKind=SAMPLE
sourceClassification=REFERENCE_EXPORT_NOT_FINAL
isSanitized=false
fullRehearsalEligible=false
```

它不能将本地 D1 快照或参考导出提升为 V1 最终生产快照，也不会写 TEST/PROD、开通账号、赋予角色或激活地图边界。

## 2. 运行

```bash
npm run migration:prepare-v1-package -- \
  --source <extracted-package-root> \
  --output <new-private-output-directory>

npm run migration:v1 -- \
  --source <new-private-output-directory> \
  --mode sample \
  --dry-run \
  --output <private-report-directory>
```

输出目录包含完整联系方式和照片，必须保持在受控本地存储中，不得提交 Git。

## 3. 转换与人工治理

- 成员/通讯录单位转换为 `ORGANIZATION` 候选。
- 成员和通讯录人员转换为 `PERSON` 候选，但全部 `accountEligible=false`。
- 未来批次使用 `FUTURE_MEMBER_CANDIDATE`，通讯录使用 `INTERNAL_STAFF`，不假装为往届或在任团员。
- 企业主档、信用代码、法人、主营产品、资质荣誉和展示坐标进入 `ENTERPRISE` 候选。
- 被成员权威记录引用的照片进入附件 manifest，仍需正式扫描、私有存储和权限关联。
- 旧账号/角色、在岗/任职/批次、缺姓名企业电话、标签映射、D1 历史、未引用照片全部进入治理清单。

无法自动承载的原字段仍保留在校验通过的源包中，`governance/retained-source-fields.json` 只保留字段引用，不复制额外敏感值。

## 4. 地图优化策略

- `baoying_county` 和 `baoying_towns` 仅作 V2 县/镇区边界候选。
- 全国、省级和地形纹理不进入首期前端 bundle，仅作参考。
- 语法、坐标范围、要素数、几何类型和 bbox 进入 `governance/map-candidates.json`。
- 来源许可、归属、坐标系和边界版本未证明时不创建/激活 `MapBoundaryVersion`。
- 企业坐标与 `responsible_area_id` 始终分离。
- `member-institution-locations.json` 转换为独立的派出单位位置候选，保留名称、别名、省、市和坐标，用于“全国 → 省 → 市 → 派出单位 → 团员”设计。
- 派出单位位置候选必须人工匹配正式 `DISPATCH_UNIT`；坐标只代表单位地域，永远不得解释为团员当前位置。
- 输出中的 `productDesign` 固化两张地图的层级和统计权威，避免后续把点位坐标误作业务归属或人员位置。
- `dispatch-organization-location-match-preview.json` 按正式组织候选逐条给出零个、唯一或多个位置候选；即使唯一匹配也只是审核建议，不构成写入授权。

## 5. 安全

适配器拒绝 symlink、路径穿越、源/输出重叠、checksum 覆盖不完整和 manifest 数量/字节/哈希不一致。dry-run 问题报告不写原始 `sourceSnapshot` 或候选对象标识，只保留来源 ID、问题代码和候选数量。
