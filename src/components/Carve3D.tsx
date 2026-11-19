import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import {
  ContactShadows,
  Environment,
  OrbitControls,
  RoundedBox,
} from '@react-three/drei'
import * as THREE from 'three'
import {
  createRawStoneBase,
  createRawStoneCarvePlane,
  createRawStoneRim,
  createShape,
  type InkstoneShape,
  type InkstonePattern,
} from './inkstoneGeometry'
import {
  STONE_DEEP,
  useGreenStoneTexture,
  type StoneVariant,
} from './useGreenStoneTexture'

type CarveTool = 'chisel' | 'fine' | 'polish'

const CANVAS_SIZE = 1024
const GUIDE_WIDTH = 2.6
const GUIDE_HEIGHT = 1.6
// 原石 → 砚池器型映射：真实洮砚「相石而作」，因石定形（石料决定砚池形状）
const STONE_SHAPE: Record<StoneVariant, InkstoneShape> = {
  green: '圆形',
  yellow: '长方',
  purple: '随形',
}

// 纹样浮雕高度图：按真实洮砚照片构图生成的黑白浮雕（反相后黑=凸、白=凹），映射到雕刻面
const PATTERN_HEIGHT_SRC: Record<InkstonePattern, string> = {
  lotus: 'textures/patterns/lotus_height.png',
  cloud: 'textures/patterns/cloud_height.png',
  wave: 'textures/patterns/wave_height.png',
  meander: 'textures/patterns/meander_height.png',
}

// 砚池缩放：createShape 的砚池尺寸为完整砚台设计，缩放到 2.6×1.6 雕刻面内
const POOL_SCALE = 0.44

function getCarvePools(stone: StoneVariant) {
  return createShape(STONE_SHAPE[stone]).pools.map((pool) => {
    const points = pool
      .getPoints(64)
      .map((point) => point.clone().multiplyScalar(POOL_SCALE))
    return new THREE.Shape(points)
  })
}

function createGuideTextureSource(
  heightImage: HTMLImageElement,
  scale = 1,
) {
  const canvas = document.createElement('canvas')
  canvas.width = CANVAS_SIZE
  canvas.height = CANVAS_SIZE
  const context = canvas.getContext('2d')
  if (!context) return null
  const drawSize = CANVAS_SIZE * scale
  const offset = (CANVAS_SIZE - drawSize) / 2
  context.fillStyle = '#808080'
  context.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
  context.drawImage(heightImage, offset, offset, drawSize, drawSize)
  const source = context.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE)
  const out = context.createImageData(CANVAS_SIZE, CANVAS_SIZE)
  const size = CANVAS_SIZE
  const gray = new Float32Array(size * size)
  for (let i = 0; i < gray.length; i += 1) {
    gray[i] = source.data[i * 4] / 255
  }
  // 引导线 = 从真实纹样高度图提取的刀路：
  // 反相后白=凹=要下刀的沟槽，取其边缘 + 主体描成金色刻线稿
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x
      const x0 = x > 0 ? index - 1 : index
      const x1 = x < size - 1 ? index + 1 : index
      const y0 = y > 0 ? index - size : index
      const y1 = y < size - 1 ? index + size : index
      const gx = gray[x1] - gray[x0]
      const gy = gray[y1] - gray[y0]
      const edge = Math.min(1, Math.hypot(gx, gy) * 9)
      // 只描刀路「轮廓」，不要填充凹槽区域本身——
      // 高度图里凹槽面积很大，按区域点亮会把整块石面刷成金色
      const alpha = Math.min(1, edge * 0.82)
      const target = index * 4
      // 关键：emissiveMap 只乘 RGB、忽略 alpha。
      // 若透明区域仍保留金色 RGB，整块石面都会被刷上一层金光（米黄）。
      // 所以这里按 alpha 预乘 RGB，透明处变纯黑。
      out.data[target] = Math.round(214 * alpha)
      out.data[target + 1] = Math.round(181 * alpha)
      out.data[target + 2] = Math.round(118 * alpha)
      out.data[target + 3] = Math.round(alpha * 205)
    }
  }
  context.putImageData(out, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  texture.needsUpdate = true
  return { texture, canvas }
}

// 从高度图生成「刻痕遮罩 / 刻痕 AO」贴图：
// R = 刻痕遮罩（凹下去多少，0~1）
// G = 刻痕 AO（相对周围越凹，遮蔽越强）
// 这两张通道交给 shader 混合，让刻痕是「石头的颜色变深 + 凹处变暗」，
// 而不是往石面上贴一块半透明的深色图片（那正是「涂鸦感」的来源）
function rebuildCarveMask(
  heightCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
) {
  const heightContext = heightCanvas.getContext('2d')
  const maskContext = maskCanvas.getContext('2d')
  if (!heightContext || !maskContext) return

  const sw = heightCanvas.width
  const sh = heightCanvas.height
  const dw = maskCanvas.width
  const dh = maskCanvas.height
  const source = heightContext.getImageData(0, 0, sw, sh)
  const gray = new Float32Array(sw * sh)
  for (let i = 0; i < sw * sh; i += 1) {
    gray[i] = source.data[i * 4] / 255
  }
  const target = maskContext.createImageData(dw, dh)
  const stepX = sw / dw
  const stepY = sh / dh
  const radius = 5

  for (let y = 0; y < dh; y += 1) {
    for (let x = 0; x < dw; x += 1) {
      const sx = Math.min(sw - 1, Math.floor(x * stepX))
      const sy = Math.min(sh - 1, Math.floor(y * stepY))
      const height = gray[sy * sw + sx]
      const carve = Math.min(1, Math.max(0, (height - 0.5) * 2.6))

      let sum = 0
      let count = 0
      for (let dy = -radius; dy <= radius; dy += 2) {
        for (let dx = -radius; dx <= radius; dx += 2) {
          const nx = Math.min(sw - 1, Math.max(0, sx + dx))
          const ny = Math.min(sh - 1, Math.max(0, sy + dy))
          sum += gray[ny * sw + nx]
          count += 1
        }
      }
      const average = sum / count
      const occlusion = Math.min(1, Math.max(0, (height - average) * 5.2))
      const ao = 1 - occlusion * 0.85

      const index = (y * dw + x) * 4
      target.data[index] = Math.round(carve * 255)
      target.data[index + 1] = Math.round(ao * 255)
      target.data[index + 2] = Math.round(carve * 255)
      target.data[index + 3] = 255
    }
  }
  maskContext.putImageData(target, 0, 0)
}

// 从高度图实时重算法线（让凹槽有正确立体光影，这是「雕刻」与「涂鸦」的关键区别）
function updateNormalMap(
  heightCanvas: HTMLCanvasElement,
  normalCanvas: HTMLCanvasElement,
  strength = 1.2,
) {
  const heightContext = heightCanvas.getContext('2d')
  const normalContext = normalCanvas.getContext('2d')
  if (!heightContext || !normalContext) return

  const sw = heightCanvas.width
  const sh = heightCanvas.height
  const dw = normalCanvas.width
  const dh = normalCanvas.height
  const source = heightContext.getImageData(0, 0, sw, sh)
  const full = new Float32Array(sw * sh)
  for (let i = 0; i < sw * sh; i += 1) {
    full[i] = source.data[i * 4] / 255
  }
  // 平均降采样：点采样会把高频噪点原样带进法线，形成密密麻麻的尖刺
  const gray = new Float32Array(dw * dh)
  const ratioX = sw / dw
  const ratioY = sh / dh
  for (let y = 0; y < dh; y += 1) {
    for (let x = 0; x < dw; x += 1) {
      let sum = 0
      let count = 0
      const startX = Math.floor(x * ratioX)
      const startY = Math.floor(y * ratioY)
      const endX = Math.min(sw, Math.floor((x + 1) * ratioX))
      const endY = Math.min(sh, Math.floor((y + 1) * ratioY))
      for (let sy = startY; sy < endY; sy += 1) {
        for (let sx = startX; sx < endX; sx += 1) {
          sum += full[sy * sw + sx]
          count += 1
        }
      }
      gray[y * dw + x] = count > 0 ? sum / count : full[startY * sw + startX]
    }
  }
  const target = normalContext.createImageData(dw, dh)

  for (let y = 0; y < dh; y += 1) {
    for (let x = 0; x < dw; x += 1) {
      const sx = x
      const sy = y
      const x0 = Math.max(0, sx - 1)
      const x1 = Math.min(dw - 1, sx + 1)
      const y0 = Math.max(0, sy - 1)
      const y1 = Math.min(dh - 1, sy + 1)
      const gx =
        gray[y0 * dw + x0] -
        gray[y0 * dw + x1] +
        2 * (gray[sy * dw + x0] - gray[sy * dw + x1]) +
        gray[y1 * dw + x0] -
        gray[y1 * dw + x1]
      const gy =
        gray[y0 * dw + x0] -
        gray[y1 * dw + x0] +
        2 * (gray[y0 * dw + sx] - gray[y1 * dw + sx]) +
        gray[y0 * dw + x1] -
        gray[y1 * dw + x1]
      const nx = -gx * strength
      const ny = -gy * strength
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1)
      const index = (y * dw + x) * 4
      target.data[index] = Math.round((nx * inv * 0.5 + 0.5) * 255)
      target.data[index + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255)
      target.data[index + 2] = Math.round((inv * 0.5 + 0.5) * 255)
      target.data[index + 3] = 255
    }
  }
  normalContext.putImageData(target, 0, 0)
}

function CarveSurface({
  tool,
  brushSize,
  pattern,
  orbit,
  patternScale,
  showGuide,
  stone,
  onUndoReady,
}: {
  tool: CarveTool
  brushSize: number
  pattern: InkstonePattern
  orbit: boolean
  patternScale: number
  showGuide: boolean
  stone: StoneVariant
  onUndoReady?: (undo: () => void) => void
}) {
  const heightCanvas = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = CANVAS_SIZE
    canvas.height = CANVAS_SIZE
    return canvas
  }, [])

  // 纹样浮雕高度图（真实照片构图，反相后黑=凸白=凹）
  const [patternImg, setPatternImg] = useState<HTMLImageElement | null>(null)

  useEffect(() => {
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (!cancelled) setPatternImg(img)
    }
    img.src = PATTERN_HEIGHT_SRC[pattern]
    return () => {
      cancelled = true
      img.onload = null
    }
  }, [pattern])

  const heightTexture = useMemo(() => {
    const texture = new THREE.CanvasTexture(heightCanvas)
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.colorSpace = THREE.NoColorSpace
    texture.needsUpdate = true
    return texture
  }, [heightCanvas])

  // 刻痕遮罩（R=刻痕量, G=刻痕AO），交给 shader 与石纹照片混合
  const carveMaskCanvas = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = CANVAS_SIZE
    canvas.height = CANVAS_SIZE
    return canvas
  }, [])

  const carveMaskTexture = useMemo(() => {
    const texture = new THREE.CanvasTexture(carveMaskCanvas)
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.colorSpace = THREE.NoColorSpace
    texture.needsUpdate = true
    return texture
  }, [carveMaskCanvas])

  // 引导线：直接从真实纹样高度图提取的刀路，不再是几条程序化直线
  const [guide, setGuide] = useState<{
    texture: THREE.Texture
    canvas: HTMLCanvasElement
  } | null>(null)

  useEffect(() => {
    if (!patternImg) {
      setGuide(null)
      return
    }
    const next = createGuideTextureSource(patternImg, patternScale)
    setGuide(next)
    return () => {
      next?.texture.dispose()
    }
  }, [patternImg, patternScale])

  const normalCanvas = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 512
    return canvas
  }, [])

  const normalTexture = useMemo(() => {
    const texture = new THREE.CanvasTexture(normalCanvas)
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.colorSpace = THREE.NoColorSpace
    texture.needsUpdate = true
    return texture
  }, [normalCanvas])

  const geometry = useMemo(
    () => createRawStoneCarvePlane(stone, GUIDE_WIDTH, GUIDE_HEIGHT, 420, 280),
    [stone],
  )

  const bodyGeometry = useMemo(() => createRawStoneRim(stone), [stone])
  const baseGeometry = useMemo(() => createRawStoneBase(stone), [stone])

  const stonePBR = useGreenStoneTexture(stone, 2)
  const stoneNormalScale = useMemo(() => new THREE.Vector2(0.7, 0.7), [])
  const carveNormalScale = useMemo(() => new THREE.Vector2(0.55, 0.55), [])

  const heightTextureRef = useRef(heightTexture)
  const carveMaskTextureRef = useRef(carveMaskTexture)
  const normalTextureRef = useRef(normalTexture)
  const drawingRef = useRef(false)
  const lastUvRef = useRef<THREE.Vector2 | null>(null)
  const normalUpdatePendingRef = useRef(false)

  useEffect(() => {
    heightTextureRef.current = heightTexture
    carveMaskTextureRef.current = carveMaskTexture
    normalTextureRef.current = normalTexture
  }, [heightTexture, carveMaskTexture, normalTexture])

  useEffect(() => {
    updateNormalMap(heightCanvas, normalCanvas)
    normalTexture.needsUpdate = true
  }, [heightCanvas, normalCanvas, normalTexture])

  // 重绘高度图：基底中灰 → 纹样浮雕（真实照片构图）→ 砚池深坑
  useEffect(() => {
    const context = heightCanvas.getContext('2d')
    if (!context) return
    const scaleX = CANVAS_SIZE / GUIDE_WIDTH
    const scaleY = CANVAS_SIZE / GUIDE_HEIGHT
    const pools = getCarvePools(stone)

    // 1. 基底中灰（石面基准）
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.fillStyle = '#808080'
    context.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)

    // 2. 纹样浮雕（真实照片构图）；图未就绪时保持纯石面，绝不回退成程序化线条
    if (patternImg) {
      // AI 生成的浮雕图带有高频噪点，直接当位移图会把每个噪点变成一个尖刺，
      // 整块磨平面会炸成「毛刺」。先做一次高斯模糊，只保留浮雕的大形。
      context.filter = 'blur(5px)'
      context.drawImage(patternImg, 0, 0, CANVAS_SIZE, CANVAS_SIZE)
      context.filter = 'none'
    }

    // 3. 砚池深坑（白=凹）：用柔边径向渐变，让池壁自然过渡，
    //    硬边纯白会把中心纹样整片抹平
    context.setTransform(scaleX, 0, 0, -scaleY, CANVAS_SIZE / 2, CANVAS_SIZE / 2)
    for (const pool of pools) {
      const points = pool.getPoints(64)
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      for (const point of points) {
        minX = Math.min(minX, point.x)
        maxX = Math.max(maxX, point.x)
        minY = Math.min(minY, point.y)
        maxY = Math.max(maxY, point.y)
      }
      const cx = (minX + maxX) / 2
      const cy = (minY + maxY) / 2
      const radius = Math.max(maxX - minX, maxY - minY) / 2
      const poolGradient = context.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius)
      poolGradient.addColorStop(0, '#ffffff')
      poolGradient.addColorStop(0.72, '#f2f2f2')
      poolGradient.addColorStop(1, '#808080')
      context.fillStyle = poolGradient
      context.beginPath()
      points.forEach((point, index) => {
        if (index === 0) context.moveTo(point.x, point.y)
        else context.lineTo(point.x, point.y)
      })
      context.closePath()
      context.fill()
    }

    heightTextureRef.current.needsUpdate = true
    updateNormalMap(heightCanvas, normalCanvas)
    normalTextureRef.current.needsUpdate = true
    rebuildCarveMask(heightCanvas, carveMaskCanvas)
    carveMaskTextureRef.current.needsUpdate = true
  }, [
    patternImg,
    pattern,
    stone,
    heightCanvas,
    normalCanvas,
    normalTexture,
    carveMaskCanvas,
  ])

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => heightTexture.dispose(), [heightTexture])
  useEffect(() => () => normalTexture.dispose(), [normalTexture])
  useEffect(() => () => carveMaskTexture.dispose(), [carveMaskTexture])
  useEffect(() => () => bodyGeometry.dispose(), [bodyGeometry])
  useEffect(() => () => baseGeometry.dispose(), [baseGeometry])

  const paint = (uv: THREE.Vector2) => {
    const heightContext = heightCanvas.getContext('2d')
    if (!heightContext) return

    const x = uv.x * CANVAS_SIZE
    const y = (1 - uv.y) * CANVAS_SIZE
    const toolScale = tool === 'fine' ? 0.55 : tool === 'polish' ? 1.75 : 1
    const baseRadius = Math.max(9, brushSize * 1.15) * toolScale
    // 每种刀的目标深度：用「不透明目标灰度」落到石面，
    // 同一处刻到目标深度后不再加深——这才是凿刻，而不是无限叠加变白
    const targetDepth = tool === 'chisel' ? 234 : tool === 'fine' ? 214 : 140

    const stamp = (
      stampX: number,
      stampY: number,
      dirX: number,
      dirY: number,
      pressure: number,
    ) => {
      const radius = baseRadius * (tool === 'polish' ? 1 : pressure)
      const angle = Math.atan2(dirY, dirX)
      const depth = Math.round(targetDepth * Math.min(1, 0.87 + pressure * 0.13))

      heightContext.save()
      heightContext.translate(stampX, stampY)
      heightContext.rotate(angle)
      heightContext.globalCompositeOperation = 'source-over'

      if (tool === 'chisel') {
        // 楔形 V 槽：刃口中间最深、两侧抬起，两端收成刀尖
        const length = radius * 2.4
        const width = radius * 0.62
        const vGradient = heightContext.createLinearGradient(0, -width, 0, width)
        vGradient.addColorStop(0, 'rgba(255,255,255,0)')
        vGradient.addColorStop(0.28, `rgba(${depth},${depth},${depth},0.88)`)
        vGradient.addColorStop(0.5, `rgba(${depth},${depth},${depth},1)`)
        vGradient.addColorStop(0.72, `rgba(${depth},${depth},${depth},0.88)`)
        vGradient.addColorStop(1, 'rgba(255,255,255,0)')
        heightContext.fillStyle = vGradient
        heightContext.beginPath()
        heightContext.ellipse(0, 0, length, width, 0, 0, Math.PI * 2)
        heightContext.fill()
      } else if (tool === 'fine') {
        // 窄 U 槽：硬边、短刃，两端收尖（阴刻线）
        const length = radius * 1.7
        const width = radius * 0.82
        const uGradient = heightContext.createRadialGradient(0, 0, 0, 0, 0, width)
        uGradient.addColorStop(0, `rgba(${depth},${depth},${depth},1)`)
        uGradient.addColorStop(0.62, `rgba(${depth},${depth},${depth},0.92)`)
        uGradient.addColorStop(1, 'rgba(255,255,255,0)')
        heightContext.fillStyle = uGradient
        heightContext.beginPath()
        heightContext.ellipse(0, 0, length, width, 0, 0, Math.PI * 2)
        heightContext.fill()
      } else {
        // 打磨：以石面基准灰柔和回填，压掉毛刺、保留大起伏
        const softGradient = heightContext.createRadialGradient(0, 0, 0, 0, 0, radius)
        softGradient.addColorStop(0, 'rgba(137,137,137,0.9)')
        softGradient.addColorStop(0.55, 'rgba(139,139,139,0.5)')
        softGradient.addColorStop(1, 'rgba(140,140,140,0)')
        heightContext.fillStyle = softGradient
        heightContext.beginPath()
        heightContext.arc(0, 0, radius, 0, Math.PI * 2)
        heightContext.fill()
      }

      // 崩口：石质脆性剥落，沿刃口撒几粒碎屑，避免过于「塑料圆润」
      if (tool !== 'polish') {
        for (let i = 0; i < 3; i += 1) {
          const chipX = (Math.random() - 0.5) * radius * 2.5
          const chipY = (Math.random() - 0.5) * radius * 1.3
          const chipR = radius * (0.045 + Math.random() * 0.085)
          heightContext.globalCompositeOperation = 'source-over'
          heightContext.fillStyle = `rgba(${depth},${depth},${depth},0.92)`
          heightContext.beginPath()
          heightContext.arc(chipX, chipY, chipR, 0, Math.PI * 2)
          heightContext.fill()
        }
      }

      heightContext.restore()
    }

    if (lastUvRef.current) {
      const lastX = lastUvRef.current.x * CANVAS_SIZE
      const lastY = (1 - lastUvRef.current.y) * CANVAS_SIZE
      const dx = x - lastX
      const dy = y - lastY
      const distance = Math.hypot(dx, dy)
      const dirX = distance > 0 ? dx / distance : 1
      const dirY = distance > 0 ? dy / distance : 0
      // 慢刀重、快刀轻
      const pressure = Math.max(0.55, Math.min(1.2, 1.35 - distance / 36))
      const steps = Math.max(
        1,
        Math.ceil(distance / Math.max(2, baseRadius * 0.16)),
      )
      for (let step = 1; step <= steps; step += 1) {
        const progress = step / steps
        // 走刀顿挫：沿垂直方向轻微摆动，模拟手工刀痕
        const jitter =
          tool === 'polish' ? 0 : (Math.random() - 0.5) * baseRadius * 0.22
        stamp(
          lastX + dx * progress - jitter * dirY,
          lastY + dy * progress + jitter * dirX,
          dirX,
          dirY,
          pressure,
        )
      }
    } else {
      stamp(x, y, 1, 0, 1)
    }

    lastUvRef.current = uv.clone()

    // 辅助线「刻到哪消失到哪」
    const guideContext = guide?.canvas.getContext('2d')
    if (guideContext) {
      guideContext.save()
      guideContext.globalCompositeOperation = 'destination-out'
      guideContext.beginPath()
      guideContext.arc(x, y, baseRadius * 1.2, 0, Math.PI * 2)
      guideContext.fill()
      guideContext.restore()
    }

    // 节流上传（每帧最多一次）：高度/法线/刻痕遮罩批量重算
    if (!normalUpdatePendingRef.current) {
      normalUpdatePendingRef.current = true
      requestAnimationFrame(() => {
        normalUpdatePendingRef.current = false
        heightTextureRef.current.needsUpdate = true
        if (guide?.texture) guide.texture.needsUpdate = true
        updateNormalMap(heightCanvas, normalCanvas)
        normalTextureRef.current.needsUpdate = true
        rebuildCarveMask(heightCanvas, carveMaskCanvas)
        carveMaskTextureRef.current.needsUpdate = true
      })
    }
  }


  // —— 撤销：每次下刀前保存高度图快照 ——
  const historyRef = useRef<ImageData[]>([])

  const snapshot = () => {
    const heightContext = heightCanvas.getContext('2d')
    if (!heightContext) return
    historyRef.current.push(
      heightContext.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE),
    )
    if (historyRef.current.length > 24) historyRef.current.shift()
  }

  const undo = useCallback(() => {
    const last = historyRef.current.pop()
    if (!last) return
    const heightContext = heightCanvas.getContext('2d')
    if (!heightContext) return
    heightContext.putImageData(last, 0, 0)
    heightTextureRef.current.needsUpdate = true
    updateNormalMap(heightCanvas, normalCanvas)
    normalTextureRef.current.needsUpdate = true
    rebuildCarveMask(heightCanvas, carveMaskCanvas)
    carveMaskTextureRef.current.needsUpdate = true
  }, [heightCanvas, normalCanvas, normalTexture, carveMaskCanvas])

  useEffect(() => {
    onUndoReady?.(undo)
  }, [onUndoReady, undo])

  // —— 雕刻面材质：石纹照片 + 位移高度 + 实时法线 + 刻痕深层色 + 刻痕 AO 合成在同一材质 ——
  const carveMaterial = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        // 基色由石料决定（下面按 stone 覆盖），压掉玛瑙贴图亮部的偏黄
        color: 0xd2c2c8,
        roughness: 0.44,
        metalness: 0.02,
        clearcoat: 0.3,
        clearcoatRoughness: 0.42,
      }),
    [],
  )

  // 雕刻面单独用一份贴图：石沿的 repeat=2 会让纹理过密，
  // 磨平面用更小的重复尺度才像同一块石头的延续
  const carveMap = useMemo(() => {
    const base = stonePBR.map
    if (!base) return null
    const cloned = base.clone()
    cloned.wrapS = THREE.RepeatWrapping
    cloned.wrapT = THREE.RepeatWrapping
    cloned.repeat.set(1, 1)
    cloned.offset.set(0, 0)
    cloned.needsUpdate = true
    return cloned
  }, [stonePBR.map])

  useEffect(() => () => carveMap?.dispose(), [carveMap])

  useEffect(() => () => carveMaterial.dispose(), [carveMaterial])

  useEffect(() => {
    const material = carveMaterial
    // 贴图已经统一着色到石料本色，这里不再二次叠色，否则会偏暗发灰
    material.color.set(0xffffff)
    material.map = carveMap ?? stonePBR.map
    material.roughnessMap = stonePBR.roughnessMap
    material.normalMap = normalTexture
    material.normalScale.copy(carveNormalScale)
    material.displacementMap = heightTexture
    // 全部向下位移：石面基准比石沿低约 0.11，砚堂低于砚边的真实形制
    material.displacementScale = -0.16
    material.displacementBias = 0
    material.emissive.set('#c8a86b')
    material.emissiveMap = showGuide && guide ? guide.texture : null
    material.emissiveIntensity = showGuide && guide ? 0.34 : 0

    const deepColor = new THREE.Color(STONE_DEEP[stone])
    const maskTexture = carveMaskTexture
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uCarveMask = { value: maskTexture }
      shader.uniforms.uDeepColor = { value: deepColor }
      shader.fragmentShader = shader.fragmentShader
        .replace(
          'void main() {',
          `uniform sampler2D uCarveMask;
uniform vec3 uDeepColor;
void main() {`,
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
  vec4 carveSample = texture2D(uCarveMask, vMapUv);
  float carveAmount = carveSample.r;
  float carveAO = carveSample.g;
  vec3 deepStone = uDeepColor * (0.55 + 0.6 * carveAO);
  diffuseColor.rgb = mix(diffuseColor.rgb, deepStone, carveAmount * 0.9);
  diffuseColor.rgb *= mix(1.0, carveAO, carveAmount);`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
  roughnessFactor = mix(roughnessFactor, 0.68, carveAmount * 0.7);`,
        )
    }
    material.needsUpdate = true
  }, [
    carveMaterial,
    carveMap,
    stonePBR,
    normalTexture,
    heightTexture,
    carveMaskTexture,
    guide,
    showGuide,
    stone,
    carveNormalScale,
  ])


  return (
    <group rotation={[0.08, -0.25, 0.01]}>
      {/* 雕刻面：位移 + 实时法线 + 石纹照片 + 刻痕混合，是「石头本身被凿开」而不是「石头上画了东西」 */}
      <mesh
        geometry={geometry}
        material={carveMaterial}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.21, 0]}
        receiveShadow
        renderOrder={0}
        onPointerDown={(event) => {
          if (orbit) return
          event.stopPropagation()
          drawingRef.current = true
          lastUvRef.current = null
          snapshot()
          if (event.uv) paint(event.uv)
        }}
        onPointerMove={(event) => {
          if (!orbit && drawingRef.current && event.uv) paint(event.uv)
        }}
        onPointerUp={() => {
          drawingRef.current = false
          lastUvRef.current = null
        }}
        onPointerLeave={() => {
          drawingRef.current = false
          lastUvRef.current = null
        }}
        onPointerCancel={() => {
          drawingRef.current = false
          lastUvRef.current = null
        }}
      />

      {/* 砚身：原石石沿（天然随形边框），中央开口露出可雕刻的磨平面 */}
      <mesh
        geometry={bodyGeometry}
        position={[0, 0.21, 0]}
        raycast={() => {}}
        castShadow
        receiveShadow
      >
        <meshPhysicalMaterial
          map={stonePBR.map}
          normalMap={stonePBR.normalMap}
          roughnessMap={stonePBR.roughnessMap}
          normalScale={stoneNormalScale}
          color="#ffffff"
          roughness={0.34}
          metalness={0.03}
          clearcoat={0.4}
          clearcoatRoughness={0.35}
        />
      </mesh>

      {/* 实心底座：砚台是实心的，这层给雕刻面兜底，同时形成砚池深色水窝 */}
      <mesh
        geometry={baseGeometry}
        position={[0, -0.02, 0]}
        raycast={() => {}}
        castShadow
        receiveShadow
      >
        <meshPhysicalMaterial
          map={stonePBR.map}
          normalMap={stonePBR.normalMap}
          normalScale={stoneNormalScale}
          color="#6e6e6e"
          roughness={0.36}
          metalness={0.05}
          clearcoat={0.55}
          clearcoatRoughness={0.3}
        />
      </mesh>

      {/* 木质底座 */}
      <RoundedBox
        args={[2.9, 0.12, 1.9]}
        radius={0.06}
        smoothness={4}
        position={[0, -0.36, 0]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color="#2b1b12" roughness={0.72} />
      </RoundedBox>
    </group>
  )
}

export function Carve3D({
  tool,
  brushSize,
  pattern,
  orbit,
  patternScale,
  showGuide,
  stone = 'green',
  onCaptureReady,
  onUndoReady,
}: {
  tool: CarveTool
  brushSize: number
  pattern: InkstonePattern
  orbit: boolean
  patternScale: number
  showGuide: boolean
  stone?: StoneVariant
  onCaptureReady?: (capture: () => string | null) => void
  onUndoReady?: (undo: () => void) => void
}) {
  return (
    <Canvas
      dpr={[1, 2]}
      shadows
      camera={{ position: [0, 2.6, 3.8], fov: 35 }}
      gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }}
      onCreated={(state) => {
        onCaptureReady?.(() => state.gl.domElement.toDataURL('image/png'))
      }}
    >
      <Suspense fallback={null}>
        <Environment
          files="models/hdri/studio_small_08_1k.hdr"
          background={false}
          environmentIntensity={0.3}
        />
      </Suspense>
      <ambientLight intensity={0.34} />
      {/* 掠射侧光：浮雕的立体感全靠掠射光在凹槽里投影，顶光只会把起伏压平 */}
      <directionalLight
        position={[-3.0, 2.2, 2.6]}
        intensity={0.85}
        color="#fff0d8"
      />
      <directionalLight
        position={[4, 6, 4]}
        intensity={1.7}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
      <pointLight position={[-4, 2, -3]} intensity={0.8} color="#8fbfae" />
      <spotLight
        position={[0, 5, 1]}
        angle={0.6}
        penumbra={1}
        intensity={1.1}
        color="#e2d0a6"
      />
      <CarveSurface
        tool={tool}
        brushSize={brushSize}
        pattern={pattern}
        orbit={orbit}
        patternScale={patternScale}
        showGuide={showGuide}
        stone={stone}
        onUndoReady={onUndoReady}
      />
      <ContactShadows
        position={[0, -0.23, 0]}
        opacity={0.45}
        scale={6}
        blur={2.6}
        far={4}
        color="#07110e"
      />
      <OrbitControls
        enabled={orbit}
        makeDefault
        enablePan={false}
        minDistance={2.6}
        maxDistance={7}
        minPolarAngle={0.35}
        maxPolarAngle={Math.PI / 2.2}
        target={[0, 0, 0]}
      />
    </Canvas>
  )
}

