import { useEffect, useState } from 'react'
import * as THREE from 'three'
import { asset } from '../lib/asset'

export type StoneVariant = 'green' | 'yellow' | 'purple'

export type StonePBR = {
  map: THREE.Texture
  normalMap: THREE.Texture | null
  roughnessMap: THREE.Texture | null
  ready: boolean
}

// 真实洮河石三大石色的照片扫描 PBR 贴图（ambientCG · CC0 免费商用）
// 源材质按岩石成因挑选，不是按颜色：
//   鹦哥绿 ← Rock020 细粒板岩（纵向劈理、丝绢光泽，正是洮河石的水云母质板岩）
//   黄膘石 ← Rock041 细粒粉砂岩（均匀致密，带矿物黄斑，对应黄膘石）
//   紫石   ← Rock035 细粒黑色页岩（致密含铁，对应羊肝红/紫石）
// 色相在构建期烘焙（tools/bake_stone.py）：明暗结构 100% 取原扫描，
// 色度方向向洮河石本色拉 55~74%，保留原图的冷暖杂质。
// 因此运行时绝不能再做一次「亮度 → 单色」映射，那样只会退回磨砂塑料。
const SOURCES: Record<
  StoneVariant,
  { color: string; normal: string; rough: string }
> = {
  green: {
    color: asset('textures/inkstone/green_color.jpg'),
    normal: asset('textures/inkstone/green_normal.jpg'),
    rough: asset('textures/inkstone/green_rough.jpg'),
  },
  yellow: {
    color: asset('textures/inkstone/yellow_color.jpg'),
    normal: asset('textures/inkstone/yellow_normal.jpg'),
    rough: asset('textures/inkstone/yellow_rough.jpg'),
  },
  purple: {
    color: asset('textures/inkstone/purple_color.jpg'),
    normal: asset('textures/inkstone/purple_normal.jpg'),
    rough: asset('textures/inkstone/purple_rough.jpg'),
  },
}

// 每种洮河石的真实基色：取烘焙后贴图的平均色，保证加载前后不跳色
export const STONE_BASE: Record<StoneVariant, string> = {
  green: '#415b4d',
  yellow: '#8a764c',
  purple: '#473640',
}

// 雕刻露出的「深层石色」——真实雕刻削去表层，露出内部更深更润的石色
export const STONE_DEEP: Record<StoneVariant, string> = {
  green: '#20352c',
  yellow: '#4a3d22',
  purple: '#2e2029',
}

// 凿开后露出的石色：比表面略深、略饱和，但仍是石头，不能是近黑。
// 近黑的凹槽配上 AO 会变成「黑洞」，反而失去凿刻的体积感。
export const STONE_CARVE: Record<StoneVariant, string> = {
  green: '#2b4438',
  yellow: '#5c4a28',
  purple: '#3a2530',
}

// 新凿开的石口（刀口内部）比风化表层更浅、更灰。
// 这是阴刻线能「看见」的关键：洮石表层是深绿带水锈，刀一过露出的是
// 灰白偏绿的麻面，刀痕因此是一条比周围浅的线。
// 之前一直拿 STONE_CARVE（比表层还深的绿）去混，混完和背景几乎同色 ——
// 数据上 carveAmount 明明是 1，屏幕上却什么都没有，就是这个原因。
export const STONE_FRESH: Record<StoneVariant, string> = {
  green: '#93a189',
  yellow: '#cbb27a',
  purple: '#a893a0',
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

// 着色校正已移到构建期（tools/bake_stone.py），这里直接使用烘焙好的成品贴图。

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
    .then(([map, normalMap, roughnessMap]) => {
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
