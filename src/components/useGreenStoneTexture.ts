import { useEffect, useState } from 'react'
import * as THREE from 'three'

export type StoneVariant = 'green' | 'yellow' | 'purple'

export type StonePBR = {
  map: THREE.Texture | null
  normalMap: THREE.Texture | null
  roughnessMap: THREE.Texture | null
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

// 每种石料的颜色校正：洮河石以绿色为基调，黄膘石偏翠绿带金黄、紫石偏暗红紫
const TINTS: Record<StoneVariant, string> = {
  green: '#cfe0d8',
  yellow: '#d8d2b8',
  purple: '#cfc0c6',
}

export function useGreenStoneTexture(
  variant: StoneVariant = 'green',
  repeat = 2,
): StonePBR {
  const [textures, setTextures] = useState<StonePBR>({
    map: null,
    normalMap: null,
    roughnessMap: null,
  })

  useEffect(() => {
    let cancelled = false
    const loader = new THREE.TextureLoader()
    const source = SOURCES[variant]

    Promise.all([
      loader.loadAsync(source.color),
      loader.loadAsync(source.normal),
      loader.loadAsync(source.rough),
    ])
      .then(([map, normalMap, roughnessMap]) => {
        if (cancelled) {
          map.dispose()
          normalMap.dispose()
          roughnessMap.dispose()
          return
        }
        map.colorSpace = THREE.SRGBColorSpace
        normalMap.colorSpace = THREE.NoColorSpace
        roughnessMap.colorSpace = THREE.NoColorSpace
        for (const texture of [map, normalMap, roughnessMap]) {
          texture.wrapS = THREE.RepeatWrapping
          texture.wrapT = THREE.RepeatWrapping
          texture.repeat.set(repeat, repeat)
          texture.anisotropy = 8
        }
        setTextures({ map, normalMap, roughnessMap })
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [variant, repeat])

  useEffect(() => {
    return () => {
      textures.map?.dispose()
      textures.normalMap?.dispose()
      textures.roughnessMap?.dispose()
    }
  }, [textures])

  return textures
}

// 石料色调（用于雕刻面 color 乘色，让「深层石色」随石料变化）
export function useStoneTint(variant: StoneVariant = 'green') {
  return TINTS[variant]
}
