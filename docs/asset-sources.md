# 外部素材来源

记录 Demo 中使用的外部图片、纹理、模型及其许可证。新增素材必须在这里登记。

## Poly Haven · Rock 05

- 用途：原石 3D 模型表面纹理
- 来源页：https://polyhaven.com/a/rock_05
- 作者：Rob Tuytel
- 许可证：CC0（公共领域）
- 本地文件：
  - `public/textures/stone/rock_05_diff_1k.jpg`
  - `public/textures/stone/rock_05_nor_gl_1k.jpg`
  - `public/textures/stone/rock_05_rough_1k.jpg`
- 原始文件：Poly Haven 1K JPG
- 修改：在 Three.js 材质中做绿色调、3×3 重复，用于程序化原石
- 下载日期：2026-11-03

CC0 不要求署名；这里保留记录，便于后续替换和审计。

## 项目原创 · 成品砚参数化模型

- 用途：砚式图谱页的 3D 器型预览
- 器型：随形、长方、椭圆、圆形、双池
- 实现：`src/components/InkstoneViewer.tsx`，Three.js `Shape + ExtrudeGeometry` 参数化生成
- 外部模型/贴图：无
- 说明：这是器型示意，不是实物扫描；正式器型需由传承人/馆方审校

## 项目原创 · 纹样叠加

- 纹样：莲纹、云纹、水波、回纹
- 实现：`src/components/InkstoneViewer.tsx` 中用 Canvas 2D 生成金色线稿，并从线稿生成法线贴图，模拟刻痕起伏
- 外部素材：无
- 说明：纹样为叠加 + 法线示意，不是实际雕刻；正式纹样需由传承人/馆方审校

## 待补充

- 真实洮砚照片/摄影测量：必须取得馆方或传承人书面授权
- 不使用来源不明的电商图、社交媒体图作为素材或训练数据
