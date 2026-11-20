import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import {
  ContactShadows,
  Environment,
  OrbitControls,
  RoundedBox,
} from '@react-three/drei'
import * as THREE from 'three'
import { carveSound } from './carveSound'
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
    const points = pool.getPoints(64).map((point) => {
      const scaled = point.clone().multiplyScalar(POOL_SCALE)
      // 砚池挪到砚堂前端。器型数据里池子是居中的，而纹样也铺满整堂，
      // 结果池子正好压在莲心上，把纹样从中间打断——
      // 真实随形砚的池一定在一端，砚堂留给纹样。
      scaled.y -= 0.4
      return scaled
    })
    return new THREE.Shape(points)
  })
}

// 纹样按「阴刻线雕」合成。
//
// 这里踩过两次坑，都值得写下来：
//   1) 把整幅 AI 图当高度场用 —— 等于把一张带明暗的照片压进石头，出来是卵石状凸块。
//   2) 改用高通滤波抽「线」—— 技术上对了，但原图是带叶脉、花蕊、石面阴影的
//      浮雕渲染图，高通把每一根叶脉都当成一刀。结果描稿是一张比石纹还花的细密网格，
//      线细到 2~3px、密到线间距小于刀宽，人根本没法照着刻：
//      下刀就压掉三四根线，看上去就是「周围一大片都没了」。
//
// 真实匠人拿到拓片会先「取势」：只描外轮廓和大转折，叶脉这类纹理直接舍弃。
// 下面三步就是把这个判断做成算法：
//   1) 降到 320 提取 —— 1024 下 3.2 个像素合成一格，细支脉在这一级被平均掉
//   2) 梯度 + 非极大值抑制 —— 每条边上只剩 1 个像素，得到真正的「线」
//   3) 按梯度强度取最强的 38% —— 密度与纹样图无关，换哪张图都一样稀疏
//
// 第 2 步是关键。上一版用的是「局部均值减自身」的高通：浮雕图里的形体是缓坡过渡，
// 高通会在整个坡面上都给正值，出来是一圈宽带而不是一条线；阈值一卡，
// 宽带就断成一串粗块 —— 描稿变成一圈糊在石头上的白斑，比没有描稿更糟。
// 梯度只认「变化最快的位置」，再沿梯度方向做非极大值抑制，
// 每条轮廓才塌缩成一根笔画，刀能跟得住。
const STROKE_SIZE = 320
const STROKE_SMOOTH = 3
const STROKE_FLOOR = 0.05
const STROKE_KEEP = 0.3
// 描稿线在 1024 画布上的宽度：放大后膨胀 1 遍半径 2 再糊 1px，
// 落下来约 7px（按 200mm 砚宽折算 ≈1.4mm），是毛笔细线画在石面上的真实粗细，
// 比刀宽略宽一点点 —— 刀压上去刚好把线吃掉，两边不留残线
const STROKE_PAD = 2
// 预置凹深：只留一层几不可见的「墨渗进石纹」。
// 原本 0.28（浅浮雕）会让砚堂一打开就已经有整套凹槽，用户必然以为「已经刻好了」。
// 真实工序是反的：石面是平的，描稿在石上，刻一刀才凹一块。
const LINE_DEPTH = 0.05

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

// Sobel 梯度 + 非极大值抑制：把每条轮廓塌缩成 1 像素宽。
// 这是简化版 Canny 的核心两步，去掉双阈值滞后（我们用百分位截断代替）。
function strokeEdgeField(gray: Float32Array, size: number) {
  const gx = new Float32Array(size * size)
  const gy = new Float32Array(size * size)
  const mag = new Float32Array(size * size)

  for (let y = 1; y < size - 1; y += 1) {
    const row = y * size
    for (let x = 1; x < size - 1; x += 1) {
      const i = row + x
      const tl = gray[i - size - 1]
      const tc = gray[i - size]
      const tr = gray[i - size + 1]
      const ml = gray[i - 1]
      const mr = gray[i + 1]
      const bl = gray[i + size - 1]
      const bc = gray[i + size]
      const br = gray[i + size + 1]
      const dx = tr - tl + 2 * (mr - ml) + (br - bl)
      const dy = bl - tl + 2 * (bc - tc) + (br - tr)
      gx[i] = dx
      gy[i] = dy
      mag[i] = Math.sqrt(dx * dx + dy * dy)
    }
  }

  const thin = new Float32Array(size * size)
  for (let y = 1; y < size - 1; y += 1) {
    const row = y * size
    for (let x = 1; x < size - 1; x += 1) {
      const i = row + x
      const value = mag[i]
      if (value <= 0) continue
      const ax = Math.abs(gx[i])
      const ay = Math.abs(gy[i])
      let before: number
      let after: number
      // 沿梯度方向取前后两个邻居比较。梯度方向只量化成水平/垂直/两条对角，
      // 对「要一条看得懂的线」这个用途，插值精度没有意义
      if (ax > ay * 2.414) {
        before = mag[i - 1]
        after = mag[i + 1]
      } else if (ay > ax * 2.414) {
        before = mag[i - size]
        after = mag[i + size]
      } else if (gx[i] * gy[i] > 0) {
        before = mag[i - size - 1]
        after = mag[i + size + 1]
      } else {
        before = mag[i - size + 1]
        after = mag[i + size - 1]
      }
      if (value >= before && value >= after) thin[i] = value
    }
  }
  return thin
}

// 描稿笔画规划：低分辨率取势 → 细线化 → 按强度截断。
// 输出一张 320×320 的二值笔画图，密度由 STROKE_KEEP 控制，与纹样图繁简无关。
function planStrokes(image: HTMLImageElement, scale: number) {
  const size = STROKE_SIZE
  const gray = buildGrayField(image, size, scale)
  if (!gray) return null

  // 先糊掉叶脉级细节：320 上半径 3 的盒式模糊等于 1024 下 10px，
  // 花瓣里的支脉在这一步就被抹平了，只剩大形的轮廓还有梯度
  const smooth = blurGray(gray, size, STROKE_SMOOTH)
  const thin = strokeEdgeField(smooth, size)

  // Sobel 满量程约 4（灰度 0~1），归一化到 0~1 才能和阈值放到同一把尺子上
  const NORM = 4
  const histogram = new Uint32Array(256)
  let counted = 0
  for (let i = 0; i < thin.length; i += 1) {
    if (thin[i] <= STROKE_FLOOR) continue
    const bin = Math.min(255, Math.floor((thin[i] / NORM) * 255))
    histogram[bin] += 1
    counted += 1
  }

  // 百分位截断定「强阈值」。
  // 用直方图而不是排序 —— 10 万个浮点排序要一两百毫秒，直方图是 O(n)
  let strongThreshold = 0.12
  if (counted > 0) {
    const wanted = Math.max(1, Math.round(counted * STROKE_KEEP))
    let accumulated = 0
    for (let bin = 255; bin >= 0; bin -= 1) {
      accumulated += histogram[bin]
      if (accumulated >= wanted) {
        strongThreshold = Math.max(0.12, bin / 255)
        break
      }
    }
  }
  // 阈值统一换算回 Sobel 的原始量纲，后面在 1024 上直接比
  return {
    magnitude: thin,
    size,
    strong: strongThreshold * NORM,
    weak: strongThreshold * 0.45 * NORM,
  }
}

// 把幅值图上采样到 1024 再做滞后阈值，得到最终的描稿强度图。
//
// 为什么不直接在 320 上二值化再放大：320 的一个像素等于 1024 的 3.2 个，
// 放大出来的线是一节一节的台阶，阈值一压又变成锯齿，
// 屏幕上看着像手抖画出来的波浪线。先把「软」的幅值图插值放大，
// 阈值留到 1024 上再下刀，线的抖动就被插值抹平了，轮廓是平滑的曲线。
function strokeCanvasFromPlan(plan: {
  magnitude: Float32Array
  size: number
  strong: number
  weak: number
}) {
  const size = CANVAS_SIZE
  const small = document.createElement('canvas')
  small.width = plan.size
  small.height = plan.size
  const smallContext = small.getContext('2d')
  if (!smallContext) return null
  const smallImage = smallContext.createImageData(plan.size, plan.size)
  for (let i = 0; i < plan.magnitude.length; i += 1) {
    const value = Math.min(255, Math.round((plan.magnitude[i] / 4) * 255))
    smallImage.data[i * 4] = value
    smallImage.data[i * 4 + 1] = value
    smallImage.data[i * 4 + 2] = value
    smallImage.data[i * 4 + 3] = 255
  }
  smallContext.putImageData(smallImage, 0, 0)

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) return null
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(small, 0, 0, size, size)

  const data = context.getImageData(0, 0, size, size)
  const field = new Float32Array(size * size)
  for (let i = 0; i < field.length; i += 1) {
    field[i] = (data.data[i * 4] / 255) * 4
  }

  // 双阈值滞后（Canny 的第三步）。单阈值的问题是「断」：
  // 同一根轮廓上亮一段暗一段，切下去就是一条虚线，
  // 用户根本不知道该往哪走 —— 断线其实比密线更难刻。
  // 这里让弱像素只要和强像素连通就一起保留，轮廓自己会连成一整根。
  const state = new Uint8Array(size * size) // 0=丢弃 1=候选 2=保留
  const stack: number[] = []
  for (let i = 0; i < field.length; i += 1) {
    const value = field[i]
    if (value >= plan.strong) {
      state[i] = 2
      stack.push(i)
    } else if (value >= plan.weak) {
      state[i] = 1
    }
  }
  while (stack.length) {
    const index = stack.pop() as number
    const x = index % size
    const y = (index - x) / size
    for (let dy = -1; dy <= 1; dy += 1) {
      const ny = y + dy
      if (ny < 0 || ny >= size) continue
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx
        if (nx < 0 || nx >= size) continue
        const next = ny * size + nx
        if (state[next] === 1) {
          state[next] = 2
          stack.push(next)
        }
      }
    }
  }

  const mask = new Float32Array(size * size)
  for (let i = 0; i < mask.length; i += 1) {
    mask[i] = state[i] === 2 ? 1 : 0
  }

  // 加粗到 ~7px：1px 的线在斜视角下会被抗锯齿糊没，
  // 而刀压上去要恰好把线吃掉，两边不留残线
  const wide = blurGray(dilateLine(mask, size, 1, STROKE_PAD), size, 1)
  for (let i = 0; i < wide.length; i += 1) {
    const value = Math.round(Math.min(1, wide[i] * 1.35) * 255)
    data.data[i * 4] = value
    data.data[i * 4 + 1] = value
    data.data[i * 4 + 2] = value
    data.data[i * 4 + 3] = 255
  }
  context.putImageData(data, 0, 0)
  return { canvas, field: wide }
}

// 预置凹深：把描稿强度压成一层几乎看不见的浅痕，
// 让描稿看起来是「墨渗进了石纹里」，而不是浮在石头表面的一层贴纸。
function compositePatternRelief(
  target: CanvasRenderingContext2D,
  guide: { canvas: HTMLCanvasElement; field: Float32Array },
) {
  const scratch = document.createElement('canvas')
  scratch.width = CANVAS_SIZE
  scratch.height = CANVAS_SIZE
  const context = scratch.getContext('2d')
  if (!context) return
  const data = context.createImageData(CANVAS_SIZE, CANVAS_SIZE)
  // 直接用强度场算灰度，比再采样一次画布更准，也不会被 8bit 量化卡出断点
  for (let i = 0; i < guide.field.length; i += 1) {
    // 128 = 石面基准，往上加一点点就是「深」
    const value = Math.round((0.5 + guide.field[i] * LINE_DEPTH) * 255)
    data.data[i * 4] = value
    data.data[i * 4 + 1] = value
    data.data[i * 4 + 2] = value
    data.data[i * 4 + 3] = 255
  }
  context.putImageData(data, 0, 0)

  target.save()
  target.setTransform(1, 0, 0, 1, 0, 0)
  target.drawImage(scratch, 0, 0)
  target.restore()
}

// 描稿色：真实匠人描稿决不会用「发光的金线」。
// 深色石头（鹦哥绿、羊肝紫）用朱砂，浅色石头（黄膘）用墨——
// 这是同一套对比度逻辑，也是这几块石头在工坊里实际的处理方式。
const GUIDE_INK: Record<StoneVariant, string> = {
  green: '#e04a2c',
  // 黄膘石本身偏亮偏黄，墨要压到近黑才拉得开明度差；
  // 之前 #241a10 明度还够亮，和浮雕的凹槽阴影糊在一起
  yellow: '#140d06',
  purple: '#ec5238',
}

// 遮罩与法线只需要「大形」，不需要 1024² 逐像素。
// 之前每帧在 1024² 上跑 36 次邻域采样（约 3700 万次内存读取），这是雕刻卡顿的根源。
// 现在先用 drawImage 让 GPU 做降采样，再只在小图上跑循环。
// 256 → 384：刀口细到 5~6px 时，256 上一次点采样只命中 1 个像素，
// 相邻行时有时无，刻痕遮罩就变成一条虚线，AO 跟着一块一块地闪。
// 384 上同样的刀有 2 个像素宽，连续了；代价是每帧多 1.25 倍像素，可以接受。
const MASK_SIZE = 384

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
  // 模糊半径 4 在 384 上等于 1024 下的 10px，再加上「往外踩 9 步」的
  // 方向性投影（≈24px），一圈刻痕外围能糊出 30 多像素的暗带。
  // 一条 6px 的刀痕被包在 60px 的黑圈里，看起来就是「一雕刻周围一大片都没了」。
  // 阴影要贴着刀口走：模糊 2、地平线只踩 4 步，暗部才落回刻痕本身。
  const soft = blurGray(gray, size, 2)
  const carveField = new Float32Array(size * size)
  const aoField = new Float32Array(size * size)
  const shadeField = new Float32Array(size * size)

  // 光从左上打来（俯视 UV 空间），与场景里的掠射侧光方向一致
  const lx = -0.8
  const ly = -0.6

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x
      const height = gray[index]
      // 高度图语义：中灰 0.5 = 石面基准，越大越深。
      // 阈值 0.535 + 增益 7：刀口确实只有 0.70 左右（细刀浅刻），
      // 按原来的 (h-0.52)*3 只算出 0.56 的「刻痕量」，
      // 而深色石与刻开的新石色本来就只差一档，混 56% 等于没混 ——
      // 槽底看不出是凿开的石头，只能看见两条被照亮的高光边。
      // 这里把 0.535~0.68 这一小段直接拉满，浅浅一道刀也能显出石头的里子
      const carve = Math.min(1, Math.max(0, (height - 0.535) * 7))
      const bowl = Math.min(1, Math.max(0, (height - soft[index]) * 2.2))

      // 沿光线方向往外踩点：如果踩到更高的石面（灰度更小），这里就在阴影里。
      // 这是让凹槽有真实投影、而不是只靠贴图变暗的关键。
      let horizon = 0
      for (let step = 2; step <= 4; step += 1) {
        const sx = Math.min(size - 1, Math.max(0, Math.round(x + lx * step)))
        const sy = Math.min(size - 1, Math.max(0, Math.round(y + ly * step)))
        const blocked = (height - gray[sy * size + sx]) / step
        if (blocked > horizon) horizon = blocked
      }
      const shade = Math.min(1, Math.max(0, horizon * 5))
      const ao = Math.min(1, Math.max(bowl, shade * 0.9))

      carveField[index] = carve
      aoField[index] = ao
      shadeField[index] = shade
    }
  }

  // 刻痕量做一次 3×3 最大值膨胀。
  // 细刀只有 5~6px 宽的槽，在 384 上只落到 2 个像素里 ——
  // 「被凿掉」的暗部缩到屏幕上就剩一根头发丝，剩下的全是几何 V 形的高光边，
  // 看上去像划了一道白印子，不像凿掉了一层石头。
  // 膨胀一圈让暗部盖住整个刀口，才和位移出来的 V 形对得上。
  const carveWide = dilateLine(carveField, size, 1, 1)
  const target = maskContext.createImageData(size, size)
  for (let index = 0; index < carveWide.length; index += 1) {
    const offset = index * 4
    target.data[offset] = Math.round(carveWide[index] * 255)
    target.data[offset + 1] = Math.round(aoField[index] * 255)
    target.data[offset + 2] = Math.round(shadeField[index] * 255)
    target.data[offset + 3] = 255
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

  // 描稿笔画规划：先取势（只留大形边界），再决定疏密。
  // 这一步是整个雕刻手感的地基 —— 稿子稀，刀才跟得上；稿子密，怎么刻都是糊。
  const strokePlan = useMemo(
    () => (patternImg ? planStrokes(patternImg, patternScale) : null),
    [patternImg, patternScale],
  )

  // 强度图（320 规划 → 放大到 1024 再做滞后阈值），浮雕与描稿共用
  const strokeCanvas = useMemo(
    () => (strokePlan ? strokeCanvasFromPlan(strokePlan) : null),
    [strokePlan],
  )

  // 描稿画布必须是可写的一份拷贝：刻过的位置要涂掉。
  // 砚池是盛水的深坑，不该在里面描稿，也不该刻——
  // 在描稿图上按池子轮廓挖掉，用户就不会看见「池子里也画了线」而想往里下刀。
  const guide = useMemo(() => {
    if (!strokeCanvas) return null
    const canvas = document.createElement('canvas')
    canvas.width = CANVAS_SIZE
    canvas.height = CANVAS_SIZE
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(strokeCanvas.canvas, 0, 0)
    context.save()
    context.setTransform(
      CANVAS_SIZE / GUIDE_WIDTH,
      0,
      0,
      -CANVAS_SIZE / GUIDE_HEIGHT,
      CANVAS_SIZE / 2,
      CANVAS_SIZE / 2,
    )
    context.fillStyle = '#000'
    for (const pool of getCarvePools(stone)) {
      const points = pool.getPoints(64)
      if (!points.length) continue
      context.beginPath()
      points.forEach((point, index) => {
        if (index === 0) context.moveTo(point.x, point.y)
        else context.lineTo(point.x, point.y)
      })
      context.closePath()
      context.fill()
    }
    context.restore()

    const texture = new THREE.CanvasTexture(canvas)
    // 强度图不是颜色，必须关掉 sRGB 解码，否则中间调会被压暗、线看着发灰
    texture.colorSpace = THREE.NoColorSpace
    // 关掉 mipmap：远景/斜视角会取到被平均过的低层级，整条线被稀释成一片淡影
    texture.minFilter = THREE.LinearFilter
    texture.generateMipmaps = false
    texture.anisotropy = 8
    texture.needsUpdate = true
    return { texture, canvas }
  }, [strokeCanvas, stone])

  useEffect(() => () => guide?.texture.dispose(), [guide])

  // 调试：把高度图、辅助线与场景暴露到 window，便于在浏览器里直接核对
  const scene = useThree((state) => state.scene)
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const host = window as unknown as Record<string, unknown>
    host.__heightCanvas = heightCanvas
    host.__maskCanvas = carveMaskCanvas
    host.__guideCanvas = guide?.canvas ?? null
    host.__carveSound = carveSound
    host.__scene = scene
  })

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
    // 420×260 ≈ 11 万顶点。300×190 时格子边长 6.2px，细刻刀（宽 3~5px）
    // 比一个格子还窄，位移直接「漏格」，刻出来是断续的锯齿。
    // 560×360（20 万顶点）实测会掉帧，420 是这个平衡点。
    () => createRawStoneCarvePlane(stone, GUIDE_WIDTH, GUIDE_HEIGHT, 420, 260),
    [stone],
  )

  const bodyGeometry = useMemo(() => createRawStoneRim(stone), [stone])
  const baseGeometry = useMemo(() => createRawStoneBase(stone), [stone])

  const stonePBR = useGreenStoneTexture(stone, 2)
  const stoneNormalScale = useMemo(() => new THREE.Vector2(0.55, 0.55), [])

  const heightTextureRef = useRef(heightTexture)
  const carveMaskTextureRef = useRef(carveMaskTexture)
  const drawingRef = useRef(false)
  const lastUvRef = useRef<THREE.Vector2 | null>(null)
  const normalUpdatePendingRef = useRef(false)
  const brushParamsRef = useRef({ tool, brushSize })
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

    // 2. 纹样浅痕；图未就绪时保持纯石面，绝不回退成程序化线条
    if (strokeCanvas) {
      compositePatternRelief(context, strokeCanvas)
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
    strokeCanvas,
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

  // 刀口参数走 ref：paint 是每次 render 新建的闭包，但挂到 window 上的调试入口
  // 和 R3F 的事件回调都可能持有旧引用，读 ref 才能保证永远是最新档位
  brushParamsRef.current = { tool, brushSize }

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
    const activeTool = brushParamsRef.current.tool
    const activeBrush = brushParamsRef.current.brushSize
    const toolScale = activeTool === 'fine' ? 0.55 : activeTool === 'polish' ? 1.75 : 1
    // 刀口半宽（1024 画布像素）。0.34 这个系数是照真实比例定的：
    // 1024 画布 = 260mm 砚宽，1px ≈ 0.25mm，滑块 6~44 对应刀宽 0.6~4mm。
    // 原来系数 0.85 再配 9px 下限：滑块拉到最细也是 2.6mm 的凿子，
    // 而描稿线本身才 1.4mm —— 刀比稿线还宽一倍，怎么刻都是连稿带石一起压掉。
    const baseRadius = Math.max(1.6, activeBrush * 0.34) * toolScale
    const worldPerPixel = GUIDE_WIDTH / CANVAS_SIZE
    const isChiselTool = activeTool === 'chisel'
    const grooveHalfWidth =
      baseRadius * (isChiselTool ? 0.6 : activeTool === 'fine' ? 0.52 : 1)
    // 槽深必须跟着刀宽走，不能跟着「刀有多重」走。
    // 之前不管刀多细都刻到同一个深度（灰度 234 ≈ 0.084 世界单位），
    // 于是 1.5mm 宽的槽刻下 6mm 深 —— 那不是刻线，是在石头上扎针。
    // 位移出来是一个远大于刀口的坑，四周顶点一起被拽下去，
    // 这就是「一刀下去周围一大片都没了」的几何来源。
    // 真实阴刻的槽深大约是槽宽的 1.5~2 倍。
    // 试过收到 1.5 倍，槽是更「干净」了，但 1.4mm 宽的一道线在屏幕上就四五像素，
    // 浅到完全看不出刻过——宁可略深一点，也要让用户看见自己下过刀。
    const grooveDepth = Math.min(
      0.05,
      Math.max(0.012, grooveHalfWidth * 2 * worldPerPixel * 2.2),
    )
    // 灰度 → 深度的反函数：z = -(h - 0.5) * DISPLACEMENT
    const depthGray = Math.round(255 * (grooveDepth / DISPLACEMENT + 0.5))
    // 每种刀的目标深度：用「不透明目标灰度」落到石面，
    // 同一处刻到目标深度后不再加深——这才是凿刻，而不是无限叠加变白
    const targetDepth = activeTool === 'polish' ? 140 : depthGray

    const stamp = (
      stampX: number,
      stampY: number,
      dirX: number,
      dirY: number,
      pressure: number,
    ) => {
      const radius = baseRadius * (activeTool === 'polish' ? 1 : pressure)
      const angle = Math.atan2(dirY, dirX)
      // 压力只微调槽深：0.94~1.0 的浮动。之前按 0.87~1.0 调制，
      // 快刀和慢刀能差出 13% 的深度，走一刀槽底能看出一节一节的
      const depth =
        activeTool === 'polish'
          ? 140
          : Math.round(targetDepth * (0.94 + pressure * 0.06))

      heightContext.save()
      heightContext.translate(stampX, stampY)
      // UV 空间不是等比的：UV 里每像素在 x 上覆盖 2.54、在 y 上只覆盖 1.56，
      // 相差 GUIDE_WIDTH / GUIDE_HEIGHT = 1.625 倍。
      // 直接在这里画圆，纵向刻出来的槽会比横向粗 1.6 倍，同一把刀忽粗忽细。
      // 先放大到「世界等距」坐标，再旋转、画圆，刀口才真正是圆的。
      heightContext.scale(1, GUIDE_WIDTH / GUIDE_HEIGHT)
      heightContext.rotate(angle)
      // 凿刻必须单调加深：用 lighten（逐像素取更深的那个）。
      // 之前用 source-over 叠加，已刻深处再落一刀会被混合回去——
      // 这就是「在空白处下刀，刻纹两边又长出新石料」的真正原因。
      heightContext.globalCompositeOperation = 'lighten'

      if (activeTool === 'polish') {
        // 打磨必须能「变浅」，所以这里要换回 source-over：
        // lighten 只会取更深的值，拿它打磨等于完全没反应
        heightContext.globalCompositeOperation = 'source-over'
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
        const isChisel = activeTool === 'chisel'
        // 刀口尺寸：凿子宽一点、细刻窄一点。
        // 之前细刻的横向系数(0.8)反而比凿子(0.62)大，"细刀"其实更宽
        const length = radius * (isChisel ? 2.2 : 2)
        const width = radius * (isChisel ? 0.6 : 0.52)
        // 断面：石面 → 断崖 → 平槽底 → 断崖 → 石面。
        // 之前两侧各有一道「隆起唇边」(103/109，高于石面基准)：
        // 单看一刀像凿开的石屑，但连刻几刀就在刻痕两侧堆出一圈新石料，
        // 尤其在你已经刻过的地方再下刀，等于把刚刻的槽两侧又垫高了。
        // 真实阴刻的石屑是会被吹掉的，两侧就该是平的。
        // 凿断感改由「陡壁 + 槽底刀痕 + 崩口 + 着色器 AO」共同给出。
        const deep = Math.min(255, depth + 12)
        const profile = heightContext.createLinearGradient(0, -width, 0, width)
        // 陡壁的宽度按像素算，不按比例算：比例固定时，细刀的「壁」只有 0.8px，
        // 被抗锯齿糊成一片灰，槽就变成一团模糊的暗影。
        // 这里保证壁上至少 1px，细刀也能刻出一道有棱的线
        const wall = Math.min(0.34, Math.max(0.16, 1 / (width * 2)))
        profile.addColorStop(0, 'rgba(128,128,128,0)')
        profile.addColorStop(wall, `rgba(${depth},${depth},${depth},0.95)`)
        profile.addColorStop(0.5, `rgba(${deep},${deep},${deep},1)`)
        profile.addColorStop(1 - wall, `rgba(${depth},${depth},${depth},0.95)`)
        profile.addColorStop(1, 'rgba(128,128,128,0)')
        heightContext.fillStyle = profile
        heightContext.beginPath()
        heightContext.ellipse(0, 0, length, width, 0, 0, Math.PI * 2)
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
          const chipR = Math.max(
            0.7,
            width * (0.12 + Math.random() * 0.18),
          )
          const tone = Math.round(128 + (depth - 128) * (0.35 + Math.random() * 0.3))
          heightContext.fillStyle = `rgba(${tone},${tone},${tone},0.9)`
          heightContext.beginPath()
          heightContext.ellipse(chipX, chipY, chipR * 1.4, chipR, 0, 0, Math.PI * 2)
          heightContext.fill()
        }
      }

      heightContext.restore()
    }

    const previous = lastUvRef.current
    const previousX = previous ? previous.x * CANVAS_SIZE : null
    const previousY = previous ? (1 - previous.y) * CANVAS_SIZE : null

    if (previous && previousX !== null && previousY !== null) {
      const lastX = previousX
      const lastY = previousY
      const dx = x - lastX
      const dy = y - lastY
      const distance = Math.hypot(dx, dy)
      const dirX = distance > 0 ? dx / distance : 1
      const dirY = distance > 0 ? dy / distance : 0
      // 慢刀重、快刀轻：只做轻微调制（0.8~1.1）。
      // 之前 0.55~1.2 的跨度，同一把刀慢走和快走宽度差一倍，
      // 画一条直线能看出粗细忽变，像用马克笔涂的
      const pressure = Math.max(0.8, Math.min(1.1, 1.25 - distance / 60))
      // 音色跟着刀走：走刀越快摩擦越响、音调越高；每一刀再叠一记崩裂声。
      // 这比任何视觉细节都更能让人觉得「刀在石头上走」
      carveSound.setTone(baseRadius * 2, distance)
      if (activeTool !== 'polish') carveSound.strike(pressure)
      const steps = Math.max(
        1,
        Math.ceil(distance / Math.max(2, baseRadius * 0.16)),
      )
      for (let step = 1; step <= steps; step += 1) {
        const progress = step / steps
        // 走刀顿挫：沿垂直方向轻微摆动，模拟手工刀痕
        const jitter =
          activeTool === 'polish' ? 0 : (Math.random() - 0.5) * baseRadius * 0.22
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

    // 辅助线「刻到哪消失到哪」。
    // 两个要点：
    // 1) 沿着这一刀走过的整段路径擦，而不是只擦终点。快速拖动时两次事件能差
    //    几十像素，只点擦会在画面上留下一条虚线状的残稿。
    // 2) 擦除半径不能超过刀口本身。原来是笔刷半径的 1.25 倍（默认 19px），
    //    一刀下去把周围三四根描稿线一起抹掉 ——
    //    这就是「一雕刻周围大片都没了」最直接的那一项。
    const guideContext = guide?.canvas.getContext('2d')
    if (guideContext) {
      const eraseRadius = Math.max(2, grooveHalfWidth * 1.7)
      guideContext.save()
      guideContext.setTransform(1, 0, 0, 1, 0, 0)
      // 必须先平移再缩放。
      // 上面 scale(1, 1.625) 是绕原点缩放的：不先 translate 到刀口位置，
      // 整条擦除线会被放大到 1.625 倍坐标处（y=512 画到 y=832），
      // 等于根本没擦到刀口下面 —— 表现为「刻了，描稿却还在」。
      guideContext.translate(previousX ?? x, previousY ?? y)
      // 与笔刷同一套「世界等距」变换，否则沿纵向刻时擦除范围横向偏宽
      guideContext.scale(1, GUIDE_WIDTH / GUIDE_HEIGHT)
      // 用黑色往上盖，而不是 destination-out：
      // 描稿图是强度图，涂黑 = 强度 0 = 不绘制
      guideContext.globalCompositeOperation = 'source-over'
      guideContext.strokeStyle = '#000'
      guideContext.lineWidth = eraseRadius * 2
      guideContext.lineCap = 'round'
      guideContext.lineJoin = 'round'
      guideContext.beginPath()
      guideContext.moveTo(0, 0)
      guideContext.lineTo(x - (previousX ?? x), y - (previousY ?? y))
      guideContext.stroke()
      guideContext.restore()
    }

    lastUvRef.current = uv.clone()

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
        roughness: 0.95,
        metalness: 0.02,
        clearcoat: 0.05,
        clearcoatRoughness: 0.62,
        // 兜底：低角度看过去时，单面几何的背面会被完全剔除，
        // 透出下面的底座，看起来就是「一层透明的东西」
        side: THREE.DoubleSide,
      }),
    [],
  )

  // 雕刻面沿用石沿的重复尺度：同一块石头，砚堂不能比砚边颗粒粗一倍
  const carveMap = useMemo(() => {
    const base = stonePBR.map
    if (!base) return null
    const cloned = base.clone()
    cloned.wrapS = THREE.RepeatWrapping
    cloned.wrapT = THREE.RepeatWrapping
    cloned.repeat.set(2, 2)
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
    cloned.repeat.set(2, 2)
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
    material.normalScale.set(0.55, 0.55)
    // 凹凸贴图交给 GPU 用屏幕空间导数逐像素求法线：
    // 精度等于贴图分辨率，能刻画细刻线；而 512 的 CPU 法线图会把细线抹成缓坡。
    material.bumpMap = heightTexture
    // 负号：高度图里白=深，凹凸要往下凹才是「刻进去」。
    // 0.72：细刻只有 3~5px 宽，远小于几何网格（420 格 / 2.6 单位 = 每格 6.2px），
    // 位移根本表达不出来，全靠 bump 逐像素求法线。0.5 时细线几乎看不出深度
    material.bumpScale = -0.55
    // 位移不再走 material.displacementMap —— 实测在这块几何上它完全没有生效，
    // 雕刻面始终是一张纯平面（包围盒 y 跨度只有场景倾斜的 0.13，没有位移量）。
    // 改在下面 onBeforeCompile 里直接注入顶点着色器，确定性地把顶点压下去。
    material.displacementMap = null
    material.displacementScale = 0
    material.displacementBias = 0
    // 描稿不再走自发光。自发光是「石头自己亮起来」，观感像嵌在石里的 LED 灯带；
    // 而且浅色石头上，亮金线根本没有对比度——黄膘石那版几乎看不见就是这原因。
    // 改为在着色器里当「墨」混进漫反射：朱砂描在深色石上、墨描在浅色石上，
    // 随石面起伏受光，看起来就是匠人刚画上去的稿。
    material.emissiveMap = null
    material.emissiveIntensity = 0

    const deepColor = new THREE.Color(STONE_CARVE[stone])
    const maskTexture = carveMaskTexture
    const guideTexture = guide?.texture ?? null
    const inkColor = new THREE.Color(GUIDE_INK[stone])
    const guideOn = showGuide && guide ? 1 : 0
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uCarveMask = { value: maskTexture }
      shader.uniforms.uDeepColor = { value: deepColor }
      shader.uniforms.uGuideMap = { value: guideTexture }
      shader.uniforms.uGuideInk = { value: inkColor }
      shader.uniforms.uGuideStrength = { value: guideOn }
      // 必须自己传一份「原始 UV」。
      // three 的 vMapUv 会被 map 的 repeat/offset 变换过，而石纹贴图设了
      // repeat(2,2) —— 直接用它采样描稿图，只会显示左上四分之一，
      // 整幅莲花只剩左下角一块。刻痕遮罩同样错位。
      shader.vertexShader = shader.vertexShader
        .replace(
          'void main() {',
          `varying vec2 vInkUv;
void main() {`,
        )
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n  vInkUv = uv;')
      shader.fragmentShader = shader.fragmentShader
        .replace(
          'void main() {',
          `uniform sampler2D uCarveMask;
uniform sampler2D uGuideMap;
uniform vec3 uDeepColor;
uniform vec3 uGuideInk;
uniform float uGuideStrength;
varying vec2 vInkUv;
void main() {`,
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
  vec4 carveSample = texture2D(uCarveMask, vInkUv);
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
  diffuseColor.rgb *= 1.0 - occlusion * 0.8;

  // 朱砂/墨描稿：叠在石面之上。
  // 注意：这里**不能**乘 (1 - carveAmount)。carveAmount 是从整张高度图算的，
  // 凡比石面深一点都算「刻痕」——预置的纹样浮雕（0.28 深）也被算进去，
  // 于是描稿在纹样区域被整片抹掉，只剩最浅的一小块能看见。
  // 刻过之后描稿消失，靠的是 paint() 里把 guide 画布对应位置涂黑。
  float inkRaw = texture2D(uGuideMap, vInkUv).r * uGuideStrength;
  // smoothstep 把 0.15~0.5 之间压成一段陡坡：线要么是实的，要么完全没有。
  // 线性映射会让整条线都是半透明，远看只剩一片脏
  float inkAmount = smoothstep(0.15, 0.5, inkRaw);
  diffuseColor.rgb = mix(diffuseColor.rgb, uGuideInk, inkAmount);`,
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
          // AudioContext 必须在这个手势里创建，否则浏览器会挂起音频上下文
          carveSound.ensure()
          carveSound.setEngaged(true)
          carveSound.setTone(brushSize, 0)
          drawingRef.current = true
          lastUvRef.current = null
          snapshot()
          if (event.uv) paint(event.uv)
        }}
        onPointerMove={(event) => {
          if (!orbit && drawingRef.current && event.uv) paint(event.uv)
        }}
        onPointerUp={() => {
          carveSound.setEngaged(false)
          drawingRef.current = false
          lastUvRef.current = null
        }}
        onPointerLeave={() => {
          carveSound.setEngaged(false)
          drawingRef.current = false
          lastUvRef.current = null
        }}
        onPointerCancel={() => {
          carveSound.setEngaged(false)
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
          // roughness 交给扫描贴图：1.0 × map 才是这块石头真实的涩度。
          // 之前写 0.34，等于把石头强行抛了光，观感是塑料
          roughness={1}
          metalness={0}
          clearcoat={0.06}
          clearcoatRoughness={0.55}
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
          color="#b4b4b4"
          roughness={1}
          metalness={0}
          clearcoat={0.04}
          clearcoatRoughness={0.6}
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
      gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true, toneMappingExposure: 1.02 }}
      onCreated={(state) => {
        onCaptureReady?.(() => state.gl.domElement.toDataURL('image/png'))
      }}
    >
      <Suspense fallback={null}>
        <Environment
          files="models/hdri/studio_small_08_1k.hdr"
          background={false}
          environmentIntensity={0.12}
        />
      </Suspense>
      <ambientLight intensity={0.28} />
      {/* 柔和补光：砚堂是打磨面，不该沉在黑里，但也不能亮到把石头照成白玉 */}
      <directionalLight position={[1.4, 4.2, 2.6]} intensity={0.3} />
      {/* 掠射侧光：浮雕的立体感全靠掠射光在凹槽里投影，顶光只会把起伏压平。
          这是唯一保留高强度的灯——刻痕能不能"看进去"全看它 */}
      <directionalLight
        position={[-3.4, 1.05, 2.2]}
        intensity={1.3}
        color="#fff2dd"
      />
      {/* 主光降到 0.85：原来 1.6 加上其余五盏，石头整体被照到接近全白，
          石纹全部冲掉，观感从"砚石"变成"抛光玉雕" */}
      <directionalLight
        position={[4, 6, 4]}
        intensity={0.85}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
      <pointLight position={[-4, 2, -3]} intensity={0.3} color="#8fbfae" />
      <spotLight
        position={[0, 5, 1]}
        angle={0.6}
        penumbra={1}
        intensity={0.5}
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

