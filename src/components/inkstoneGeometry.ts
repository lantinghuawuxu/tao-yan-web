import * as THREE from 'three'
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg'

export type InkstoneShape = '随形' | '长方' | '椭圆' | '圆形' | '双池'
export type InkstonePattern = 'lotus' | 'cloud' | 'wave' | 'meander'

export const THICKNESS = 0.24
export const POOL_FLOOR = -THICKNESS + 0.035
export const BODY_TOP = 0.025
const GROOVE_WIDTH = 0.022
const GROOVE_HEIGHT = 0.034
const evaluator = new Evaluator()

function roundedRect(
  width: number,
  height: number,
  radius: number,
  cx = 0,
  cy = 0,
) {
  const x = cx - width / 2
  const y = cy - height / 2
  const r = Math.min(radius, width / 2, height / 2)
  const shape = new THREE.Shape()

  shape.moveTo(x + r, y)
  shape.lineTo(x + width - r, y)
  shape.quadraticCurveTo(x + width, y, x + width, y + r)
  shape.lineTo(x + width, y + height - r)
  shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  shape.lineTo(x + r, y + height)
  shape.quadraticCurveTo(x, y + height, x, y + height - r)
  shape.lineTo(x, y + r)
  shape.quadraticCurveTo(x, y, x + r, y)

  return shape
}

function ellipse(
  rx: number,
  ry: number,
  cx = 0,
  cy = 0,
  clockwise = false,
) {
  const shape = new THREE.Shape()
  shape.absellipse(cx, cy, rx, ry, 0, Math.PI * 2, clockwise, 0)
  return shape
}

function freeform(scale = 1) {
  const points: THREE.Vector2[] = []
  const segments = 72

  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2
    const radius =
      1 +
      Math.sin(angle * 3 + 0.8) * 0.08 +
      Math.cos(angle * 5 - 0.4) * 0.05
    points.push(
      new THREE.Vector2(
        Math.cos(angle) * radius * 1.15 * scale,
        Math.sin(angle) * radius * 0.78 * scale,
      ),
    )
  }

  return new THREE.Shape(points)
}

export function createShape(shape: InkstoneShape) {
  if (shape === '长方') {
    return {
      outer: roundedRect(2.3, 1.5, 0.18),
      pools: [roundedRect(1.4, 0.66, 0.16)],
    }
  }

  if (shape === '椭圆') {
    return {
      outer: ellipse(1.3, 0.88),
      pools: [ellipse(0.72, 0.42)],
    }
  }

  if (shape === '圆形') {
    return {
      outer: ellipse(1.05, 1.05),
      pools: [ellipse(0.55, 0.55)],
    }
  }

  if (shape === '双池') {
    return {
      outer: roundedRect(2.4, 1.5, 0.2),
      pools: [
        ellipse(0.5, 0.38, -0.48, 0),
        ellipse(0.28, 0.2, 0.72, 0),
      ],
    }
  }

  return {
    outer: freeform(1),
    pools: [freeform(0.62)],
  }
}

function reverseShape(shape: THREE.Shape) {
  return new THREE.Shape(shape.getPoints(64).reverse())
}

export function patternPolylines(
  shape: InkstoneShape,
  pattern: InkstonePattern,
) {
  const { outer } = createShape(shape)
  const lines: THREE.Vector2[][] = []

  for (const scale of [0.86, 0.79]) {
    const ring = outer.getPoints(48).map((point) => point.clone().multiplyScalar(scale))
    ring.push(ring[0].clone())
    lines.push(ring)
  }

  if (pattern === 'lotus') {
    for (let i = 0; i < 10; i += 1) {
      const angle = (i / 10) * Math.PI * 2
      const center = new THREE.Vector2(
        Math.cos(angle) * 0.92,
        Math.sin(angle) * 0.62,
      )
      const direction = new THREE.Vector2(Math.cos(angle), Math.sin(angle))
      const side = new THREE.Vector2(-Math.sin(angle), Math.cos(angle))
      const petal: THREE.Vector2[] = []
      for (let step = 0; step <= 8; step += 1) {
        const t = step / 8
        petal.push(
          center
            .clone()
            .addScaledVector(direction, -0.08 + 0.2 * t)
            .addScaledVector(side, Math.sin(Math.PI * t) * 0.05),
        )
      }
      for (let step = 7; step >= 0; step -= 1) {
        const t = step / 8
        petal.push(
          center
            .clone()
            .addScaledVector(direction, -0.08 + 0.2 * t)
            .addScaledVector(side, -Math.sin(Math.PI * t) * 0.05),
        )
      }
      lines.push(petal)
    }
    return lines
  }

  if (pattern === 'cloud') {
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2
      const centerX = Math.cos(angle) * 0.92
      const centerY = Math.sin(angle) * 0.62
      const arc: THREE.Vector2[] = []
      for (let step = 0; step <= 8; step += 1) {
        const arcAngle = angle + (step / 8) * Math.PI * 1.1
        arc.push(
          new THREE.Vector2(
            centerX + Math.cos(arcAngle) * 0.12,
            centerY + Math.sin(arcAngle) * 0.12,
          ),
        )
      }
      lines.push(arc)
    }
    return lines
  }

  if (pattern === 'wave') {
    for (let ring = 0; ring < 3; ring += 1) {
      const rx = 0.6 + ring * 0.14
      const ry = 0.4 + ring * 0.1
      const wave: THREE.Vector2[] = []
      for (let step = 0; step <= 64; step += 1) {
        const angle = (step / 64) * Math.PI * 2
        const wobble = 1 + Math.sin(angle * 8 + ring * 1.2) * 0.025
        wave.push(
          new THREE.Vector2(
            Math.cos(angle) * rx * wobble,
            Math.sin(angle) * ry * wobble,
          ),
        )
      }
      lines.push(wave)
    }
    return lines
  }

  for (let i = 0; i < 10; i += 1) {
    const angle = (i / 10) * Math.PI * 2
    const center = new THREE.Vector2(
      Math.cos(angle) * 0.92,
      Math.sin(angle) * 0.62,
    )
    const rotation = angle + Math.PI / 2
    const local = [
      new THREE.Vector2(-0.07, -0.07),
      new THREE.Vector2(0.07, -0.07),
      new THREE.Vector2(0.07, 0.07),
      new THREE.Vector2(-0.03, 0.07),
      new THREE.Vector2(-0.03, 0),
      new THREE.Vector2(0.02, 0),
    ]
    lines.push(
      local.map(
        (point) =>
          new THREE.Vector2(
            center.x + point.x * Math.cos(rotation) - point.y * Math.sin(rotation),
            center.y + point.x * Math.sin(rotation) + point.y * Math.cos(rotation),
          ),
      ),
    )
  }

  return lines
}

function mergeBoxes(geometries: THREE.BufferGeometry[]) {
  let vertexCount = 0
  let indexCount = 0
  for (const geometry of geometries) {
    vertexCount += geometry.attributes.position.count
    indexCount += geometry.index?.count ?? 0
  }

  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  const indices = new Uint32Array(indexCount)
  let vertexOffset = 0
  let indexOffset = 0
  let vertexBase = 0

  for (const geometry of geometries) {
    const position = geometry.getAttribute('position') as THREE.BufferAttribute
    const normal = geometry.getAttribute('normal') as THREE.BufferAttribute
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute
    positions.set(position.array as Float32Array, vertexOffset * 3)
    normals.set(normal.array as Float32Array, vertexOffset * 3)
    uvs.set(uv.array as Float32Array, vertexOffset * 2)
    if (geometry.index) {
      for (let i = 0; i < geometry.index.count; i += 1) {
        indices[indexOffset + i] = geometry.index.getX(i) + vertexBase
      }
      indexOffset += geometry.index.count
    }
    vertexOffset += position.count
    vertexBase += position.count
  }

  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  merged.setIndex(new THREE.BufferAttribute(indices, 1))
  return merged
}

function createGrooveGeometry(lines: THREE.Vector2[][]) {
  const boxes: THREE.BufferGeometry[] = []
  const centerY = BODY_TOP + 0.002 - GROOVE_HEIGHT / 2

  for (const line of lines) {
    for (let i = 0; i < line.length - 1; i += 1) {
      const from = line[i]
      const to = line[i + 1]
      const fromX = from.x
      const fromZ = -from.y
      const toX = to.x
      const toZ = -to.y
      const dx = toX - fromX
      const dz = toZ - fromZ
      const length = Math.hypot(dx, dz)
      if (length < 0.002) continue

      const box = new THREE.BoxGeometry(
        length + GROOVE_WIDTH,
        GROOVE_HEIGHT,
        GROOVE_WIDTH,
      )
      const matrix = new THREE.Matrix4()
      matrix.makeRotationY(Math.atan2(-dz, dx))
      matrix.setPosition((fromX + toX) / 2, centerY, (fromZ + toZ) / 2)
      box.applyMatrix4(matrix)
      boxes.push(box)
    }
  }

  if (boxes.length === 0) return null
  const merged = mergeBoxes(boxes)
  for (const box of boxes) box.dispose()
  return merged
}

// 砚身：砚边 + 砚壁 + 砚池凹陷（不含纹样刻槽）
export function createRimBody(shape: InkstoneShape) {
  const parts = createShape(shape)
  parts.outer.holes = parts.pools.map(reverseShape)

  const body = new THREE.ExtrudeGeometry(parts.outer, {
    depth: THICKNESS,
    bevelEnabled: true,
    bevelSegments: 4,
    bevelSize: 0.035,
    bevelThickness: 0.025,
    curveSegments: 48,
  })
  body.rotateX(-Math.PI / 2)
  body.translate(0, -THICKNESS, 0)
  body.computeVertexNormals()
  return body
}

// 雕刻台砚身：圆角矩形砚边（边框），中央挖出雕刻面大小的开口，让雕刻面完全暴露可交互
export function createCarveBody(planeWidth: number, planeHeight: number) {
  const outer = roundedRect(planeWidth + 0.24, planeHeight + 0.24, 0.16)
  const opening = roundedRect(planeWidth, planeHeight, 0.08)
  outer.holes = [reverseShape(opening)]

  const body = new THREE.ExtrudeGeometry(outer, {
    depth: THICKNESS,
    bevelEnabled: true,
    bevelSegments: 4,
    bevelSize: 0.05,
    bevelThickness: 0.035,
    curveSegments: 48,
  })
  body.rotateX(-Math.PI / 2)
  body.translate(0, -THICKNESS, 0)
  body.computeVertexNormals()
  return body
}

// —— 原石随形几何：每块洮河石都有天然不规则的随形外缘（相石而作）——
export type RawStone = 'green' | 'yellow' | 'purple'

// 原石轮廓：三种石料三套不同扰动（主频/次频/相位），包围盒约 2.6×1.6
// d/e 是高频项：原石边缘从来不是一条顺滑曲线，而是密布细微崩口。
// 频率取 9.5 / 15.3 这种非整数倍频——整数倍频会在轮廓上叠出
// 手工折纸那样的规律感，一眼就看出是程序生成的
const RAW_PARAMS: Record<
  RawStone,
  {
    a: number
    b: number
    c: number
    d: number
    e: number
    p1: number
    p2: number
    p3: number
    p4: number
    p5: number
  }
> = {
  green: {
    a: 0.1,
    b: 0.06,
    c: 0.03,
    d: 0.017,
    e: 0.009,
    p1: 0.9,
    p2: -0.5,
    p3: 0.2,
    p4: 1.7,
    p5: -2.3,
  },
  yellow: {
    a: 0.05,
    b: 0.1,
    c: 0.04,
    d: 0.015,
    e: 0.011,
    p1: 2.2,
    p2: 1.1,
    p3: -0.7,
    p4: -1.2,
    p5: 0.6,
  },
  purple: {
    a: 0.12,
    b: 0.04,
    c: 0.06,
    d: 0.019,
    e: 0.008,
    p1: -0.4,
    p2: 0.3,
    p3: 2.4,
    p4: 2.9,
    p5: -0.8,
  },
}

const RAW_SEGMENTS = 180

function rawScale(stone: RawStone) {
  const s = RAW_PARAMS[stone]
  const maxAmp = 1 + s.a + s.b + s.c + s.d + s.e
  return { scaleX: 1.3 / maxAmp, scaleY: 0.8 / maxAmp }
}

// 轮廓的极坐标半径函数 r(θ)。判点是否在形内只需比较半径 —— O(1)，
// 比「多边形射线法逐点遍历」快几个数量级（裁剪 8 万个三角形时是必须的）
function smoothRadius(stone: RawStone, angle: number) {
  const s = RAW_PARAMS[stone]
  return (
    1 +
    Math.sin(angle * 3 + s.p1) * s.a +
    Math.cos(angle * 5 + s.p2) * s.b +
    Math.sin(angle * 7 + s.p3) * s.c +
    Math.sin(angle * 9.5 + s.p4) * s.d +
    Math.cos(angle * 15.3 + s.p5) * s.e
  )
}

// 纯正弦叠加出来的轮廓永远是顺滑的，磨出来像橡皮泥。
// 板岩有劈理面，原石边缘本来就带几段平直的劈裂边，转折处是硬的。
// 做法：把圆周切成若干不等分的扇区，扇区内按弦线（直线）走，再与平滑轮廓混合。
// 只混合 55%——全取弦线会变成一个生硬的多边形，太假。
const FACET_COUNT = 9
function rawRadius(stone: RawStone, angle: number) {
  const s = RAW_PARAMS[stone]
  const step = (Math.PI * 2) / FACET_COUNT
  const shifted = angle - s.p4 + Math.PI * 4
  const index = Math.floor(shifted / step)
  const t = shifted / step - index
  const a0 = s.p4 + index * step - Math.PI * 4
  const r0 = smoothRadius(stone, a0)
  const r1 = smoothRadius(stone, a0 + step)
  const chord = r0 + (r1 - r0) * t
  return smoothRadius(stone, angle) * 0.45 + chord * 0.55
}

function rawStonePoints(stone: RawStone, scale = 1): THREE.Vector2[] {
  const { scaleX, scaleY } = rawScale(stone)
  const points: THREE.Vector2[] = []
  for (let i = 0; i < RAW_SEGMENTS; i += 1) {
    const angle = (i / RAW_SEGMENTS) * Math.PI * 2
    const radius = rawRadius(stone, angle) * scale
    points.push(
      new THREE.Vector2(
        Math.cos(angle) * radius * scaleX,
        Math.sin(angle) * radius * scaleY,
      ),
    )
  }
  return points
}

// 点是否落在原石轮廓内（scale 为轮廓缩放，例如 0.97 表示内缩 3%）
export function insideRawStone(
  stone: RawStone,
  x: number,
  y: number,
  scale = 1,
) {
  const { scaleX, scaleY } = rawScale(stone)
  const nx = x / scaleX
  const ny = y / scaleY
  const radius = Math.hypot(nx, ny)
  if (radius < 1e-6) return true
  return radius <= rawRadius(stone, Math.atan2(ny, nx)) * scale
}

export function createRawStoneShape(stone: RawStone, scale = 1) {
  return new THREE.Shape(rawStonePoints(stone, scale))
}

// 原石石沿（边框）：外缘=原石放大，内缘开口=原石缩小，中央露出可雕刻的磨平面
export function createRawStoneRim(stone: RawStone) {
  const outer = createRawStoneShape(stone, 1.06)
  // 洞口内缩 10%：砚边宽度约为一成，磨平面（砚堂）从中露出
  const opening = rawStonePoints(stone, 0.9).reverse()
  outer.holes = [new THREE.Path(opening)]

  const body = new THREE.ExtrudeGeometry(outer, {
    depth: THICKNESS,
    // 关掉倒角：砚边在「腰部」只有约 0.09 宽，任何倒角都会让内外两侧的
    // 倒角面互相穿插，沿砚边炸出一排小锯齿
    bevelEnabled: false,
    curveSegments: 48,
  })
  body.rotateX(-Math.PI / 2)
  body.translate(0, -THICKNESS, 0)
  body.computeVertexNormals()
  return body
}

// 原石底座：实心随形厚板，顶面略低于雕刻面最低点，作为砚堂/砚池的底
// （没有它，石沿就是一圈悬空的环，中间是空的——真实砚台是实心的）
export function createRawStoneBase(stone: RawStone) {
  // 收在石沿外缘(1.06)以内：底座倒角一旦越过石沿外壁，
  // 就会沿砚边炸出一排小锯齿
  const outer = createRawStoneShape(stone, 0.985)
  const body = new THREE.ExtrudeGeometry(outer, {
    depth: 0.5,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: 0.04,
    bevelThickness: 0.03,
    curveSegments: 40,
  })
  body.rotateX(-Math.PI / 2)
  body.translate(0, -0.5, 0)
  body.computeVertexNormals()
  return body
}

// 雕刻面：沿原石轮廓分布的极坐标网格。
//
// 之前用 PlaneGeometry 再「把轮廓外的顶点吸附到边界」，问题是矩形的四个角
// 必然落在椭圆轮廓之外很远处，四角连成的整片三角形顶点全部被压到同一条曲线上，
// 重叠成退化三角形 —— 法线算出来是错的，光照下就是边缘一圈发亮的「塑料膜」。
//
// 极坐标网格每圈顶点天然沿轮廓排布，不存在压缩与重叠：
//   · 顶点数只取 128×64 量级，比 300×190 的矩形少一个数量级，每帧位移更省
//   · 边缘严格随形，和石沿洞口对齐后没有任何接缝
//   · UV 仍按 GUIDE_WIDTH/HEIGHT 归一化，与高度图、砚池绘制完全一致
export function createRawStoneCarvePlane(
  stone: RawStone,
  width: number,
  height: number,
  segX: number,
  segY: number,
) {
  const { scaleX, scaleY } = rawScale(stone)
  const radial = Math.max(96, Math.round(segX * 0.6))
  const rings = Math.max(40, Math.round(segY * 0.6))
  // 略微超出轮廓：让边缘埋进石沿实体，可见部分全在洞口以内
  const limitScale = 1.02

  const positions: number[] = [0, 0, 0]
  const uvs: number[] = [0.5, 0.5]
  const indices: number[] = []

  for (let ring = 1; ring <= rings; ring += 1) {
    const t = ring / rings
    for (let i = 0; i < radial; i += 1) {
      const angle = (i / radial) * Math.PI * 2
      const radius = rawRadius(stone, angle) * limitScale * t
      const x = Math.cos(angle) * radius * scaleX
      const y = Math.sin(angle) * radius * scaleY
      positions.push(x, y, 0)
      uvs.push(x / width + 0.5, y / height + 0.5)
    }
  }

  // 中心扇面
  for (let i = 0; i < radial; i += 1) {
    indices.push(0, 1 + i, 1 + ((i + 1) % radial))
  }
  // 逐环缝合
  for (let ring = 1; ring < rings; ring += 1) {
    const inner = 1 + (ring - 1) * radial
    const outer = 1 + ring * radial
    for (let i = 0; i < radial; i += 1) {
      const next = (i + 1) % radial
      const a = inner + i
      const b = inner + next
      const c = outer + i
      const d = outer + next
      indices.push(a, c, d, a, d, b)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  )
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

// 完整砚身：createRimBody 再减纹样刻槽
export function createGroovedBody(
  shape: InkstoneShape,
  pattern: InkstonePattern,
) {
  const body = createRimBody(shape)

  const grooves = createGrooveGeometry(patternPolylines(shape, pattern))
  if (!grooves) return body

  const bodyBrush = new Brush(body)
  const grooveBrush = new Brush(grooves)
  bodyBrush.updateMatrixWorld()
  grooveBrush.updateMatrixWorld()

  const result = evaluator.evaluate(bodyBrush, grooveBrush, SUBTRACTION)
  const geometry = result.geometry
  geometry.computeVertexNormals()
  body.dispose()
  grooves.dispose()
  return geometry
}
