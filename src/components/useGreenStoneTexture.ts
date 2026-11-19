import { useEffect, useState } from 'react'
import * as THREE from 'three'

export type StoneVariant = 'green' | 'yellow' | 'purple'

export type StonePBR = {
  map: THREE.Texture
  normalMap: THREE.Texture | null
  roughnessMap: THREE.Texture | null
  ready: boolean
}

// 真实洮河石三大石色的照片扫描 PBR 贴图（ambientCG · CC0 免费商用）
// 鹦哥绿=深绿大理石(细腻云纹) / 黄膘石=金黄层理玛瑙 / 紫石(羊肝红)=红棕玛瑙
const SOURCES: Record<
  StoneVariant,
  { color: string; normal: string; rough: string }
> = {
  green: {
    color: 'textures/inkstone/green_color.jpg',
    normal: 'textures/inkstone/green_normal.jpg',
    rough: 'textures/inkstone/green_rough.jpg',
  },
  yellow: {
    color: 'textures/inkstone/yellow_color.jpg',
    normal: 'textures/inkstone/yellow_normal.jpg',
    rough: 'textures/inkstone/yellow_rough.jpg',
  },
  purple: {
    color: 'textures/inkstone/purple_color.jpg',
    normal: 'textures/inkstone/purple_normal.jpg',
    rough: 'textures/inkstone/purple_rough.jpg',
  },
}

// 每种洮河石的真实基色：贴图未就绪时用它兜底，绝不出现白模
export const STONE_BASE: Record<StoneVariant, string> = {
  green: '#3d6b5b',
  yellow: '#8a7742',
  purple: '#6b4a56',
}

// 雕刻露出的「深层石色」——真实雕刻削去表层，露出内部更深更润的石色
export const STONE_DEEP: Record<StoneVariant, string> = {
  green: '#17322a',
  yellow: '#2e3a1f',
  purple: '#381f2b',
}

// 凿开后露出的石色：比表面略深、略饱和，但仍是石头，不能是近黑。
// 近黑的凹槽配上 AO 会变成「黑洞」，反而失去凿刻的体积感。
export const STONE_CARVE: Record<StoneVariant, string> = {
  green: '#1d3a30',
  yellow: '#4a3718',
  purple: '#331d26',
}

function clamp255(value: number) {
  return value < 0 ? 0 : value > 255 ? 255 : value
}

// 程序化兜底纹理：细腻页岩颗粒 + 淡云斑，保证首帧就有正确石色
function makeFallbackTexture(variant: StoneVariant): THREE.Texture {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (context) {
    context.fillStyle = STONE_BASE[variant]
    context.fillRect(0, 0, size, size)
    const image = context.getImageData(0, 0, size, size)
    const data = image.data
    for (let i = 0; i < data.length; i += 4) {
      const noise = (Math.random() - 0.5) * 22
      data[i] = clamp255(data[i] + noise)
      data[i + 1] = clamp255(data[i + 1] + noise)
      data[i + 2] = clamp255(data[i + 2] + noise)
    }
    context.putImageData(image, 0, 0)
    // 天然石料的云气斑，避免纯色平板感
    for (let i = 0; i < 30; i += 1) {
      const x = Math.random() * size
      const y = Math.random() * size
      const radius = 30 + Math.random() * 110
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius)
      gradient.addColorStop(0, 'rgba(255,255,255,0.055)')
      gradient.addColorStop(1, 'rgba(255,255,255,0)')
      context.fillStyle = gradient
      context.beginPath()
      context.arc(x, y, radius, 0, Math.PI * 2)
      context.fill()
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  return texture
}

// 模块级缓存：同一石料只加载一次、永不 dispose（避免切换石料时把在用的纹理释放掉）
const fallbackCache = new Map<StoneVariant, StonePBR>()
const loadedCache = new Map<StoneVariant, StonePBR>()
const pendingCache = new Map<StoneVariant, Promise<StonePBR>>()

function getFallback(variant: StoneVariant): StonePBR {
  const cached = fallbackCache.get(variant)
  if (cached) return cached
  const pbr: StonePBR = {
    map: makeFallbackTexture(variant),
    normalMap: null,
    roughnessMap: null,
    ready: false,
  }
  fallbackCache.set(variant, pbr)
  return pbr
}

// 着色校正：ambientCG 的贴图是「大理石 / 玛瑙」，直接贴上去不是洮河石的样子
// （深绿大理石平均色只有 #101514 近乎纯黑，提亮后又露出大理石白斑）。
// 做法：保留贴图的亮度细节（真实石材的层理、颗粒、起伏），把色相统一映射到
// 洮河石本色。既不是「换个颜色」，也不是「贴一块别的石头」。
const STONE_ALBEDO: Record<StoneVariant, { r: number; g: number; b: number }> = {
  green: { r: 74, g: 116, b: 100 },
  yellow: { r: 162, g: 128, b: 58 },
  purple: { r: 99, g: 65, b: 76 },
}

function colorizeTexture(
  texture: THREE.Texture,
  albedo: { r: number; g: number; b: number },
) {
  const image = texture.image as HTMLImageElement | undefined
  if (!image || !image.width) return texture
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d')
  if (!context) return texture
  context.drawImage(image, 0, 0)
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
  const data = imageData.data
  for (let i = 0; i < data.length; i += 4) {
    const luminance =
      (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255
    // 亮度调制：暗部的细微起伏保留，亮部不要冲成白斑
    const k = 0.44 + 0.84 * Math.pow(luminance, 0.9)
    data[i] = clamp255(albedo.r * k)
    data[i + 1] = clamp255(albedo.g * k)
    data[i + 2] = clamp255(albedo.b * k)
  }
  context.putImageData(imageData, 0, 0)
  const mapped = new THREE.CanvasTexture(canvas)
  mapped.colorSpace = THREE.SRGBColorSpace
  mapped.wrapS = THREE.RepeatWrapping
  mapped.wrapT = THREE.RepeatWrapping
  mapped.anisotropy = 8
  mapped.needsUpdate = true
  return mapped
}

function loadStone(variant: StoneVariant): Promise<StonePBR> {
  const loaded = loadedCache.get(variant)
  if (loaded) return Promise.resolve(loaded)

  const pending = pendingCache.get(variant)
  if (pending) return pending

  const loader = new THREE.TextureLoader()
  const source = SOURCES[variant]

  const promise = Promise.all([
    loader.loadAsync(source.color),
    loader.loadAsync(source.normal),
    loader.loadAsync(source.rough),
  ])
    .then(([rawMap, normalMap, roughnessMap]) => {
      const map = colorizeTexture(rawMap, STONE_ALBEDO[variant]) as THREE.Texture
      map.colorSpace = THREE.SRGBColorSpace
      normalMap.colorSpace = THREE.NoColorSpace
      roughnessMap.colorSpace = THREE.NoColorSpace
      for (const texture of [map, normalMap, roughnessMap]) {
        texture.wrapS = THREE.RepeatWrapping
        texture.wrapT = THREE.RepeatWrapping
        texture.anisotropy = 8
      }
      const pbr: StonePBR = { map, normalMap, roughnessMap, ready: true }
      loadedCache.set(variant, pbr)
      pendingCache.delete(variant)
      return pbr
    })
    .catch(() => {
      // 加载失败也返回可用贴图（程序化兜底），调用方永远不会拿到 null
      pendingCache.delete(variant)
      return getFallback(variant)
    })

  pendingCache.set(variant, promise)
  return promise
}

export function useGreenStoneTexture(
  variant: StoneVariant = 'green',
  repeat = 1.5,
): StonePBR {
  const [pbr, setPbr] = useState<StonePBR>(() => getFallback(variant))

  useEffect(() => {
    let alive = true
    const loaded = loadedCache.get(variant)
    if (loaded) {
      setPbr(loaded)
      return
    }
    setPbr(getFallback(variant))
    loadStone(variant).then((next) => {
      if (alive) setPbr(next)
    })
    return () => {
      alive = false
    }
  }, [variant])

  useEffect(() => {
    for (const texture of [pbr.map, pbr.normalMap, pbr.roughnessMap]) {
      if (texture) {
        texture.repeat.set(repeat, repeat)
        texture.needsUpdate = true
      }
    }
  }, [pbr, repeat])

  return pbr
}

// 石料色调（用于需要自绘的地方取同一基调）
export function useStoneTint(variant: StoneVariant = 'green') {
  return STONE_BASE[variant]
}
