# 智链宝 V2.0 — MAP_SPEC.md

> 版本：v1.0  
> 状态：开发基线

## 1. 技术底座

第一阶段：

```text
腾讯位置服务 JS API GL
+ 后端 MapService
+ 自有 AdministrativeArea
+ 版本化 GeoJSON
```

## 2. 组织与区域分离

```text
Organization
= 人员任职单位

AdministrativeArea
= 宝应县/镇区/园区/高新区等业务区域和边界
```

通过 Mapping 关联。

禁止将两者合成一个实体。

## 3. 企业业务归属

企业：

```text
responsible_area_id
```

是正式业务字段。

坐标：

```text
latitude
longitude
```

只用于展示。

规则：

> 地址解析或人工移动点位，都不得自动修改 responsible_area_id。

## 4. GeoJSON

边界文件存 COS。

数据库：

```text
area_id
version
attachment_id
effective_at
status
change_note
```

激活新版本不删除旧版。

不把所有边界写死在前端 bundle。

## 5. 企业地址解析

流程：

```text
保存/修改地址
→ MapService.geocode()
→ 返回候选
→ 地图预览
→ 保存坐标
```

管理员可人工点选修正。

解析失败：

```text
企业仍可建档
→ geocode_status=FAILED
→ 进入地图待完善队列
```

## 6. 企业地图层级

### 县级

展示：

- 宝应县边界；
- 镇区/园区边界；
- 各区域企业数量；
- 县政府小红星。

不展示热力排名。

### 区域级

点击区域：

```text
同页放大
→ 企业点
→ 底部企业列表
```

不新开空二级页。

### 企业点

点击：

```text
企业名称
主营产品
联系人
拨号
导航
详情
```

## 7. 聚合

企业数量由后端聚合：

```text
GROUP BY responsible_area_id
```

不把全量企业下载手机再 `.filter()` 计数。

点位多时使用批量 Marker / 聚合，不为每个点创建沉重 React Tree。

## 8. 无坐标企业

无坐标：

- 仍出现在列表；
- 不在地图点位；
- 后台“地图待完善”可查询。

不得猜坐标。

## 9. 团员地图

含义：

> 派出单位地域分布，不是实时位置。

数据：

```text
Person
→ 当前/指定BatchMembership
→ dispatch_organization
→ 省/市/坐标
```

层级：

```text
全国
→ 省
→ 市
→ 派出单位
→ 团员
```

人数按 `person_id` 去重。

## 10. 派出单位坐标

Dispatch Organization 保存：

```text
province
city
address?
latitude
longitude
```

坐标缺失：

- 不猜；
- 保留列表；
- 管理端补齐。

## 11. 导航

智链宝不做路线规划。

统一：

```text
NavigationAdapter.navigate({
  name,
  address,
  lat,
  lng
})
```

按环境：

- iOS；
- Android；
- 微信浏览器；

尝试唤起可用地图。

失败：

> 复制地址。

## 12. Key

前端地图 Key：

- 限制合法域名；
- 仅开放需要能力。

地址解析等 WebService：

> 尽量由后端调用。

Secret 不硬编码前端。

## 13. 地图故障降级

企业：

```text
地图不可用
→ 列表继续
```

团员：

```text
地图不可用
→ 列表继续
```

地理编码：

```text
第三方失败
→ 地址先保存
→ 后台重试
```

地图永远不得阻断核心建档。

## 14. 边界变更

新 GeoJSON 激活：

- 不自动重分配企业；
- 企业负责区域以正式字段为准；
- 如果行政调整需要批量改企业归属，必须单独业务治理任务、预览、审计。

## 15. 红线

1. 不用实时GPS；
2. 不展示团员当前位置；
3. 不用坐标判断正式镇区；
4. 不做企业/镇区排名；
5. 不做热力绩效图；
6. 不因地图失败隐藏企业；
7. 不猜无坐标地址；
8. 不写死边界到前端代码；
9. 不让边界换版静默改业务数据；
10. 不自建路线规划。

**MAP_SPEC.md v1.0 END**
