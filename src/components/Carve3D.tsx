import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
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
const LINE_GAIN = 3.4 // 线条响应增益
const LINE_FLOOR = 0.022 // 低于这个响应当作石面噪声。0.038 会连主笔画一起滤掉，金线稀稀拉拉了
const LINE_DEPTH = 0.28 // 刻到底处的深度（纹样只作浅刻导引，不抢用户刀痕）

// 分离式最大值膨胀（先横后竖）：O(n·r)，比逐像素扫邻域的 O(n·r²) 快一个量级。
// 原文物拓片上的线是连续的，而 AI 高度图里的笔画深浅不匀、常常断成虚线，
// 不做加粗的话辅助线在石面上几乎连不成形。
function dilateLine(
  line: Float32Array,
  size: number,
  passes: number,
  radius: number,
) {
  let src = line
  for (let pass = 0; pass < passes; pass += 1) {
    const tmp = new Float32Array(size * size)
    const out = new Float32Array(size * size)
    for (let y = 0; y < size; y += 1) {
      const row = y * size
      for (let x = 0; x < size; x += 1) {
        let peak = 0
        for (let k = -radius; k <= radius; k += 1) {
          const value = src[row + Math.min(size - 1, Math.max(0, x + k))]
          if (value > peak) peak = value
        }
        tmp[row + x] = peak
      }
    }
    for (let x = 0; x < size; x += 1) {
      for (let y = 0; y < size; y += 1) {
        let peak = 0
        for (let k = -radius; k <= radius; k += 1) {
          const value = tmp[Math.min(size - 1, Math.max(0, y + k)) * size + x]
          if (value > peak) peak = value
        }
        out[y * size + x] = peak
      }
    }
    src = out
  }
  return src
}

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
  // 只加粗一遍、半径 1：纹样图里的细节线本来就密，
  // 膨胀过头会把整片砚堂连成一整块金箔，反而看不出刀路走向
  const dilated = dilateLine(line, size, 1, 1)

  const out = context.createImageData(CANVAS_SIZE, CANVAS_SIZE)
  const goldR = 255
  const goldG = 206
  const goldB = 122
  const step = 1

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // 0.26 以下全部压成 0：只留响应最强的骨干线。
      // 之前几乎不过滤，整幅图的每一条细节都被当成刀路，砚堂糊成一张金箔。
      const alpha = Math.min(1, Math.max(0, (dilated[y * size + x] - 0.26) * 2.6))
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

// 动刀进度：32×32 的粗网格记录「哪一格动过刀」。
// 比统计刻痕面积便宜几个数量级，语义也更对——匠人关心的是稿子通没通，
// 不是挖掉了多少方石头。砚池本来就在高度图里，按面积算会把池子算成刻过的。
const CARVE_GRID = 32

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

// 满幅位移 0.2：基准 0.10，最深 0.00，最高石面 0.20。
// 砚边顶面在 0.21，整块面严格夹在砚台厚度之内。
const DISPLACEMENT = 0.2

// CPU 顶点位移：把高度图真正压进几何里。
// material.displacementMap 和顶点着色器注入都验证过无效（包围盒 y 跨度始终等于
// 场景倾斜量，顶点根本没动）。直接在 CPU 改 position 最可靠，
// 而且能顺带 computeVertexNormals —— 凹槽的宏观法线跟着变，
// 掠射光扫过时才有真实的体积，而不是只靠 bumpMap 的假光影。
function applyDisplacement(
  heightCanvas: HTMLCanvasElement,
  scratch: HTMLCanvasElement,
  geometry: THREE.BufferGeometry,
) {
  const gray = downscaleGray(heightCanvas, scratch, MASK_SIZE)
  if (!gray) return
  const position = geometry.attributes.position as THREE.BufferAttribute
  const uv = geometry.attributes.uv as THREE.BufferAttribute
  const last = MASK_SIZE - 1

  for (let i = 0; i < position.count; i += 1) {
    // 双线性采样：最近邻会在 2 万顶点上采出块状台阶
    const fx = uv.getX(i) * last
    const fy = (1 - uv.getY(i)) * last
    const x0 = Math.max(0, Math.min(last, Math.floor(fx)))
    const y0 = Math.max(0, Math.min(last, Math.floor(fy)))
    const x1 = Math.min(last, x0 + 1)
    const y1 = Math.min(last, y0 + 1)
    const tx = fx - x0
    const ty = fy - y0
    const top =
      gray[y0 * MASK_SIZE + x0] * (1 - tx) + gray[y0 * MASK_SIZE + x1] * tx
    const bottom =
      gray[y1 * MASK_SIZE + x0] * (1 - tx) + gray[y1 * MASK_SIZE + x1] * tx
    const height = top * (1 - ty) + bottom * ty
    position.setZ(i, -(height - 0.5) * DISPLACEMENT)
  }

  position.needsUpdate = true
  geometry.computeVertexNormals()
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
  onProgress,
}: {
  tool: CarveTool
  brushSize: number
  pattern: InkstonePattern
  orbit: boolean
  patternScale: number
  showGuide: boolean
  stone: StoneVariant
  onUndoReady?: (undo: () => void) => void
  onProgress?: (ratio: number) => void
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

  // 调试：把高度图、辅助线与场景暴露到 window，便于在浏览器里直接核对
  const scene = useThree((state) => state.scene)
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const host = window as unknown as Record<string, unknown>
    host.__heightCanvas = heightCanvas
    host.__guideCanvas = guide?.canvas ?? null
    host.__scene = scene
  })
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
    // 位移只需要承载「大凹槽」的轮廓，细刻线全交给 bumpMap 逐像素计算。
    // 之前 560×360（20 万顶点）每帧重算位移是卡顿的主因之一，降到 300×190 后
    // 顶点数只剩 1/3.5，而观感几乎无损
    () => createRawStoneCarvePlane(stone, GUIDE_WIDTH, GUIDE_HEIGHT, 300, 190),
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

  // 动刀进度网格：可刻区域内一共多少格，已经动过多少格
  const carvedCellsRef = useRef<Uint8Array>(
    new Uint8Array(CARVE_GRID * CARVE_GRID),
  )
  const validCells = useMemo(() => {
    let total = 0
    for (let gy = 0; gy < CARVE_GRID; gy += 1) {
      for (let gx = 0; gx < CARVE_GRID; gx += 1) {
        const u = (gx + 0.5) / CARVE_GRID
        const v = (gy + 0.5) / CARVE_GRID
        if (
          insideRawStone(
            stone,
            (u - 0.5) * GUIDE_WIDTH,
            (v - 0.5) * GUIDE_HEIGHT,
            0.86,
          )
        ) {
          total += 1
        }
      }
    }
    return Math.max(1, total)
  }, [stone])

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
    applyDisplacement(heightCanvas, maskScratch, geometry)
  }, [
    patternImg,
    patternScale,
    reliefScratch,
    maskScratch,
    pattern,
    stone,
    heightCanvas,
    carveMaskCanvas,
    geometry,
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

    const gridX = Math.min(
      CARVE_GRID - 1,
      Math.max(0, Math.floor(uv.x * CARVE_GRID)),
    )
    const gridY = Math.min(
      CARVE_GRID - 1,
      Math.max(0, Math.floor(uv.y * CARVE_GRID)),
    )
    carvedCellsRef.current[gridY * CARVE_GRID + gridX] = 1

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
        // 一条渐变同时编码「隆起石屑(凸) — 槽壁 — 平槽底 — 隆起石屑(凸)」。
        // 没有唇边，凹槽就只是石面上一条暗痕，不像被凿开。
        // 高度图语义：128 = 石面基准，越小越高，越大越深。
        // 关键是槽壁要陡：之前唇边到槽底横跨 0.28 的宽度做渐变，
        // 位移出来是一道缓坡，看着像被手指按下去的软泥；收窄到 0.055 才是凿断的断崖。
        const lip = isChisel ? 103 : 109
        const deep = Math.min(255, depth + 14)
        const profile = heightContext.createLinearGradient(
          0,
          -width * 1.55,
          0,
          width * 1.55,
        )
        profile.addColorStop(0, `rgba(${lip},${lip},${lip},0)`)
        profile.addColorStop(0.1, `rgba(${lip},${lip},${lip},0.9)`)
        profile.addColorStop(0.19, 'rgba(128,128,128,0)')
        profile.addColorStop(0.245, `rgba(${depth},${depth},${depth},0.98)`)
        profile.addColorStop(0.5, `rgba(${deep},${deep},${deep},1)`)
        profile.addColorStop(0.755, `rgba(${depth},${depth},${depth},0.98)`)
        profile.addColorStop(0.81, 'rgba(128,128,128,0)')
        profile.addColorStop(0.9, `rgba(${lip},${lip},${lip},0.9)`)
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
        // 隔帧重算：AO/深色是缓变量，隔帧肉眼无差，但能省一半开销。
        // 用 ===1 而不是 ===0：计数从 0 起，===0 会让「第一刀」整帧被跳过，
        // 表现为下刀瞬间什么都没发生
        if (maskFrameRef.current % 2 === 1) {
          rebuildCarveMask(heightCanvas, carveMaskCanvas, maskScratch)
          carveMaskTextureRef.current.needsUpdate = true
          applyDisplacement(heightCanvas, maskScratch, geometry)
        }
        // 进度每帧都报：1024 次累加，开销可以忽略，但数值跟手才不会让用户以为没反应
        if (onProgress && maskFrameRef.current > 0) {
          const cells = carvedCellsRef.current
          let carved = 0
          for (let i = 0; i < cells.length; i += 1) carved += cells[i]
          // 纹样只占砚堂一部分，刀子也刻不到每一格。
          // 按 45% 面积折算成 100%，否则老老实实刻满纹样进度条也才走一半
          onProgress(Math.min(1, carved / validCells / 0.45))
        }
      })
    }
  }


  // —— 撤销：每次下刀前保存高度图快照 ——
  const historyRef = useRef<ImageData[]>([])

  // 调试：把绘制入口暴露到 window，便于在浏览器里沿 UV 划刀、核对刻痕质感
  useEffect(() => {
    if (!import.meta.env.DEV) return
    ;(window as unknown as Record<string, unknown>).__paint = paint
  })

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
    applyDisplacement(heightCanvas, maskScratch, geometry)
  }, [heightCanvas, carveMaskCanvas, maskScratch, geometry])

  useEffect(() => {
    onUndoReady?.(undo)
  }, [onUndoReady, undo])

  // —— 雕刻面材质：石纹照片 + 位移高度 + 实时法线 + 刻痕深层色 + 刻痕 AO 合成在同一材质 ——
  // 「透明塑料感」的真正来源：雕刻面只有位移，没有石头的微观法线，
  // 而石沿、底座都有真实法线贴图。一个完全光滑的面 + 环境反射 = 一块有机玻璃板，
  // 刻痕画在这块板上，看起来当然不是刻在石头里。下面必须给它同一套石纹法线。
  const carveMaterial = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        // 洮河石是哑光细润的石面，不是玻璃。clearcoat 越高越像树脂
        roughness: 0.66,
        metalness: 0.02,
        clearcoat: 0.05,
        clearcoatRoughness: 0.62,
        // 兜底：低角度看过去时，单面几何的背面会被完全剔除，
        // 透出下面的底座，看起来就是「一层透明的东西」
        side: THREE.DoubleSide,
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

  // 法线必须与基色共用同一套 UV（repeat=1）。
  // 若沿用石沿的 repeat=2，石头颗粒会被缩到两倍密、并与基色错位，
  // 看上去就是「一层磨砂膜」糊在石头上，而不是石头本身。
  const carveNormal = useMemo(() => {
    const base = stonePBR.normalMap
    if (!base) return null
    const cloned = base.clone()
    cloned.wrapS = THREE.RepeatWrapping
    cloned.wrapT = THREE.RepeatWrapping
    cloned.repeat.set(1, 1)
    cloned.offset.set(0, 0)
    cloned.needsUpdate = true
    return cloned
  }, [stonePBR.normalMap])

  useEffect(() => () => carveNormal?.dispose(), [carveNormal])

  useEffect(() => () => carveMaterial.dispose(), [carveMaterial])

  useEffect(() => {
    const material = carveMaterial
    // 贴图已经统一着色到石料本色，这里不再二次叠色，否则会偏暗发灰
    material.color.set(0xffffff)
    material.map = carveMap ?? stonePBR.map
    material.roughnessMap = stonePBR.roughnessMap
    // 石头本体的微观起伏 —— 这一行是「像石头」和「像树脂」的分界
    material.normalMap = carveNormal
    material.normalScale.set(0.9, 0.9)
    // 凹凸贴图交给 GPU 用屏幕空间导数逐像素求法线：
    // 精度等于贴图分辨率，能刻画细刻线；而 512 的 CPU 法线图会把细线抹成缓坡。
    material.bumpMap = heightTexture
    // 负号：高度图里白=深，凹凸要往下凹才是「刻进去」。
    // 幅度收到 0.5：几何已经做了真实位移 + computeVertexNormals，
    // 再叠一层强 bump 会让槽壁法线翻过来，掠射光一打就成一片发白的高光
    material.bumpScale = -0.5
    // 位移不再走 material.displacementMap —— 实测在这块几何上它完全没有生效，
    // 雕刻面始终是一张纯平面（包围盒 y 跨度只有场景倾斜的 0.13，没有位移量）。
    // 改在下面 onBeforeCompile 里直接注入顶点着色器，确定性地把顶点压下去。
    material.displacementMap = null
    material.displacementScale = 0
    material.displacementBias = 0
    // 辅助线：纯白自发光 × 高强度，金色由贴图自身给出。
    // 之前用暗金 #c8a86b、强度 0.55，经色调映射后基本看不见。
    material.emissive.set('#ffffff')
    material.emissiveMap = showGuide && guide ? guide.texture : null
    material.emissiveIntensity = showGuide && guide ? 1.45 : 0

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
  vec3 deepStone = uDeepColor * (0.8 + 0.45 * carveAO);
  diffuseColor.rgb = mix(diffuseColor.rgb, deepStone, carveAmount * 0.96);
  // AO + 方向性投影作用于整个石面（不只是刻痕）：
  // 纹样浮雕、刻痕、池壁都会积影，这是「看着平」和「看着被凿开」的分界
  float occlusion = max(carveAO, carveShade);
  // occlusion 是「遮蔽程度」，越大必须越暗。
  // 原来写成 mix(1.0, occlusion, 0.7)：occlusion=1 时结果是 1.0，
  // 等于完全遮蔽反而全亮，把刻痕做成了发白的凸起，整块石头也平白暗了一半
  diffuseColor.rgb *= 1.0 - occlusion * 0.72;`,
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
    carveNormal,
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
        // 基准落在砚堂深度 0.10：砚边顶面 0.21 高出砚堂 0.11，
        // 这正是真实砚台「砚边围合、砚堂下凹」的形制。
        // 之前放在 0.25（几乎与砚边齐平），砚堂是平的、下面还空了一层，
        // 从斜角看就是一块悬在砚边上的透明薄片。
        position={[0, 0.1, 0]}
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
  onProgress,
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
  onProgress?: (ratio: number) => void
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
        onProgress={onProgress}
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

