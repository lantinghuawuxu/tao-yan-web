import { useEffect, useState } from 'react'
import * as THREE from 'three'

type RockTextures = {
  map: THREE.Texture | null
  normalMap: THREE.Texture | null
  roughnessMap: THREE.Texture | null
}

export function useRockTextures(repeat = 2): RockTextures {
  const [textures, setTextures] = useState<RockTextures>({
    map: null,
    normalMap: null,
    roughnessMap: null,
  })

  useEffect(() => {
    let cancelled = false
    const loader = new THREE.TextureLoader()

    Promise.all([
      loader.loadAsync('textures/stone/rock_05_diff_1k.jpg'),
      loader.loadAsync('textures/stone/rock_05_nor_gl_1k.jpg'),
      loader.loadAsync('textures/stone/rock_05_rough_1k.jpg'),
    ])
      .then(([map, normalMap, roughnessMap]) => {
        if (cancelled) {
          map.dispose()
          normalMap.dispose()
          roughnessMap.dispose()
          return
        }
        map.colorSpace = THREE.SRGBColorSpace
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
  }, [repeat])

  useEffect(() => {
    return () => {
      textures.map?.dispose()
      textures.normalMap?.dispose()
      textures.roughnessMap?.dispose()
    }
  }, [textures])

  return textures
}
