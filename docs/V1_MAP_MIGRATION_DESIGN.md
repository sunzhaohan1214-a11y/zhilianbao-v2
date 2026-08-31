# V1 地图资料迁移与 V2 产品设计

> 状态：候选设计；不代表边界已获授权、已激活或已写入 V2 数据库。

## 1. 设计目标

V1 地图资料拆成两条互不混用的产品链路：

```text
企业地图：宝应县 → 镇区/园区 → 企业
团员地图：中国 → 省 → 市 → 派出单位 → 团员
```

地图只帮助浏览和定位。正式企业属地、人员身份和批次履历均由 V2 业务关系决定，不由坐标推断。

## 2. 企业地图

- 县级显示宝应县边界、镇区/园区边界和企业数量气泡。
- 数量唯一权威为 `Enterprise.responsibleAreaId` 的服务端聚合。
- 点击镇区/园区后在同页展开企业点和企业列表，不创建空二级页面。
- 企业坐标只用于落点；无坐标企业仍出现在列表，并进入地图待完善队列。
- `baoying_county`、`baoying_towns` 只生成候选目录。来源许可、坐标系、区域匹配和版本说明确认后，才能由管理员创建 `MapBoundaryVersion`；创建后仍须单独预览、确认和激活。
- 激活边界不得修改任何企业的 `responsibleAreaId`。

## 3. 团员地图

- 地图含义固定为派出单位地域分布，不是团员位置、来离宝位置或行程轨迹。
- 人员统计链路固定为 `Person → BatchMembership → dispatchOrganization`，按 `Person.id` 去重。
- 当前批次、指定历史批次和往届分别按正式批次关系筛选；延任人员不得重复计数。
- V1 的 59 条机构位置生成 `dispatch-organization-location-candidates.json`，保留名称、别名、省、市和坐标。
- 每条候选必须人工匹配正式、有效的 `Organization(type=DISPATCH_UNIT)` 后才能写入；同名、别名冲突或坐标系不明确时保持待确认。
- 缺省市或坐标的派出单位仍展示人员列表，并进入“地图信息待完善”。

## 4. 候选产物

```text
governance/map-candidates.json
governance/dispatch-organization-location-candidates.json
```

`map-candidates.json` 保存 GeoJSON 哈希、要素名称、几何类型、范围、bbox、处置状态和两张地图的产品层级。

`dispatch-organization-location-candidates.json` 保存来源许可与署名、机构名称/别名、省、市、坐标、下钻路径和人工确认原因。

两份文件都属于敏感迁移目录，不进入 Git，不直接写正式表。

## 5. 写入前门槛

1. 对 GeoJSON 确认来源许可、坐标系、行政区域映射和版本说明。
2. 对派出单位候选确认唯一正式 Organization，禁止仅凭模糊名称自动合并。
3. 在目标库执行只读预览，列出新增、匹配、冲突和跳过项。
4. 管理员逐项确认后，通过正式 MapService/Organization Service 写入并审计。
5. 地图故障、无边界或无坐标时，企业和团员列表必须继续可用。

## 6. 明确禁止

- 不把 Organization 与 AdministrativeArea 合并。
- 不根据企业坐标改变正式属地。
- 不把派出单位坐标解释成团员实时位置。
- 不使用 GPS、Presence 或行程数据绘制团员位置。
- 不生成或猜测宝应真实边界。
- 不把全国、省级 GeoJSON 和大纹理直接打进首屏 bundle。
- 不因边界换版静默修改业务数据。
