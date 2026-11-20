# 陇上砚语 TAO INKSTONE

非遗洮砚的数字化体验站。核心是一间 3D 虚拟雕刻工坊：选石、识石、定纹样，
然后在随形原石上用刀真的刻出凹槽。

- 线上：https://lantinghuawuxu.github.io/tao-yan-web/
- 技术栈：React 19 + TypeScript + Vite + three.js（@react-three/fiber 9 + drei 10）
- 视觉调性：纸墨底色、宋体标题、朱砂点睛

## 快速开始

```bash
npm install
npm run dev      # 本地开发
npm run build    # 产物输出到 dist/
npx tsc --noEmit # 类型检查
```

## 部署

推送到 `main` 即自动部署，workflow 在 `.github/workflows/deploy.yml`。

`vite.config.ts` 里 `base: './'` 是必须的——GitHub Pages 是子路径托管，
写成绝对路径会导致所有静态资源 404。

> 本机网络对 GitHub HTTPS 有 TLS 干扰，推送需走 SSH over 443
> （`~/.ssh/config` 里 `HostName ssh.github.com`、`Port 443`）。

## 目录

```
src/
  components/
    Carve3D.tsx              # 3D 雕刻台：几何 + 材质 + 笔刷 + 高度图 + 遮罩
    inkstoneGeometry.ts      # 砚台/原石几何：随形轮廓、石沿、底座、雕刻面
    useGreenStoneTexture.ts  # 石料 PBR 贴图加载与兜底
    PatternRelief.tsx        # 纹样浮雕预览（与 3D 共用同一套高度图算法）
  pages/Studio.tsx           # 五步流程：选石 → 识石 → 纹样 → 雕刻 → 完成
  Studio.css
public/textures/
  patterns/*_height.png      # 纹样高度图（四款传统纹样）
  inkstone/*_color|normal|rough.jpg  # 洮河石三色 PBR 贴图
tools/bake_stone.py          # 石料贴图烘焙脚本（改石色只改这里）
```

## 3D 雕刻的几条硬约定

改这块之前请先读，这些都是踩过坑换来的：

**高度图语义**：中灰 `128` 是石面基准，**越大越深**（白=凹，黑=凸）。
笔刷一次落笔同时写入「隆起唇边 — V 形槽 — 隆起唇边」，没有唇边就只是
石面上一道暗痕，不像被凿开。

**纹样是线雕不是浮雕**：AI 生成的纹样图不能整幅当高度场，否则整面变成卵石。
必须走高通线场（局部均值 − 自身 + 阈值）只取暗线，才是阴刻刀路。

**位移走 CPU**：`material.displacementMap` 和顶点着色器注入在这块几何上
都验证无效（包围盒 y 跨度不随高度图变化）。现在在 `applyDisplacement()` 里
直接改顶点并 `computeVertexNormals()`，这是唯一确定有效的路子。

**雕刻面必须挂石料法线贴图**：只有位移没有微观法线，表面完全光滑，
环境反射像树脂板——这是「透明塑料感」的来源，不是几何问题。

**AO 方向别写反**：`mix(1.0, occlusion, k)` 在 occlusion=1 时返回 1.0，
等于遮蔽越强越亮。正确写法是 `1.0 - occlusion * k`。

**性能**：遮罩 256 而非 1024，模糊用分离式盒式（O(n)），隔帧重算 + rAF 批量上传。
1024² 逐像素邻域采样会到 3700 万次读取，直接卡死。

## 石料

三色贴图由 `tools/bake_stone.py` 从 ambientCG 的 CC0 扫描烘焙而来：

| 石色 | 源材质 | 选择依据 |
|---|---|---|
| 鹦哥绿 | Rock020 细粒板岩 | 洮河石本就是水云母质板岩，有纵向劈理 |
| 黄膘石 | Rock041 细粒粉砂岩 | 均匀致密，带天然矿物黄斑 |
| 紫石 | Rock035 细粒黑色页岩 | 致密含铁，对应羊肝红 |

色相在**构建期**烘焙，用色度向量混合：明暗结构 100% 取原扫描，
色度方向向洮河石本色拉 60~75%，剩余留给原图的冷暖杂质。
运行时 `useGreenStoneTexture` 不做任何着色——再叠一次「亮度→单色」映射
就会退回磨砂塑料。调色改脚本里的 `JOBS`，不要在前端调。

## 注意

`docs/授权文件/` 含真实签署的授权书与合作备忘录，已在 `.gitignore` 中排除。
**不要提交**，仓库是公开的。
