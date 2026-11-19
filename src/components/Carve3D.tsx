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
  insideRawStone,
  type InkstoneShape,
  type InkstonePattern,
} from './inkstoneGeometry'
import {
  STONE_CARVE,
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
const POOL_SCALE = 0.3

function getCarvePools(stone: StoneVariant) {
  return createShape(STONE_SHAPE[stone]).pools.map((pool) => {
    const points = pool
      .getPoints(64)
      .map((point) => point.clone().multiplyScalar(POOL_SCALE))
    return new THREE.Shape(points)
  })
}

// 纹样按「阴刻线雕」合成。
// 之前把整幅 AI 图当高度场用，等于把一张带明暗的照片压进石头里，
// 结果是一堆卵石状的凸块。这里改用高通滤波：只保留「比周围更暗的细线」，
// 也就是真正的刀路笔画，大面积的明暗阴影一律丢掉。
const LINE_GAIN = 3.0 // 线条响应增益
const LINE_FLOOR = 0.038 // 低于这个响应当作石面噪声（叶脉等细节会被滤掉）
const LINE_DEPTH = 0.28 // 刻到底处的深度（纹样只作浅刻导引，不抢用户刀痕）

function buildGrayField(
  image: HTMLImageElement,
  size: number,
  scale: number,
): Float32Array | null {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) return null
  context.fillStyle = '#808080'
  context.fillRect(0, 0, size, size)
  const drawSize = size * scale
  const offset = (size - drawSize) / 2
  // 轻微模糊：AI 图的锯齿边会被逐像素放大成毛刺
  context.filter = 'blur(1.2px)'
  context.drawImage(image, offset, offset, drawSize, drawSize)
  context.filter = 'none'
  const data = context.getImageData(0, 0, size, size).data
  const gray = new Float32Array(size * size)
  for (let i = 0; i < gray.length; i += 1) {
    gray[i] =
      (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) /
      255
  }
  return gray
}

// 高通：局部均值 - 自身。正值说明这个像素比周围暗，属于「线」
function lineField(gray: Float32Array, size: number, radius: number) {
  const base = blurGray(gray, size, radius)
  const out = new Float32Array(size * size)
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Math.min(
      1,
      Math.max(0, (base[i] - gray[i] - LINE_FLOOR) * LINE_GAIN),
    )
  }
  return out
}

function compositePatternRelief(
  target: CanvasRenderingContext2D,
  image: HTMLImageElement,
  scratch: HTMLCanvasElement,
  scale: number,
) {
  const scratchContext = scratch.getContext('2d')
  if (!scratchContext) return
  const size = CANVAS_SIZE
  const gray = buildGrayField(image, size, scale)
  if (!gray) return

  const line = lineField(gray, size, 8)

  scratchContext.setTransform(1, 0, 0, 1, 0, 0)
  scratchContext.clearRect(0, 0, size, size)
  const out = scratchContext.createImageData(size, size)
  for (let i = 0; i < gray.length; i += 1) {
    const depth = line[i] * LINE_DEPTH
    const gray255 = Math.round((0.5 + depth) * 255)
    out.data[i * 4] = gray255
    out.data[i * 4 + 1] = gray255
    out.data[i * 4 + 2] = gray255
    out.data[i * 4 + 3] = 255
  }
  scratchContext.putImageData(out, 0, 0)
  target.drawImage(scratch, 0, 0)
}

// 雕刻指引：与刀路同一套判据，所以金线就是「要刻的那条线」本身
function createGuideTextureSource(
  heightImage: HTMLImageElement,
  scale = 1,
) {
  const canvas = document.createElement('canvas')
  canvas.width = CANVAS_SIZE
  canvas.height = CANVAS_SIZE
  const context = canvas.getContext('2d')
  if (!context) return null

  const size = CANVAS_SIZE
  const gray = buildGrayField(heightImage, size, scale)
  if (!gray) return null
  const line = lineField(gray, size, 8)
  // 3x3 最大值膨胀：笔画本身深浅不均，直接取会断成虚线
  const dilated = new Float32Array(line.length)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let peak = 0
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = Math.min(size - 1, Math.max(0, y + dy)) * size
        for (let dx = -1; dx <= 1; dx += 1) {
          const value = line[ny + Math.min(size - 1, Math.max(0, x + dx))]
          if (value > peak) peak = value
        }
      }
      dilated[y * size + x] = peak
    }
  }

  const out = context.createImageData(CANVAS_SIZE, CANVAS_SIZE)
  const goldR = 255
  const goldG = 206
  const goldB = 122
  const step = 1

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // 0.05 以下当作石面噪声抹掉，避免整面泛金
      const alpha = Math.min(1, Math.max(0, dilated[y * size + x] * 1.25 - 0.1))
      const x0 = Math.round(x * step)
      const y0 = Math.round(y * step)
      for (let dy = 0; dy < step; dy += 1) {
        const row = (y0 + dy) * CANVAS_SIZE
        for (let dx = 0; dx < step; dx += 1) {
          const offset = (row + x0 + dx) * 4
          // emissiveMap 只乘 RGB、忽略 alpha，RGB 必须按 alpha 预乘
          out.data[offset] = Math.round(goldR * alpha)
          out.data[offset + 1] = Math.round(goldG * alpha)
          out.data[offset + 2] = Math.round(goldB * alpha)
          out.data[offset + 3] = 255
        }
      }
    }
  }
  context.putImageData(out, 0, 0)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  texture.needsUpdate = true
  return { texture, canvas }
}

// 遮罩与法线只需要「大形」，不需要 1024² 逐像素。
// 之前每帧在 1024² 上跑 36 次邻域采样（约 3700 万次内存读取），这是雕刻卡顿的根源。
// 现在先用 drawImage 让 GPU 做双线性降采样，再只在小图上跑循环。
const MASK_SIZE = 256

function downscaleGray(
  source: HTMLCanvasElement,
  scratch: HTMLCanvasElement,
  size: number,
) {
  const context = scratch.getContext('2d')
  if (!context) return null
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.clearRect(0, 0, size, size)
  // 点采样：均值降采样会把细刻线抹成缓坡，整片法线被带偏
  context.imageSmoothingEnabled = false
  context.drawImage(source, 0, 0, size, size)
  context.imageSmoothingEnabled = true
  const image = context.getImageData(0, 0, size, size)
  const gray = new Float32Array(size * size)
  for (let i = 0; i < gray.length; i += 1) {
    gray[i] = image.data[i * 4] / 255
  }
  return gray
}

// 分离式一维盒式模糊：O(n)，比「每像素扫一遍邻域」快两个数量级
function blurGray(gray: Float32Array, size: number, radius: number) {
  const temp = new Float32Array(size * size)
  const out = new Float32Array(size * size)
  const window = radius * 2 + 1

  for (let y = 0; y < size; y += 1) {
    const row = y * size
    let sum = 0
    for (let k = -radius; k <= radius; k += 1) {
      sum += gray[row + Math.min(size - 1, Math.max(0, k))]
    }
    for (let x = 0; x < size; x += 1) {
      temp[row + x] = sum / window
      sum +=
        gray[row + Math.min(size - 1, x + radius + 1)] -
        gray[row + Math.max(0, x - radius)]
    }
  }

  for (let x = 0; x < size; x += 1) {
    let sum = 0
    for (let k = -radius; k <= radius; k += 1) {
      sum += temp[Math.min(size - 1, Math.max(0, k)) * size + x]
    }
    for (let y = 0; y < size; y += 1) {
      out[y * size + x] = sum / window
      sum +=
        temp[Math.min(size - 1, y + radius + 1) * size + x] -
        temp[Math.max(0, y - radius) * size + x]
    }
  }
  return out
}

// R = 刻痕深度（凿掉多少）
// G = 遮蔽 AO（凹处积影）
// B = 方向性阴影（沿光方向被更高石面挡住的投影）
function rebuildCarveMask(
  heightCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
  scratch: HTMLCanvasElement,
) {
  const maskContext = maskCanvas.getContext('2d')
  if (!maskContext) return
  const size = MASK_SIZE
  const gray = downscaleGray(heightCanvas, scratch, size)
  if (!gray) return
  const soft = blurGray(gray, size, 4)
  const target = maskContext.createImageData(size, size)

  // 光从左上打来（俯视 UV 空间），与场景里的掠射侧光方向一致
  const lx = -0.8
  const ly = -0.6

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x
      const height = gray[index]
      // 高度图语义：中灰 0.5 = 石面基准，越大越深
      const carve = Math.min(1, Math.max(0, (height - 0.52) * 2.4))
      const bowl = Math.min(1, Math.max(0, (height - soft[index]) * 3.2))

      // 沿光线方向往外踩点：如果踩到更高的石面（灰度更小），这里就在阴影里。
      // 这是让凹槽有真实投影、而不是只靠贴图变暗的关键。
      let horizon = 0
      for (let step = 2; step <= 9; step += 1) {
        const sx = Math.min(size - 1, Math.max(0, Math.round(x + lx * step)))
        const sy = Math.min(size - 1, Math.max(0, Math.round(y + ly * step)))
        const blocked = (height - gray[sy * size + sx]) / step
        if (blocked > horizon) horizon = blocked
      }
      const shade = Math.min(1, Math.max(0, horizon * 7))
      const ao = Math.min(1, Math.max(bowl, shade * 0.95))

      const offset = index * 4
      target.data[offset] = Math.round(carve * 255)
      target.data[offset + 1] = Math.round(ao * 255)
      target.data[offset + 2] = Math.round(shade * 255)
      target.data[offset + 3] = 255
    }
  }
  maskContext.putImageData(target, 0, 0)
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
  // 遮罩按 MASK_SIZE 计算，画布必须同尺寸：
  // 之前画布是 1024 而只往左上角写了 256×256，其余全透明，
  // 采样出来恒为 0，等于刻痕遮罩从来没生效。
  const carveMaskCanvas = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = MASK_SIZE
    canvas.height = MASK_SIZE
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

  // 降采样用的暂存画布（遮罩 256），复用避免每帧分配
  const reliefScratch = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = CANVAS_SIZE
    canvas.height = CANVAS_SIZE
    return canvas
  }, [])

  const maskScratch = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = MASK_SIZE
    canvas.height = MASK_SIZE
    return canvas
  }, [])

  const geometry = useMemo(
    () => createRawStoneCarvePlane(stone, GUIDE_WIDTH, GUIDE_HEIGHT, 560, 360),
    [stone],
  )

  const bodyGeometry = useMemo(() => createRawStoneRim(stone), [stone])
  const baseGeometry = useMemo(() => createRawStoneBase(stone), [stone])

  const stonePBR = useGreenStoneTexture(stone, 2)
  const stoneNormalScale = useMemo(() => new THREE.Vector2(0.7, 0.7), [])

  const heightTextureRef = useRef(heightTexture)
  const carveMaskTextureRef = useRef(carveMaskTexture)
  const drawingRef = useRef(false)
  const lastUvRef = useRef<THREE.Vector2 | null>(null)
  const normalUpdatePendingRef = useRef(false)
  const maskFrameRef = useRef(0)

  useEffect(() => {
    heightTextureRef.current = heightTexture
    carveMaskTextureRef.current = carveMaskTexture
  }, [heightTexture, carveMaskTexture])

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

    // 2. 纹样浮雕（浅浮雕）；图未就绪时保持纯石面，绝不回退成程序化线条
    if (patternImg) {
      compositePatternRelief(
        context,
        patternImg,
        reliefScratch,
        patternScale,
      )
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
    rebuildCarveMask(heightCanvas, carveMaskCanvas, maskScratch)
    carveMaskTextureRef.current.needsUpdate = true
  }, [
    patternImg,
    patternScale,
    reliefScratch,
    maskScratch,
    pattern,
    stone,
    heightCanvas,
    carveMaskCanvas,
  ])

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => heightTexture.dispose(), [heightTexture])
  useEffect(() => () => carveMaskTexture.dispose(), [carveMaskTexture])
  useEffect(() => () => bodyGeometry.dispose(), [bodyGeometry])
  useEffect(() => () => baseGeometry.dispose(), [baseGeometry])

  const paint = (uv: THREE.Vector2) => {
    const heightContext = heightCanvas.getContext('2d')
    if (!heightContext) return
    // 关键：重绘砚池时给高度图设过世界坐标变换（放大 394 倍）。
    // 不重置的话，这里所有笔画都会落到画布外几万像素处，看起来就是「刻不动」。
    heightContext.setTransform(1, 0, 0, 1, 0, 0)
    // 只允许在砚堂（石沿洞口以内）下刀：
    // 越过边缘会让雕刻面在石沿下方撕开，露出一道刺眼的缺口
    const worldX = (uv.x - 0.5) * GUIDE_WIDTH
    const worldY = (uv.y - 0.5) * GUIDE_HEIGHT
    if (!insideRawStone(stone, worldX, worldY, 0.86)) return

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

      if (tool === 'polish') {
        // 打磨：以石面基准灰柔和回填，压掉毛刺、保留大起伏
        const softGradient = heightContext.createRadialGradient(0, 0, 0, 0, 0, radius)
        softGradient.addColorStop(0, 'rgba(128,128,128,0.95)')
        softGradient.addColorStop(0.6, 'rgba(130,130,130,0.55)')
        softGradient.addColorStop(1, 'rgba(132,132,132,0)')
        heightContext.fillStyle = softGradient
        heightContext.beginPath()
        heightContext.arc(0, 0, radius, 0, Math.PI * 2)
        heightContext.fill()
      } else {
        const isChisel = tool === 'chisel'
        // 刀口尺寸：凿子宽而短，细刻窄而长
        const length = radius * (isChisel ? 2.4 : 1.8)
        const width = radius * (isChisel ? 0.62 : 0.8)
        // 一条渐变同时编码「隆起石屑(凸) — 槽 — 隆起石屑(凸)」。
        // 没有这两道唇边，凹槽就只是石面上一条暗痕，不像被凿开。
        // 高度图语义：128 = 石面基准，越小越高，越大越深。
        const lip = isChisel ? 103 : 109
        const deep = Math.min(255, depth + 14)
        const profile = heightContext.createLinearGradient(
          0,
          -width * 1.55,
          0,
          width * 1.55,
        )
        profile.addColorStop(0, `rgba(${lip},${lip},${lip},0)`)
        profile.addColorStop(0.12, `rgba(${lip},${lip},${lip},0.82)`)
        profile.addColorStop(0.27, 'rgba(128,128,128,0)')
        profile.addColorStop(0.4, `rgba(${depth},${depth},${depth},0.94)`)
        profile.addColorStop(0.5, `rgba(${deep},${deep},${deep},1)`)
        profile.addColorStop(0.6, `rgba(${depth},${depth},${depth},0.94)`)
        profile.addColorStop(0.73, 'rgba(128,128,128,0)')
        profile.addColorStop(0.88, `rgba(${lip},${lip},${lip},0.82)`)
        profile.addColorStop(1, `rgba(${lip},${lip},${lip},0)`)
        heightContext.fillStyle = profile
        heightContext.beginPath()
        heightContext.ellipse(0, 0, length, width * 1.55, 0, 0, Math.PI * 2)
        heightContext.fill()

        // 刀痕：沿走刀方向在槽底压出几道深浅不一的平行刻线。
        // 这是「手凿」与「喷枪」最直观的差别——槽底永远不是光滑的。
        const lines = isChisel ? 3 : 2
        for (let i = 0; i < lines; i += 1) {
          const lineY = (i - (lines - 1) / 2) * width * 0.44
          const tone = Math.max(0, Math.min(255, depth + (i % 2 === 0 ? 16 : -12)))
          heightContext.strokeStyle = `rgba(${tone},${tone},${tone},0.3)`
          heightContext.lineWidth = Math.max(1, width * 0.15)
          heightContext.beginPath()
          heightContext.moveTo(-length * 0.66, lineY)
          heightContext.lineTo(
            length * 0.66,
            lineY + (Math.random() - 0.5) * width * 0.22,
          )
          heightContext.stroke()
        }

        // 崩口：石质脆性剥落，在槽沿崩掉几处小口，避免边缘过于「塑料圆润」
        const chipCount = isChisel ? 3 : 2
        for (let i = 0; i < chipCount; i += 1) {
          const side = i % 2 === 0 ? 1 : -1
          const chipX = (Math.random() - 0.5) * length * 1.5
          const chipY = side * width * (0.95 + Math.random() * 0.35)
          const chipR = width * (0.1 + Math.random() * 0.16)
          const tone = Math.round(128 + (depth - 128) * (0.35 + Math.random() * 0.3))
          heightContext.fillStyle = `rgba(${tone},${tone},${tone},0.9)`
          heightContext.beginPath()
          heightContext.ellipse(chipX, chipY, chipR * 1.4, chipR, 0, 0, Math.PI * 2)
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
      // 用黑色往上盖，而不是 destination-out：
      // emissiveMap 只读 RGB、忽略 alpha，只把 alpha 擦掉的话金线不会消失。
      const fade = guideContext.createRadialGradient(
        x,
        y,
        0,
        x,
        y,
        baseRadius * 1.3,
      )
      fade.addColorStop(0, 'rgba(0,0,0,1)')
      fade.addColorStop(0.7, 'rgba(0,0,0,0.95)')
      fade.addColorStop(1, 'rgba(0,0,0,0)')
      guideContext.save()
      guideContext.globalCompositeOperation = 'source-over'
      guideContext.fillStyle = fade
      guideContext.beginPath()
      guideContext.arc(x, y, baseRadius * 1.3, 0, Math.PI * 2)
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
        // 刻痕遮罩隔帧重算：AO/深色是缓变量，隔帧更新肉眼看不出差别，
        // 但能把每帧的降采样 + 模糊开销砍掉一半（这是 p95 抖动的来源）
        maskFrameRef.current += 1
        if (maskFrameRef.current % 2 === 0) {
          rebuildCarveMask(heightCanvas, carveMaskCanvas, maskScratch)
          carveMaskTextureRef.current.needsUpdate = true
        }
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
    rebuildCarveMask(heightCanvas, carveMaskCanvas, maskScratch)
    carveMaskTextureRef.current.needsUpdate = true
  }, [heightCanvas, carveMaskCanvas, maskScratch])

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
    // 凹凸贴图交给 GPU 用屏幕空间导数逐像素求法线：
    // 精度等于贴图分辨率，能刻画细刻线；而 512 的 CPU 法线图会把细线抹成缓坡。
    material.bumpMap = heightTexture
    // 负号：高度图里白=深，凹凸要往下凹才是「刻进去」
    material.bumpScale = -1.15
    material.displacementMap = heightTexture
    // 全部向下位移：石面基准比石沿低约 0.11，砚堂低于砚边的真实形制
    material.displacementScale = -0.24
    material.displacementBias = 0
    material.emissive.set('#c8a86b')
    material.emissiveMap = showGuide && guide ? guide.texture : null
    material.emissiveIntensity = showGuide && guide ? 0.55 : 0

    const deepColor = new THREE.Color(STONE_CARVE[stone])
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
  float carveShade = carveSample.b;
  // 凹处露出凿开后的新鲜石色（略深、略饱和，但仍是石头）
  vec3 deepStone = uDeepColor * (0.85 + 0.5 * carveAO);
  diffuseColor.rgb = mix(diffuseColor.rgb, deepStone, carveAmount * 0.92);
  // AO + 方向性投影作用于整个石面（不只是刻痕）：
  // 纹样浮雕、刻痕、池壁都会积影，这是「看着平」和「看着被凿开」的分界
  float occlusion = max(carveAO, carveShade);
  diffuseColor.rgb *= mix(1.0, occlusion, 0.5);`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
  // 凿开的石面是崩口麻面，比打磨过的砚堂更涩；凹处高光被压住
  roughnessFactor = mix(roughnessFactor, 0.82, carveAmount * 0.8);`,
        )
    }
    material.needsUpdate = true
  }, [
    carveMaterial,
    carveMap,
    stonePBR,
    heightTexture,
    carveMaskTexture,
    guide,
    showGuide,
    stone,
  ])


  return (
    <group rotation={[0.08, -0.25, 0.01]}>
      {/* 雕刻面：位移 + 实时法线 + 石纹照片 + 刻痕混合，是「石头本身被凿开」而不是「石头上画了东西」 */}
      <mesh
        geometry={geometry}
        material={carveMaterial}
        rotation={[-Math.PI / 2, 0, 0]}
        // 抬高 0.04：最深处(0.25-0.24=0.01)仍高于石沿底面(-0.03)，
        // 否则雕刻面会在石沿底下探出来，沿边缘露出一排锯齿
        position={[0, 0.25, 0]}
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
        // 必须整层落在石沿底面(-0.03)之下：
        // 只要高出哪怕一点，底座顶面就会插进石沿环内，沿内壁切出一排锯齿
        position={[0, -0.055, 0]}
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
      camera={{ position: [0, 2.15, 3.15], fov: 35 }}
      gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true, toneMappingExposure: 1.3 }}
      onCreated={(state) => {
        onCaptureReady?.(() => state.gl.domElement.toDataURL('image/png'))
      }}
    >
      <Suspense fallback={null}>
        <Environment
          files="models/hdri/studio_small_08_1k.hdr"
          background={false}
          environmentIntensity={0.2}
        />
      </Suspense>
      <ambientLight intensity={0.55} />
      {/* 柔和补光：砚堂是打磨面，不该沉在黑里 */}
      <directionalLight position={[1.4, 4.2, 2.6]} intensity={0.55} />
      {/* 掠射侧光：浮雕的立体感全靠掠射光在凹槽里投影，顶光只会把起伏压平 */}
      <directionalLight
        position={[-3.4, 1.05, 2.2]}
        intensity={1.45}
        color="#fff2dd"
      />
      <directionalLight
        position={[4, 6, 4]}
        intensity={1.6}
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
        minDistance={2.2}
        maxDistance={7}
        minPolarAngle={0.35}
        maxPolarAngle={Math.PI / 2.2}
        target={[0, 0, 0]}
      />
    </Canvas>
  )
}

