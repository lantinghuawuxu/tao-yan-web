import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import {
  ContactShadows,
  Environment,
  OrbitControls,
  RoundedBox,
} from '@react-three/drei'
import * as THREE from 'three'
import {
  createRawStoneCarvePlane,
  createRawStoneRim,
  createShape,
  type InkstoneShape,
  type InkstonePattern,
} from './inkstoneGeometry'
import {
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

// 砚池缩放：createShape 的砚池尺寸为完整砚台设计，缩放到 2.6×1.6 雕刻面内
const POOL_SCALE = 0.68

function getCarvePools(stone: StoneVariant) {
  return createShape(STONE_SHAPE[stone]).pools.map((pool) => {
    const points = pool
      .getPoints(64)
      .map((point) => point.clone().multiplyScalar(POOL_SCALE))
    return new THREE.Shape(points)
  })
}

function roundedRectPath(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  radius: number,
) {
  const x = -width / 2
  const y = -height / 2
  const r = Math.min(radius, width / 2, height / 2)
  context.beginPath()
  context.moveTo(x + r, y)
  context.lineTo(x + width - r, y)
  context.quadraticCurveTo(x + width, y, x + width, y + r)
  context.lineTo(x + width, y + height - r)
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  context.lineTo(x + r, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - r)
  context.lineTo(x, y + r)
  context.quadraticCurveTo(x, y, x + r, y)
  context.closePath()
}

function createGuideTexture(pattern: InkstonePattern, patternScale = 1) {
  const canvas = document.createElement('canvas')
  canvas.width = CANVAS_SIZE
  canvas.height = CANVAS_SIZE
  const context = canvas.getContext('2d')
  if (!context) return null

  const scaleX = (CANVAS_SIZE / GUIDE_WIDTH) * patternScale
  const scaleY = (CANVAS_SIZE / GUIDE_HEIGHT) * patternScale
  context.setTransform(
    scaleX,
    0,
    0,
    -scaleY,
    CANVAS_SIZE / 2,
    CANVAS_SIZE / 2,
  )
  context.strokeStyle = 'rgba(199, 168, 107, 0.9)'
  context.lineWidth = 0.012
  context.lineCap = 'round'
  context.lineJoin = 'round'

  roundedRectPath(context, 2.2, 1.2, 0.18)
  context.stroke()
  roundedRectPath(context, 2.0, 1.02, 0.16)
  context.stroke()

  if (pattern === 'lotus') {
    for (let i = 0; i < 10; i += 1) {
      const angle = (i / 10) * Math.PI * 2
      context.save()
      context.translate(Math.cos(angle) * 0.85, Math.sin(angle) * 0.52)
      context.rotate(angle + Math.PI / 2)
      context.beginPath()
      context.ellipse(0, 0, 0.055, 0.13, 0, 0, Math.PI * 2)
      context.stroke()
      context.restore()
    }
  } else if (pattern === 'cloud') {
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2
      context.beginPath()
      context.arc(
        Math.cos(angle) * 0.85,
        Math.sin(angle) * 0.52,
        0.12,
        angle,
        angle + Math.PI * 1.1,
      )
      context.stroke()
    }
  } else if (pattern === 'wave') {
    for (let ring = 0; ring < 3; ring += 1) {
      const rx = 0.55 + ring * 0.15
      const ry = 0.35 + ring * 0.1
      context.beginPath()
      for (let step = 0; step <= 64; step += 1) {
        const angle = (step / 64) * Math.PI * 2
        const wobble = 1 + Math.sin(angle * 8 + ring * 1.2) * 0.025
        const x = Math.cos(angle) * rx * wobble
        const y = Math.sin(angle) * ry * wobble
        if (step === 0) context.moveTo(x, y)
        else context.lineTo(x, y)
      }
      context.closePath()
      context.stroke()
    }
  } else {
    for (let i = 0; i < 10; i += 1) {
      const angle = (i / 10) * Math.PI * 2
      context.save()
      context.translate(Math.cos(angle) * 0.85, Math.sin(angle) * 0.52)
      context.rotate(angle + Math.PI / 2)
      context.beginPath()
      context.moveTo(-0.07, -0.07)
      context.lineTo(0.07, -0.07)
      context.lineTo(0.07, 0.07)
      context.lineTo(-0.03, 0.07)
      context.lineTo(-0.03, 0)
      context.lineTo(0.02, 0)
      context.stroke()
      context.restore()
    }
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  texture.needsUpdate = true
  return texture
}

// 雕刻露出的「深层石色」——真实雕刻是削去表层、露出内部更深更润的石色
const CARVE_REVEAL: Record<StoneVariant, string> = {
  green: 'rgba(20, 44, 37, ',
  yellow: 'rgba(46, 56, 34, ',
  purple: 'rgba(56, 36, 52, ',
}

// 在砚池周围生成纹样浮雕（高度图语义：白=凹、黑=凸，已 setTransform 到世界坐标）
function drawPatternRelief(
  context: CanvasRenderingContext2D,
  pattern: InkstonePattern,
  pools: THREE.Shape[],
  stone: StoneVariant,
) {
  const pool = pools[0]
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
  const rx = (maxX - minX) / 2
  const ry = (maxY - minY) / 2

  context.lineJoin = 'round'
  context.lineCap = 'round'

  // 石膘凸起：黄膘 / 紫石在浮雕带外散布天然石膘斑块（凸起，不雕）
  if (stone === 'yellow' || stone === 'purple') {
    context.fillStyle = '#000000'
    for (let i = 0; i < 5; i += 1) {
      const angle = (i / 5) * Math.PI * 2 + 0.7
      const cx = Math.cos(angle) * (rx * 1.9 + rx * 0.5)
      const cy = Math.sin(angle) * (ry * 1.9 + ry * 0.5)
      context.beginPath()
      context.ellipse(cx, cy, rx * 0.3, ry * 0.24, angle, 0, Math.PI * 2)
      context.fill()
    }
  }

  if (pattern === 'lotus') {
    // 莲纹：8 片大花瓣（凸起）绕砚池，白勾边 + 中脊线
    const petals = 8
    for (let i = 0; i < petals; i += 1) {
      const angle = (i / petals) * Math.PI * 2 + Math.PI / petals
      const cx = Math.cos(angle) * rx * 1.45
      const cy = Math.sin(angle) * ry * 1.45
      context.save()
      context.translate(cx, cy)
      context.rotate(angle + Math.PI / 2)
      context.beginPath()
      context.ellipse(0, 0, rx * 0.32, ry * 0.28, 0, 0, Math.PI * 2)
      context.fillStyle = '#000000'
      context.fill()
      context.lineWidth = 0.02
      context.strokeStyle = '#ffffff'
      context.stroke()
      // 花瓣中脊线（阴刻，增强莲瓣立体感）
      context.beginPath()
      context.moveTo(0, -ry * 0.28)
      context.lineTo(0, ry * 0.28)
      context.lineWidth = 0.014
      context.stroke()
      context.restore()
    }
    // 外圈刻线（花瓣外缘）
    context.beginPath()
    context.ellipse(0, 0, rx * 1.72, ry * 1.72, 0, 0, Math.PI * 2)
    context.lineWidth = 0.02
    context.strokeStyle = '#ffffff'
    context.stroke()
  } else if (pattern === 'cloud') {
    // 云纹：一圈卷云（如意云头，凸起）+ 白勾边
    const count = 10
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2
      const cx = Math.cos(angle) * rx * 1.45
      const cy = Math.sin(angle) * ry * 1.45
      context.save()
      context.translate(cx, cy)
      context.rotate(angle + Math.PI / 2)
      context.beginPath()
      context.arc(0, 0, ry * 0.46, -Math.PI * 0.55, Math.PI * 0.55)
      context.arc(0, -ry * 0.16, ry * 0.3, Math.PI * 0.6, -Math.PI * 0.6, true)
      context.closePath()
      context.fillStyle = '#000000'
      context.fill()
      context.lineWidth = 0.02
      context.strokeStyle = '#ffffff'
      context.stroke()
      context.restore()
    }
  } else if (pattern === 'wave') {
    // 水波：黑色凸起环 + 白色刻线环交替（起伏的涟漪）
    for (let ring = 0; ring < 3; ring += 1) {
      const scale = 1.24 + ring * 0.26
      const ringPoints = pool.getPoints(72)
      // 黑色凸起环（粗）
      context.beginPath()
      ringPoints.forEach((point, index) => {
        const x = point.x * scale
        const y = point.y * scale
        if (index === 0) context.moveTo(x, y)
        else context.lineTo(x, y)
      })
      context.closePath()
      context.lineWidth = 0.11
      context.strokeStyle = '#000000'
      context.stroke()
      // 白色刻线环（细，叠在凸起环外缘）
      context.beginPath()
      ringPoints.forEach((point, index) => {
        const x = point.x * (scale + 0.07)
        const y = point.y * (scale + 0.07)
        if (index === 0) context.moveTo(x, y)
        else context.lineTo(x, y)
      })
      context.closePath()
      context.lineWidth = 0.03
      context.strokeStyle = '#ffffff'
      context.stroke()
    }
  } else {
    // 回纹：凸起方框带 + 白色内框刻线（「回」字嵌套）
    const outerW = Math.max(rx * 1.6, 0.74)
    const outerH = Math.max(ry * 1.6, 0.48)
    const innerW = Math.max(rx * 1.1, 0.5)
    const innerH = Math.max(ry * 1.1, 0.28)
    // 凸起方框带（黑，evenodd 挖空内部）
    context.fillStyle = '#000000'
    context.beginPath()
    context.rect(-outerW, -outerH, outerW * 2, outerH * 2)
    context.moveTo(-innerW, innerH)
    context.lineTo(-innerW, -innerH)
    context.lineTo(innerW, -innerH)
    context.lineTo(innerW, innerH)
    context.lineTo(-innerW, innerH)
    context.closePath()
    context.fill('evenodd')
    // 白色内框刻线（「回」字内圈，阴刻）
    const midW = (innerW + outerW) / 2
    const midH = (innerH + outerH) / 2
    context.beginPath()
    context.rect(-midW, -midH, midW * 2, midH * 2)
    context.lineWidth = 0.026
    context.strokeStyle = '#ffffff'
    context.stroke()
  }
}

// 从高度图实时重算法线（让凹槽有正确立体光影，这是「雕刻」与「涂鸦」的关键区别）
function updateNormalMap(
  heightCanvas: HTMLCanvasElement,
  normalCanvas: HTMLCanvasElement,
  strength = 2.2,
) {
  const heightContext = heightCanvas.getContext('2d')
  const normalContext = normalCanvas.getContext('2d')
  if (!heightContext || !normalContext) return

  const sw = heightCanvas.width
  const sh = heightCanvas.height
  const dw = normalCanvas.width
  const dh = normalCanvas.height
  const source = heightContext.getImageData(0, 0, sw, sh)
  const gray = new Float32Array(sw * sh)
  for (let i = 0; i < sw * sh; i += 1) {
    gray[i] = source.data[i * 4] / 255
  }
  const target = normalContext.createImageData(dw, dh)

  for (let y = 0; y < dh; y += 1) {
    for (let x = 0; x < dw; x += 1) {
      const sx = Math.floor((x / dw) * sw)
      const sy = Math.floor((y / dh) * sh)
      const x0 = Math.max(0, sx - 1)
      const x1 = Math.min(sw - 1, sx + 1)
      const y0 = Math.max(0, sy - 1)
      const y1 = Math.min(sh - 1, sy + 1)
      const gx =
        gray[y0 * sw + x0] -
        gray[y0 * sw + x1] +
        2 * (gray[sy * sw + x0] - gray[sy * sw + x1]) +
        gray[y1 * sw + x0] -
        gray[y1 * sw + x1]
      const gy =
        gray[y0 * sw + x0] -
        gray[y1 * sw + x0] +
        2 * (gray[y0 * sw + sx] - gray[y1 * sw + sx]) +
        gray[y0 * sw + x1] -
        gray[y1 * sw + x1]
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
}: {
  tool: CarveTool
  brushSize: number
  pattern: InkstonePattern
  orbit: boolean
  patternScale: number
  showGuide: boolean
  stone: StoneVariant
}) {
  const heightCanvas = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = CANVAS_SIZE
    canvas.height = CANVAS_SIZE
    const context = canvas.getContext('2d')
    if (context) {
      // 基底中灰：让纹样浮雕与砚池有起伏空间
      context.fillStyle = '#4f4f4f'
      context.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
      // 世界坐标变换（Y 反向，与池片 ShapeGeometry 朝向一致）
      const scaleX = CANVAS_SIZE / GUIDE_WIDTH
      const scaleY = CANVAS_SIZE / GUIDE_HEIGHT
      context.setTransform(
        scaleX,
        0,
        0,
        -scaleY,
        CANVAS_SIZE / 2,
        CANVAS_SIZE / 2,
      )
      const pools = getCarvePools(stone)
      // 砚池深坑（白=凹）
      context.fillStyle = '#ffffff'
      for (const pool of pools) {
        const points = pool.getPoints(64)
        context.beginPath()
        points.forEach((point, index) => {
          if (index === 0) context.moveTo(point.x, point.y)
          else context.lineTo(point.x, point.y)
        })
        context.closePath()
        context.fill()
      }
      // 纹样浮雕
      drawPatternRelief(context, pattern, pools, stone)
    }
    return canvas
  }, [pattern, stone])

  const colorCanvas = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = CANVAS_SIZE
    canvas.height = CANVAS_SIZE
    return canvas
  }, [])

  const heightTexture = useMemo(() => {
    const texture = new THREE.CanvasTexture(heightCanvas)
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.colorSpace = THREE.NoColorSpace
    texture.needsUpdate = true
    return texture
  }, [heightCanvas])

  const colorTexture = useMemo(() => {
    const texture = new THREE.CanvasTexture(colorCanvas)
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.colorSpace = THREE.SRGBColorSpace
    texture.needsUpdate = true
    return texture
  }, [colorCanvas])

  const guideTexture = useMemo(
    () => createGuideTexture(pattern, patternScale),
    [pattern, patternScale],
  )

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
    () => createRawStoneCarvePlane(stone, GUIDE_WIDTH, GUIDE_HEIGHT, 240, 180),
    [stone],
  )

  const poolGeometries = useMemo(
    () => getCarvePools(stone).map((pool) => new THREE.ShapeGeometry(pool)),
    [stone],
  )

  const bodyGeometry = useMemo(() => createRawStoneRim(stone), [stone])

  const stonePBR = useGreenStoneTexture(stone, 2)
  const stoneNormalScale = useMemo(() => new THREE.Vector2(0.7, 0.7), [])
  const carveNormalScale = useMemo(() => new THREE.Vector2(1.1, 1.1), [])

  const heightTextureRef = useRef(heightTexture)
  const colorTextureRef = useRef(colorTexture)
  const normalTextureRef = useRef(normalTexture)
  const drawingRef = useRef(false)
  const lastUvRef = useRef<THREE.Vector2 | null>(null)
  const normalUpdatePendingRef = useRef(false)

  useEffect(() => {
    heightTextureRef.current = heightTexture
    colorTextureRef.current = colorTexture
    normalTextureRef.current = normalTexture
  }, [heightTexture, colorTexture, normalTexture])

  useEffect(() => {
    updateNormalMap(heightCanvas, normalCanvas)
    normalTexture.needsUpdate = true
  }, [heightCanvas, normalCanvas, normalTexture])

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => heightTexture.dispose(), [heightTexture])
  useEffect(() => () => colorTexture.dispose(), [colorTexture])
  useEffect(() => () => normalTexture.dispose(), [normalTexture])
  useEffect(() => () => guideTexture?.dispose(), [guideTexture])
  useEffect(
    () => () => {
      for (const pool of poolGeometries) pool.dispose()
    },
    [poolGeometries],
  )
  useEffect(() => () => bodyGeometry.dispose(), [bodyGeometry])

  const paint = (uv: THREE.Vector2) => {
    const heightContext = heightCanvas.getContext('2d')
    const colorContext = colorCanvas.getContext('2d')
    if (!heightContext || !colorContext) return

    const x = uv.x * CANVAS_SIZE
    const y = (1 - uv.y) * CANVAS_SIZE
    const baseRadius =
      Math.max(10, brushSize * 1.2) *
      (tool === 'fine' ? 0.5 : tool === 'polish' ? 1.6 : 1)
    const baseAlpha = tool === 'polish' ? 0.12 : tool === 'fine' ? 0.4 : 0.28

    const stamp = (
      stampX: number,
      stampY: number,
      dirX: number,
      dirY: number,
      pressure: number,
    ) => {
      const radius = baseRadius * (tool === 'polish' ? 1 : pressure)
      const alpha = Math.min(1, baseAlpha * pressure)
      const angle = Math.atan2(dirY, dirX)

      heightContext.save()
      heightContext.translate(stampX, stampY)
      heightContext.rotate(angle)

      if (tool === 'chisel') {
        // 楔形 V 槽：沿刀口方向拉伸成刃，垂直方向线性渐变做出「中间深、两侧浅」的 V 形
        const length = radius * 2.2
        const width = radius * 0.5
        const vGradient = heightContext.createLinearGradient(0, -width, 0, width)
        vGradient.addColorStop(0, 'rgba(255, 255, 255, 0)')
        vGradient.addColorStop(0.5, `rgba(255, 255, 255, ${alpha})`)
        vGradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
        heightContext.fillStyle = vGradient
        heightContext.beginPath()
        heightContext.ellipse(0, 0, length, width, 0, 0, Math.PI * 2)
        heightContext.fill()
      } else if (tool === 'fine') {
        // 窄 U 槽：硬边、短刃
        const length = radius * 1.5
        const width = radius * 0.7
        const uGradient = heightContext.createRadialGradient(
          0,
          0,
          0,
          0,
          0,
          width,
        )
        uGradient.addColorStop(0, `rgba(255, 255, 255, ${alpha})`)
        uGradient.addColorStop(0.7, `rgba(255, 255, 255, ${alpha * 0.9})`)
        uGradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
        heightContext.fillStyle = uGradient
        heightContext.beginPath()
        heightContext.ellipse(0, 0, length, width, 0, 0, Math.PI * 2)
        heightContext.fill()
      } else {
        // polish 软高斯柔化
        const softGradient = heightContext.createRadialGradient(
          0,
          0,
          0,
          0,
          0,
          radius,
        )
        softGradient.addColorStop(0, `rgba(255, 255, 255, ${alpha})`)
        softGradient.addColorStop(0.4, `rgba(255, 255, 255, ${alpha * 0.6})`)
        softGradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
        heightContext.fillStyle = softGradient
        heightContext.beginPath()
        heightContext.arc(0, 0, radius, 0, Math.PI * 2)
        heightContext.fill()
      }
      heightContext.restore()

      const colorAlpha = tool === 'polish' ? 0.12 : tool === 'fine' ? 0.32 : 0.42
      const colorRadius = radius * 0.85
      const colorGradient = colorContext.createRadialGradient(
        stampX,
        stampY,
        0,
        stampX,
        stampY,
        colorRadius,
      )
      const reveal = CARVE_REVEAL[stone]
      colorGradient.addColorStop(0, `${reveal}${colorAlpha})`)
      colorGradient.addColorStop(0.65, `${reveal}${colorAlpha * 0.55})`)
      colorGradient.addColorStop(1, `${reveal}0)`)
      colorContext.fillStyle = colorGradient
      colorContext.beginPath()
      colorContext.arc(stampX, stampY, colorRadius, 0, Math.PI * 2)
      colorContext.fill()
    }

    heightContext.save()
    heightContext.globalCompositeOperation = 'lighter'
    colorContext.save()
    colorContext.globalCompositeOperation = 'source-over'

    if (lastUvRef.current) {
      const lastX = lastUvRef.current.x * CANVAS_SIZE
      const lastY = (1 - lastUvRef.current.y) * CANVAS_SIZE
      const dx = x - lastX
      const dy = y - lastY
      const distance = Math.hypot(dx, dy)
      const dirX = distance > 0 ? dx / distance : 1
      const dirY = distance > 0 ? dy / distance : 0
      // 速度压力：慢刀重、快刀轻
      const pressure = Math.max(0.6, Math.min(1.15, 1.3 - distance / 40))
      const steps = Math.max(
        1,
        Math.ceil(distance / Math.max(2, baseRadius * 0.18)),
      )
      for (let step = 1; step <= steps; step += 1) {
        const progress = step / steps
        // 顿挫：刻刀/细刻走刀时沿垂直方向轻微摆动，模拟手工刀痕
        const jitter =
          tool === 'polish' ? 0 : (Math.random() - 0.5) * baseRadius * 0.3
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

    heightContext.restore()
    colorContext.restore()
    lastUvRef.current = uv.clone()
    heightTextureRef.current.needsUpdate = true
    colorTextureRef.current.needsUpdate = true

    // 节流重算法线（每帧最多一次），让凹槽有立体光影
    if (!normalUpdatePendingRef.current) {
      normalUpdatePendingRef.current = true
      requestAnimationFrame(() => {
        normalUpdatePendingRef.current = false
        updateNormalMap(heightCanvas, normalCanvas)
        normalTextureRef.current.needsUpdate = true
      })
    }
  }

  return (
    <group rotation={[0.08, -0.25, 0.01]}>
      <mesh
        geometry={geometry}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.2, 0]}
        receiveShadow
        renderOrder={0}
        onPointerDown={(event) => {
          if (orbit) return
          event.stopPropagation()
          drawingRef.current = true
          lastUvRef.current = null
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
      >
        <meshPhysicalMaterial
          map={stonePBR.map}
          normalMap={normalTexture}
          roughnessMap={stonePBR.roughnessMap}
          normalScale={carveNormalScale}
          color="#ffffff"
          roughness={0.42}
          metalness={0.02}
          clearcoat={0.28}
          clearcoatRoughness={0.4}
          displacementMap={heightTexture}
          displacementScale={-0.2}
          emissive="#ffffff"
          emissiveMap={guideTexture ?? undefined}
          emissiveIntensity={showGuide ? 0.9 : 0}
        />
      </mesh>

      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.201, 0]}
        raycast={() => {}}
        renderOrder={1}
      >
        <planeGeometry args={[GUIDE_WIDTH, GUIDE_HEIGHT]} />
        <meshBasicMaterial
          map={colorTexture}
          transparent
          depthWrite={false}
          side={THREE.FrontSide}
        />
      </mesh>

      {/* 砚身：圆角矩形砚边（边框），中央开口露出雕刻面 */}
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
          roughness={0.32}
          metalness={0.03}
          clearcoat={0.4}
          clearcoatRoughness={0.35}
        />
      </mesh>

      {/* 砚池深色池片：沉在雕刻面下方，露出深色水窝 */}
      {poolGeometries.map((pool, index) => (
        <mesh
          key={index}
          geometry={pool}
          position={[0, 0.13, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          raycast={() => {}}
          receiveShadow
        >
          <meshPhysicalMaterial
            color="#1d2924"
            roughness={0.55}
            metalness={0.02}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}

      {/* 木质底座 */}
      <RoundedBox
        args={[2.9, 0.12, 1.9]}
        radius={0.06}
        smoothness={4}
        position={[0, -0.15, 0]}
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
}: {
  tool: CarveTool
  brushSize: number
  pattern: InkstonePattern
  orbit: boolean
  patternScale: number
  showGuide: boolean
  stone?: StoneVariant
  onCaptureReady?: (capture: () => string | null) => void
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
      <ambientLight intensity={0.4} />
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

