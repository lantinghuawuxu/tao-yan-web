# 外部素材来源

记录 Demo 中使用的外部图片、纹理、模型及其许可证。新增素材必须在这里登记。

## Poly Haven · Boulder 01

- 用途：首页原石 3D 交互
- 来源页：https://polyhaven.com/a/boulder_01
- 作者：Rico Cilliers
- 许可证：CC0（公共领域）
- 本地文件：
  - `public/models/boulder_01/boulder_01_1k.gltf`
  - `public/models/boulder_01/boulder_01.bin`
  - `public/models/boulder_01/textures/boulder_01_diff_1k.jpg`
  - `public/models/boulder_01/textures/boulder_01_nor_gl_1k.jpg`
  - `public/models/boulder_01/textures/boulder_01_arm_1k.jpg`
- 修改：缩放、置底、绿色调、粗糙度调整
- 下载日期：2026-11-03

CC0 不要求署名；这里保留记录，便于后续替换和审计。

## Poly Haven · Rock 05（旧版备用）

- 用途：早期原石纹理实验，当前页面未使用
- 来源页：https://polyhaven.com/a/rock_05
- 作者：Rob Tuytel
- 许可证：CC0
- 本地文件：`public/textures/stone/rock_05_*_1k.jpg`

## 项目原创 · 成品砚参数化模型

- 用途：砚式图谱页的 3D 器型预览
- 器型：随形、长方、椭圆、圆形、双池
- 实现：`src/components/InkstoneViewer.tsx`，Three.js `Shape + ExtrudeGeometry` 参数化生成
- 外部模型：无
- 说明：器型为参数化示意，不是实物扫描；正式器型需由传承人/馆方审校

## 项目原创 · 纹样几何刻槽

- 纹样：莲纹、云纹、水波、回纹
- 实现：把纹样转成 2D 折线，生成细长盒体，再用 `three-bvh-csg` 从砚台实体中做布尔减法；刻槽是真实几何，不是贴图
- 外部素材：无
- 说明：正式纹样需由传承人/馆方审校

## 项目原创 · 3D 雕刻台

- 实现：`src/components/Carve3D.tsx`，运行时 Canvas 高度图驱动 `displacementMap + bumpMap`，拖动指针产生真实几何凹槽
- 外部素材：无
- 说明：3D 刻面为交互预览，完成作品仍走 2D 流程

## 待补充

- 真实洮砚照片/摄影测量：必须取得馆方或传承人书面授权
- 不使用来源不明的电商图、社交媒体图作为素材或训练数据
