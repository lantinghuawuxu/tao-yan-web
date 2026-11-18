# 虚拟雕刻体验 · 第 4 步 3D 雕刻交互改进方案

> 对象：`src/components/Carve3D.tsx`（本文档简称 **Carve3D**）
> 参照：`src/components/InkstoneViewer.tsx`、`src/pages/Studio.tsx`、`src/components/useGreenStoneTexture.ts`、`src/components/useRockTextures.ts`、`src/Studio.css`
> 约束：本方案**只描述改法、不改代码**；所有改动范围均标注到文件与字段级。

---

## 0. 技术底座现状（用于统一判断）

- 渲染栈：React 19 + `@react-three/fiber` 9 + `@react-three/drei` 10 + `three` 0.186 + `three-bvh-csg` 0.0.17（已在 `package.json` 依赖中，无新增依赖负担）。
- Carve3D 当前管线：`1024×1024` 高度图（heightCanvas）→ `PlaneGeometry(2.6, 1.6, 240, 180)` → `meshPhysicalMaterial` 同时挂 `displacementMap`（`displacementScale=-0.12`）与 `bumpMap`（`bumpScale=0.45`），两者共用同一张 heightTexture。
- 笔刷：`createRadialGradient` 软高斯圆点 + `globalCompositeOperation='lighter'` 叠加白色，插值 stamp。
- 颜色反馈：独立透明 plane（`meshBasicMaterial`，`rgba(6,14,11)`，alpha 0.04~0.1）。
- 引导线：独立 plane（`guideTexture`，opacity 0.7），浮在雕刻面上方。
- 结构：4 个 box 边框 + 1 个底板，无砚堂/砚池/砚边结构。
- 工具：`chisel / fine / polish`；模式：`orbit`（旋转）/ `carve`（雕刻）。

**关键前置事实（影响多个问题的根因）**：three.js 的 `displacementMap` 在顶点着色器里用 `texture2D(...).x`（即 R 通道）做位移，**只移动顶点、不重算法线**；而 `bumpMap` 只扰动法线、不移动几何，且约定「白=凸」。这两者当前被同一张「白=凹」的高度图同时驱动，是问题 2、4 的物理根源。

---

## 1. 现状诊断

### 1.1（验证并深化 team-lead 的 6 点）

**问题 1 · 形态不像砚台：无砚堂 / 砚池 / 砚边，像「平板刮痕」**

- 技术根因：`CarveSurface` 的雕刻主体是单块 `PlaneGeometry`（`src/components/Carve3D.tsx:187`），四周 `boxGeometry` 只负责「围栏」视觉（`Carve3D.tsx:368-386`），底板是一块 0.04 厚的板（`Carve3D.tsx:384-387`）。既没有 `InkstoneViewer` 里 `ExtrudeGeometry + bevel` 生成的砚边收坡，也没有 `createShape().pools` 挖出的砚池、砚堂。
- 后果：用户看不出「这是一方砚」，下刀的参照感（砚堂在哪儿、砚池在哪儿、砚边到哪儿停）缺失，自然觉得「差点意思」。

**问题 2 · displacement 与 bump 语义矛盾，刻痕「既凹又亮」**

- 技术根因：`Carve3D.tsx:330-333` 用同一张 heightTexture 同时驱动：
  - `displacementMap` + `displacementScale=-0.12`：白色像素 → 顶点沿法线 **向下凹**（负值）。
  - `bumpMap` + `bumpScale=0.45`：白色像素 → 法线按「白=凸」扰动 → 刻痕处被当成**凸起**，产生亮边高光。
- 后果：几何在凹陷、法线却在假装凸起，两个光照信号打架，刻痕边缘出现既暗又亮的假高光，石材质感被破坏。且 `displacement` 只移顶点不重算法线（见第 0 节），凹陷处本身没有正确明暗，进一步放大「假」的感觉。

**问题 3 · 笔刷软高斯，缺「刀味」**

- 技术根因：`paint()` 里三种工具共用同一个 `createRadialGradient` 圆点（`Carve3D.tsx:223-240`），工具之间只改 `radius` 与 `alpha`（`Carve3D.tsx:218-220`），**没有截面形状差异、没有方向感知、没有速度压力、没有顿挫**。
- 补充深化（新增发现）：单笔 alpha 高达 `0.9`（chisel/fine）+ `lighter` 叠加（`Carve3D.tsx:220`），白色 R 通道一笔就逼近 255，导致「一刀到底」——位移深度被 `displacementScale` 封顶后失去深浅层次，用户无法通过走刀轻重控制刻痕深浅，刀味进一步流失（详见 1.2 问题 7）。

**问题 4 · 颜色层 alpha 过浅，刻痕反馈感弱**

- 技术根因：颜色反馈画在独立透明 plane（`Carve3D.tsx:337-349`），单次 stamp 的 alpha 只有 `polish 0.04 / chisel·fine 0.1`（`Carve3D.tsx:250`），且是 `source-over`（不累积叠加）。视觉上几乎等于「没变化」。
- 补充深化：颜色反馈弱是表象，本质是「凹陷没有法线明暗 + 颜色层又几乎透明」双重失效叠加；问题 2 修好法线后，颜色层再适度加深，反馈才会「立体感 + 石色」同时成立。

**问题 5 · 引导线独立平面，旋转时与凹槽脱节穿帮**

- 技术根因：`guideTexture` 被贴到一块**独立 plane**（`Carve3D.tsx:351-366`），浮在 `y=0.212`（雕刻面 0.21 + 0.002），`opacity 0.7`、`DoubleSide`。雕刻发生位移后，金线平面仍保持平直，与凹陷的雕刻面分离；旋转到侧后方时还会看到 `DoubleSide` 的反面线。
- 补充深化（新增发现）：引导线纹理的坐标空间与雕刻 UV 空间**不一致**（见 1.2 问题 8），即使贴到同一个几何上，线也会和实际下刀位置错位。

**问题 6 · 未复用 InkstoneViewer 参数化器型，3D 雕刻台永远「随形平板」**

- 技术根因：`InkstoneViewer` 已经把「器型生成」做到位——`createShape(shape)`（5 种砚式）+ `createGroovedBody()`（`ExtrudeGeometry + CSG 刻槽`）都在 `InkstoneViewer.tsx:82-343`，但 Carve3D 完全没有引用，独立写了一套「平板 + 围栏」。
- 后果：第 3 步预览选的是「随形砚台」，进入第 4 步 3D 雕刻却是一块平板，产品叙事断裂。

### 1.2（team-lead 未提、我新发现的问题）

**问题 7 · `lighter` 无限叠加 + 单笔 alpha 过高，缺「轻重深浅」**

- 技术根因：`Carve3D.tsx:261` 高度层用 `globalCompositeOperation='lighter'`，叠加的是 R 通道（`displacementMap` 只读 `.x`），单笔 chisel/fine `alpha=0.9`（`Carve3D.tsx:220`），白色 R 值一笔就 ≈ 0.9×255=229，几乎直接顶到 `displacementScale` 上限。刻痕「一次成型、再划无变化」，没有「轻刀浅、重刀深、反复走刀加深」的层次。
- 这是「刀味缺失」的更深层原因，与问题 3 同源但独立成条。

**问题 8 · 引导线坐标空间与雕刻 UV 不一致，金线与刻痕错位**

- 技术根因：`createGuideTexture()` 用 `scaleX = CANVAS_SIZE/2.8、scaleY = CANVAS_SIZE/1.8`（`Carve3D.tsx:48-49`）把纹样画进一个 2.8×1.8 的世界坐标系，再贴到 2.6×1.6 的 plane 上；而雕刻笔刷的 `uv.x * CANVAS_SIZE`（`Carve3D.tsx:215-216`）是直接按 plane 的 `[0,1]` UV 映射全平面。两者经过了不同的比例/偏移变换，引导线和实际下刀位置天然错位，且纹样范围（内缩的 2.2×1.2）与砚堂轮廓脱钩。

**问题 9 · `patternScale` / `showGuide` 未传入 Carve3D，第 3 步的选择在 3D 里失效**

- 技术根因：`Studio.tsx:1146-1151` 调 `<Carve3D>` 只传了 `tool / brushSize / pattern / orbit` 四个 props；`patternScale`（纹样缩放，Studio.tsx:282）和 `showGuide`（辅助线开关，Studio.tsx:286）**没有传**。`Carve3D` 的 `createGuideTexture` 用固定尺寸绘制，guide 层恒显示。
- 后果：用户在第 3 步调了纹样大小 130%、或关掉辅助线，进 3D 后这些操作全部不生效，功能一致性破坏。

**问题 10 · 3D 模式无撤销 / 擦除，只有「整面重置」**

- 技术根因：2D 模式有 `historyRef` + `undo`（`Studio.tsx:297, 480-486`），3D 模式只有 `setCarve3DKey(k=>k+1)` 重挂载整面（`Studio.tsx:1099-1104`），每次重置还要重新建 canvas、texture、geometry。
- 后果：3D 里刻错一笔只能全部推倒重来，且重置成本高（重建 1024 纹理 + 43k 顶点几何），体验与 2D 明显不对称。

**问题 11 · 每帧 pointerMove 全量上传 1024 纹理，无脏矩形 / 节流**

- 技术根因：`paint()` 每次 `pointerMove` 都 `heightTextureRef.current.needsUpdate = true` + `colorTextureRef.current.needsUpdate = true`（`Carve3D.tsx:286-287`），触发**整张 1024×1024** CanvasTexture 重新上传 GPU，而不是局部更新。
- 后果：高频移动下（尤其触屏），每帧上传 4MB 像素数据，容易掉帧、发烫；且未用 rAF 合并多次 pointer 事件，重复计算。

**问题 12 · 3D 雕刻成果无法保存/导出，与 2D 完成逻辑断裂**

- 技术根因：`finish()`（`Studio.tsx:553-602`）只从 2D 的 `canvasRef` 合成作品图；3D 模式明确写着「3D 刻面为交互预览，切回 2D 完成作品」（`Studio.tsx:1197-1199`）。
- 后果：用户在 3D 里刻出的成果带不走，产品闭环断裂，也让「3D 雕刻」沦为纯玩具。

**问题 13 · 多层透明 plane 无 `renderOrder`，渲染顺序 / 背面穿帮风险**

- 技术根因：color plane（`Carve3D.tsx:337-349`）与 guide plane（`Carve3D.tsx:351-366`）都 `depthWrite={false}`、`DoubleSide`，叠在雕刻面之上仅靠 0.001 的 y 差排序；透明物体在 three 里按 `renderOrder` + 相机距离排序，近距离观察时可能出现颜色层跑到金线之上/之下、或背面线可见的抖动。
- 后果：视觉瑕疵、Z 抖动。

**问题 14 · 无障碍缺口：3D 画布无语义标签、无键盘操作**

- 技术根因：`Canvas` 生成的是裸 `<canvas>`，没有 `role` / `aria-label`；雕刻依赖 pointer，无键盘可达路径（2D 画布有 `aria-label`，`Studio.tsx:1125`；3D 没有）。
- 后果：屏幕阅读器用户无法理解/操作 3D 雕刻，未达到本站其他区域的无障碍水准（属 P2，Demo 阶段可缓）。

---

## 2. 改进方案

> 方案按「一条问题 → 一组改法」组织；其中问题 1 与 6、问题 2 与 4 与 7 相互交织，改法会合并叙述并标注。

### 2.1 复用参数化器型，让 3D 雕刻台「像一方砚」（问题 1 + 6）

**改法概述**
把 `InkstoneViewer.tsx` 里的器型生成函数抽成共享模块，让 Carve3D 用真实砚台几何做底座，雕刻面只覆盖「砚堂」可雕区，砚池/砚边用真实几何呈现。

**技术选型 / 依赖**
无新依赖。抽取 + 复用现有 `three` / `three-bvh-csg` 能力。

**涉及文件与改动范围**
- 新建 `src/components/inkstoneGeometry.ts`：
  从 `InkstoneViewer.tsx:24-343` 平移（原样搬，不改逻辑）：
  `roundedRect`、`ellipse`、`freeform`、`createShape`、`reverseShape`、`patternPolylines`、`mergeBoxes`、`createGrooveGeometry`、`createGroovedBody`，以及常量 `THICKNESS / POOL_FLOOR / BODY_TOP / GROOVE_WIDTH / GROOVE_HEIGHT / evaluator`。
  导出 `createShape`、`createGroovedBody`、`patternPolylines`，并新增一个轻量导出 `createRimBody(shape)`：只做「砚边 + 砚壁」（`createShape(shape).outer` 挖掉 pools 后 `ExtrudeGeometry` 薄壁），供 Carve3D 使用（见下）。
- `src/components/InkstoneViewer.tsx`：删除上述被平移的函数与常量，改为 `import { createShape, createGroovedBody } from './inkstoneGeometry'`；其余渲染逻辑不变。
- `src/components/Carve3D.tsx`：`CarveSurface` 增加 `shape: InkstoneShape` prop（默认 `'随形'`，由 Studio 传入当前砚式）。渲染结构改为：
  - **砚边/砚壁**：`createRimBody(shape)` 生成的真实几何，替代 `Carve3D.tsx:368-386` 的 4 个 box。
  - **砚池片**：`createShape(shape).pools` 用 `ShapeGeometry` 深色片（复用 `InkstoneViewer.tsx:387-402` 的池片写法，`POOL_FLOOR` 高度、`#1d2924`）。
  - **砚堂雕刻面**：保留当前细分 `PlaneGeometry`，但把尺寸缩小为砚堂区域（`outer` 内缩、pools 之外的矩形/随形范围），`position` 对齐 `BODY_TOP`。这是「可雕刻区」，继续挂 displacement（见 2.2）。
- `src/pages/Studio.tsx`：第 3 步已选择器型的能力若存在则传入；若当前只固定 `shape="随形"`（`Studio.tsx:1015` 预览处），则第 4 步 3D 也固定 `"随形"` 保持一致即可，不必新增器型选择 UI（器型选择属后续产品需求）。

**预期效果**
3D 雕刻台立刻有砚边收坡、砚池凹陷、砚堂平面三层结构，视觉上「是一方砚」，下刀区域语义清晰。

---

### 2.2 修掉 displacement/bump 语义矛盾，让凹槽有真实明暗（问题 2 + 4 + 7 的核心）

**改法概述**
分两步：**第一步（立即）** 移除 `bumpMap`；**第二步（中期）** 把「shader 位移」升级为「CPU 写入顶点 + 重算法线」，让凹陷真正影响光照。

**技术选型 / 依赖**
无新依赖。用 `geometry.attributes.position` 直接改 Y 值 + `geometry.computeVertexNormals()`。

**涉及文件与改动范围**
- 第一步（`src/components/Carve3D.tsx`）：
  - 删除 `bumpMap={heightTexture}` 与 `bumpScale={0.45}`（`Carve3D.tsx:332-333` 两行）。
  - `displacementScale` 由 `-0.12` 调整为 `-0.08`（与砚堂厚度、笔画深度比例匹配，避免过深穿透）。
- 第二步（`src/components/Carve3D.tsx` 的 `paint` 流程重构）：
  - 不再依赖 `displacementMap` 的 shader 位移；改为在 `paint()` 每次 stamp 后，用 `heightCanvas.getImageData` 读取局部高度，直接写进 `geometry.attributes.position` 的 Z→Y（注意 plane 已 `rotateX(-PI/2)`，法线朝 +Y，凹=Y 减小）。
  - 写完后对脏区域顶点 `geometry.computeVertexNormals()`（可先全量，量级见 3.1）。
  - `meshPhysicalMaterial` 去掉 `displacementMap / displacementScale`（`Carve3D.tsx:330-331`），保留 `map / normalMap / roughnessMap`。
- 与 2.1 联动：雕刻面顶点网格足够密（240×180≈4.3 万顶点）才能表达刀痕，维持现细分数即可；若缩小到砚堂区域，仍保持每边 ≥ 128 段。

**预期效果**
凹槽处顶点真实下沉、法线真实倾斜，出现自然的「背光面暗 / 迎光面亮」的刀槽明暗，假高光消失；配合 2.4 的深度分层，能刻出有深浅层次的 V/U 槽。

> 说明：第一步可单独上线（先消除「既凹又亮」），第二步是「真实几何雕刻」的地基，也为问题 12 的导出提供几何依据。

---

### 2.3 笔刷「刀味」：截面化 + 方向感知 + 速度压力 + 顿挫（问题 3 + 7）

**改法概述**
把「一个高斯圆点」替换为「按工具分形的 stamp 函数」，并让 stamp 随走刀方向与速度变化。

**技术选型 / 依赖**
无新依赖，纯 Canvas 2D 绘制逻辑改写。

**涉及文件与改动范围**
`src/components/Carve3D.tsx` 的 `paint()` / `stamp()`（`Carve3D.tsx:210-288`）重构：

1. **工具截面形状**（替换 `createRadialGradient` 单一路径）：
   - `chisel`（刻刀/宽刃）：楔形 V 槽。用**线性渐变**（垂直于刀口方向，从中心向两侧快速衰减到 0），中心 alpha 高、两侧陡降，形成「刀口」；半径系数保持 1。
   - `fine`（细刻）：窄 U 槽。硬边径向渐变（`addColorStop(0, a)`、`addColorStop(0.55, a)`、`addColorStop(1, 0)` 的近硬边），半径系数 0.5（保留现逻辑）。
   - `polish`（打磨）：软高斯，但改为「抹平/柔化」——低 alpha 叠加或 `destination-out` 减淡边缘，半径系数 1.6（保留现逻辑）。
2. **方向感知拉伸**：stamp 前用 `ctx.setTransform`/`translate+rotate+scale`，把笔刷椭圆的长轴对齐**刀口方向**（`lastUvRef` → 当前 uv 的向量），让刻痕是一条「有方向的刀痕」而非一串圆点。
3. **速度压力**：`paint()` 内用 `distance`（`Carve3D.tsx:270` 已有）反比调制 alpha 与半径——移动快 → alpha×0.6、半径×0.85（轻刀浅）；移动慢 → alpha×1.15（重刀深）。
4. **顿挫**：对 `chisel / fine`，在插值 stamp 的每一步加入 `(Math.random()-0.5) * radius * 0.15` 的位移抖动（参照 2D 的 `carveSegment` 里 `Studio.tsx:423-425` 的已有手法，保证 2D/3D 手感一致）。
5. **深度分层（配合 2.2）**：把单笔 alpha 从 `0.9` 降到 `chisel 0.28 / fine 0.4 / polish 0.12`（`Carve3D.tsx:220`），让「多次走刀才加深」成立；`lighter` 保留（R 通道封顶 255 天然防穿透），深度上限交给 2.2 的 CPU 位移钳制。

**预期效果**
刻痕有锐利刀口、有方向、有轻重顿挫，接近「刀刻」而非「橡皮擦」。

---

### 2.4 颜色反馈强化（问题 4）

**改法概述**
提高颜色层 alpha，并把颜色层改为「单层、带 renderOrder、随几何贴合」。

**涉及文件与改动范围**
`src/components/Carve3D.tsx`：
- `colorAlpha`（`Carve3D.tsx:250`）由 `polish 0.04 / chisel·fine 0.1` 提升为 `polish 0.12 / fine 0.32 / chisel 0.42`；颜色由 `rgba(6,14,11)` 微调为更深 `rgba(4,11,8)`（露出更深的石色）。
- color plane（`Carve3D.tsx:337-349`）增加 `renderOrder={1}`，去掉 `DoubleSide` 改为 `FrontSide`（背面无需显示），`depthWrite={false}` 保留。
- 若采纳 2.2 第二步，颜色层可进一步与「法线明暗」叠加——保留独立 color plane 即可，不必强改。

**预期效果**
刻痕的「深色石底」明显可见，配合 2.2 的明暗形成「刻下去、露深色」的完整反馈。

---

### 2.5 引导线「贴到几何上」+ 统一坐标空间（问题 5 + 8 + 9）

**改法概述**
引导线不再用独立 plane，改为 `meshPhysicalMaterial.emissiveMap`（自发光贴图），贴在雕刻几何上，随位移一起变形；同时把 guide 的绘制坐标与雕刻 UV 对齐，并接收 `patternScale` / `showGuide`。

**技术选型 / 依赖**
无新依赖。用 `MeshPhysicalMaterial.emissiveMap` + `emissiveIntensity`（现成 API）。

**涉及文件与改动范围**
- `src/components/Carve3D.tsx`：
  - 删除独立 guide plane（`Carve3D.tsx:351-366` 整段）。
  - 主材质（`Carve3D.tsx:320-334`）增加：`emissive={new THREE.Color('#c7a86b')}`（或 white）、`emissiveMap={guideTexture}`、`emissiveIntensity={showGuide ? 0.9 : 0}`。
  - `createGuideTexture(pattern, patternScale)` 改为：`scaleX = CANVAS_SIZE / GUIDE_WIDTH、scaleY = CANVAS_SIZE / GUIDE_HEIGHT`（对齐 plane UV，替换 `Carve3D.tsx:48-49` 的 2.8/1.8），并把纹样范围参数用 `patternScale` 乘进坐标（等价于第 3 步的缩放）。
  - 纹样轮廓改用 `patternPolylines`（问题 1 抽取出的模块）生成，替代 `Carve3D.tsx:63-124` 硬编码的圆角矩形+花瓣/云/波/回纹，让引导线贴合真实砚堂轮廓。
  - `CarveSurface` 与 `Carve3D` 签名新增 `patternScale: number`、`showGuide: boolean` 两个 props。
- `src/pages/Studio.tsx`：`<Carve3D>` 调用处（`Studio.tsx:1146-1151`）补传 `patternScale={patternScale}`、`showGuide={showGuide}`。

**预期效果**
金线贴在石面上、随凹槽凹陷，旋转不再浮空/背面穿帮；纹样大小与开关在 3D 里与 2D、第 3 步预览完全一致。

---

### 2.6 3D 撤销/擦除（问题 10）

**改法概述**
给 3D 加「笔刷级」撤销栈，避免整面重置。

**技术选型 / 依赖**
无新依赖。用 `ImageData` 快照或「笔画命令」重放。

**涉及文件与改动范围**
- `src/components/Carve3D.tsx`：新增 `historyRef: { height: ImageData; color: ImageData }[]`，在 `onPointerDown`（`Carve3D.tsx:297-303`）压入当前 `heightCanvas`/`colorCanvas` 的 `getImageData` 快照（限制深度 8~12 步，超出 shift）。新增 `undo()` 通过 `forwardRef`/`useImperativeHandle` 暴露给父级。
- `src/pages/Studio.tsx`：3D 模式的 `tool-actions`（`Studio.tsx:1089-1105`）把「重置 3D 刻面」改为「撤销」+「清除」两个按钮；「清除」仍走 `setCarve3DKey` 重挂载（低频、语义清晰），「撤销」走 ref 调 `undo()`。
- 性能兜底：快照用 512×512（半分辨率）存储，恢复时缩放回 1024，进一步控制内存（见 4.1）。

**预期效果**
3D 与 2D 一样支持撤销，刻错可回退，不再只能推倒重来。

---

### 2.7 性能：脏矩形上传 + rAF 合并（问题 11）

**改法概述**
pointerMove 事件合并到 rAF，纹理只上传被笔刷覆盖的脏区域。

**技术选型 / 依赖**
无新依赖。用 `requestAnimationFrame` 节流 + `texture.update()`（three 支持 `Texture.update()` 重传当前 source）或 `renderer.copyTextureToTexture`。

**涉及文件与改动范围**
- `src/components/Carve3D.tsx`：
  - `paint()` 里把 `pointerMove` 收集到的 uv 序列暂存，`useEffect` 挂一个 rAF 循环统一 flush（每帧最多执行一次 stamp 批）。
  - 用 `heightTexture.update()` 替代整张 `needsUpdate=true`（`Carve3D.tsx:286-287`）；若需严格脏矩形，可用 `texture.source.data` 局部 `canvas.putImageData` 后 `texture.update()`（three 0.186 的 `CanvasTexture.update()` 会重传整张，脏矩形收益主要来自**减少调用次数**而非单次传输——故「rAF 合并 + 降低 stamp 批频率」是主要手段）。
  - 2.2 第二步的 CPU 位移也同步做「只重算脏矩形内顶点法线」。

**预期效果**
移动端连续走刀不卡顿，帧率稳定在可接受区间。

---

### 2.8 3D 成果导出（问题 12）

**改法概述**
3D 模式也提供「完成作品」，截图当前 3D 画布合成到作品图。

**技术选型 / 依赖**
无新依赖。`Canvas` 的 `gl.domElement.toDataURL('image/png')` + `PreserveDrawingBuffer` 或渲染回调截图。

**涉及文件与改动范围**
- `src/components/Carve3D.tsx`：`Canvas` 增加 `gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }}`（`Carve3D.tsx:408`），暴露 `capture(): string`（`gl.domElement.toDataURL`）。
- `src/pages/Studio.tsx`：3D 模式的 `finish`（`Studio.tsx:553`）分支——当 `carveMode === '3d'` 时，调用 `capture()` 得到 PNG，复用 2D 的落款/边框合成（`Studio.tsx:563-595` 的 `drawCover` + 落款逻辑），产出作品图。footer 处（`Studio.tsx:1188-1200`）把「3D 刻面为交互预览」的文案改为可完成。

**预期效果**
3D 雕刻的成果能保存，产品闭环闭合。

---

### 2.9 渲染顺序 / 背面修正（问题 13）

**改法概述**
减少透明层、显式 renderOrder、单面渲染。

**涉及文件与改动范围**
`src/components/Carve3D.tsx`：
- 采纳 2.5 后 guide 已并入材质，透明层只剩 color plane：设 `renderOrder={1}`、`side={THREE.FrontSide}`（替换 `Carve3D.tsx:347` 的 `DoubleSide`）。
- 主雕刻面（`Carve3D.tsx:292-319`）设 `renderOrder={0}`。

**预期效果**
消除透明层排序抖动与背面穿帮。

---

### 2.10 无障碍（问题 14）

**改法概述**
给 3D 画布加语义标签；键盘撤销快捷键（低成本）。

**涉及文件与改动范围**
- `src/components/Carve3D.tsx`：`Canvas` 增加 `role="img"` 与 `aria-label="虚拟 3D 雕刻台：按住鼠标或手指拖动雕刻，可切换旋转视角"`（three `Canvas` 支持透传 `aria-*` 到内部 canvas，或用外层 div 包裹）。
- `src/pages/Studio.tsx`：为「撤销/清除/重置」按钮保留可见文本（已具备），补充 `title` 提示；键盘用户至少能通过按钮完成撤销与清除。

**预期效果**
屏幕阅读器能识别 3D 雕刻区；键盘可达基本操作。

---

## 3. 优先级与工作量

> 工作量单位：**小** ≈ 0.5~1 人日；**中** ≈ 1~2 人日；**大** ≈ 2~4 人日。理由随条标注。

| 优先级 | 内容 | 工作量 | 理由 |
| --- | --- | --- | --- |
| **P0-1** | 2.2 第一步：删 `bumpMap`/`bumpScale`、调 `displacementScale`（问题 2） | 小 | 2 行删除 + 1 个数值，收益最大（立刻消除「既凹又亮」），零风险 |
| **P0-2** | 2.4：颜色层 alpha 提升 + renderOrder（问题 4、13） | 小 | 改 3~4 个常量，反馈感立竿见影 |
| **P0-3** | 2.3：笔刷截面化 + 方向 + 速度 + 顿挫 + 降 alpha（问题 3、7） | 中 | 直接命中「刀味」主诉，是「差点意思」的核心解法，但需重写 `paint` |
| **P0-4** | 2.5：引导线贴几何 + 坐标对齐 + 传 `patternScale`/`showGuide`（问题 5、8、9） | 中 | 消除穿帮 + 修功能不一致，视觉/一致性双收益 |
| **P1-1** | 2.1：抽取 `inkstoneGeometry` + Carve3D 复用器型（问题 1、6） | 大 | 涉及跨文件抽取 + 渲染结构改造，收益大但改动面广，排在「先修材质交互」之后 |
| **P1-2** | 2.2 第二步：CPU 位移 + 重算法线（问题 2 深化） | 大 | 「真实几何雕刻」地基，性能/正确性收益高，但需重构顶点写入与脏区重算 |
| **P1-3** | 2.6：3D 撤销/擦除（问题 10） | 中 | 依赖 P0-3 的 paint 结构稳定后接快照更顺 |
| **P1-4** | 2.7：rAF 合并 + 纹理更新优化（问题 11） | 中 | 移动端流畅度，应在 P1 几何改造后统一做 |
| **P2-1** | 2.8：3D 成果导出（问题 12） | 中 | 产品闭环，但依赖 P1-2 几何稳定后截图才更有意义 |
| **P2-2** | 2.10：无障碍语义标签（问题 14） | 小 | 低成本，可在任意批次顺手补 |

**排序总原则**：先修「材质/交互层」的语义与反馈（P0，全是 `Carve3D.tsx` 内的小/中改动、零新依赖、可独立验证），再做「几何/器型层」的重构（P1，跨文件、需回归 InkstoneViewer），最后做「产品闭环 + 无障碍」收尾（P2）。

---

## 4. 风险与回退

### 4.1 性能风险（最大风险点）

- **风险**：2.2 第二步「CPU 写入 4.3 万顶点 + computeVertexNormals」在低端手机/高频 pointerMove 下可能掉帧；`getImageData`/`putImageData` 全量读取 1024 纹理也偏重。
- **缓解**：rAF 合并（2.7）先落地；法线只重算脏矩形；快照降为 512 分辨率（2.6）；必要时把雕刻面细分从 240×180 降到 160×120 并保持观感。
- **回退**：若 CPU 位移仍不稳，**回退到 2.2 第一步**（删 bump + 保留 shader displacement）——这是「无假高光 + 有凹槽」的可接受中间态，代价是凹陷明暗略平，但不影响主功能。

### 4.2 兼容性风险

- **风险**：`emissiveMap`（2.5）与 `CanvasTexture.update()`（2.7）在 three 0.186 / WebGL2 均稳定，但 `preserveDrawingBuffer: true`（2.8）会轻微增加内存、且 Safari 上 `toDataURL` 需在渲染后同一帧调用。
- **缓解**：`preserveDrawingBuffer` 仅在需要导出时开启（或导出时临时渲染一次再截图）；`emissiveMap` 的 `colorSpace` 设为 `SRGBColorSpace`（现 guide 已设，保持）。
- **回退**：导出方案若 Safari 不稳定，回退为「引导用户切回 2D 完成」（现状），不影响雕刻主体验。

### 4.3 依赖引入风险

- **现状**：本方案**零新增第三方依赖**，全部复用 `three` / `three-bvh-csg` / Canvas 2D 现成能力。
- **唯一跨文件重构**是 2.1 的「抽取 `inkstoneGeometry.ts`」，风险在**回归**而非技术：InkstoneViewer 现有 5 种器型必须逐一视觉回归。**回退**：若抽取导致 InkstoneViewer 回归成本过高，可先在 `Carve3D.tsx` 内复制一份 `createShape`（接受短暂重复，后续再统一），把「重构」降级为「复制」，风险隔离。

### 4.4 视觉一致性风险

- **风险**：2.1 让 3D 雕刻台器型与第 3 步预览器型出现「选择器型不一致」（当前第 3 步预览固定 `"随形"`）。需确认第 4 步 3D 与第 3 步预览用同一 `shape`，否则叙事仍断裂。
- **缓解**：本方案默认两者都固定 `"随形"`（与现状一致），不引入器型选择 UI，避免扩大范围；器型选择作为后续产品需求另行立项。

---

## 5. 分阶段实施建议（最小可落地路径）

> 原则：**每批都可独立合入、独立验证、可随时停下不烂尾**。以下按批次给出「做什么 + 验证什么」。

### 阶段 A · 材质与反馈修复（1~2 天，纯 `Carve3D.tsx`）
1. 删 `bumpMap`/`bumpScale`，`displacementScale` 调 `-0.08`（P0-1）。
2. 颜色层 alpha 提升 + `renderOrder` + `FrontSide`（P0-4、2.9）。
3. **验证**：`npm run dev` 打开 `Studio` 走到第 4 步 3D 模式，刻几刀——确认①凹槽不再「既凹又亮」；②刻痕深色可见；③旋转无背面穿帮。

### 阶段 B · 笔刷刀味 + 引导线（2~3 天）
4. 重写 `paint`/`stamp`：截面化 + 方向 + 速度 + 顿挫 + 降 alpha（P0-3）。
5. 引导线改 `emissiveMap` 贴几何 + 坐标对齐 + 传 `patternScale`/`showGuide`（P0-4）。
6. **验证**：三种工具手感区分明显；`fine` 细、`chisel` 有刀口；轻刀浅/重刀深；金线随凹槽下沉、旋转不浮空；第 3 步调缩放/开关在 3D 里生效。

### 阶段 C · 器型复用 + 真实几何（2~4 天）
7. 抽取 `inkstoneGeometry.ts`，InkstoneViewer 回归（P1-1）。
8. Carve3D 用砚边/砚池/砚堂三件套替换「平板 + 围栏」（P1-1）。
9. 若时间允许，升级为 CPU 位移 + 重算法线（P1-2）。
10. **验证**：第 3 步 5 种器型预览不回归；3D 雕刻台「是一方砚」；凹槽有真实明暗（若做了 9）。

### 阶段 D · 体验与产品收尾（1~2 天）
11. 3D 撤销/清除（P1-3）。
12. rAF 合并 + 纹理更新优化（P1-4）。
13. 3D 成果导出（P2-1）+ 无障碍标签（P2-2）。
14. **验证**：移动端连续走刀不卡；刻错可撤销；3D 作品可保存；读屏可识别雕刻区。

### 建议的最小 MVP 边界
若资源极度紧张，**只做阶段 A + B**，即可覆盖用户「3D 雕刻还差点意思」的核心诉求（刀味 + 反馈 + 不穿帮），形态「不像砚台」（P1-1）作为下一个增量单独交付。

---

## 附：改动文件清单总览

| 文件 | 改动类型 | 涉及问题 |
| --- | --- | --- |
| `src/components/Carve3D.tsx` | 重点修改（材质、笔刷、引导线、几何、导出、无障碍） | 1/2/3/4/5/6/7/8/9/10/11/12/13/14 |
| `src/components/inkstoneGeometry.ts` | **新建**（从 InkstoneViewer 抽取） | 1/6 |
| `src/components/InkstoneViewer.tsx` | 抽取后 import 改造（逻辑不变） | 1/6 |
| `src/pages/Studio.tsx` | 补传 props、3D 撤销/导出按钮、finish 分支 | 9/10/12/14 |
| `src/Studio.css` | 可选微调（3D 模式按钮/提示文案） | 10/12 |
| `package.json` | **无新增依赖** | — |
