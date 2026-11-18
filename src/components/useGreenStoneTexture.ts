import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

export type StoneVariant = 'green' | 'yellow' | 'purple'

function seededRandom(seed: number) {
  let value = seed >>> 0
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return value / 4294967296
  }
}

// 洮河绿石三大代表石色的调色盘（泥盆系细泥板页岩）
const palettes: Record<
  StoneVariant,
  { base: string; light: string; dark: string; spot: string; badge?: string }
> = {
  // 鹦哥绿：深墨绿，密布细黑湔墨点
  green: {
    base: '#477c68',
    light: 'rgba(158, 196, 178,',
    dark: 'rgba(36, 64, 54,',
    spot: 'rgba(28, 52, 43,',
  },
  // 黄膘石：翠绿石体 + 金黄石膘（洮砚标志性特征）
  yellow: {
    base: '#4a7a5c',
    light: 'rgba(170, 200, 168,',
    dark: 'rgba(42, 70, 50,',
    spot: 'rgba(30, 52, 40,',
    badge: '#c9a44a',
  },
  // 紫石（上紫下绿）：紫红石体
  purple: {
    base: '#6b5a6e',
    light: 'rgba(176, 160, 178,',
    dark: 'rgba(58, 46, 62,',
    spot: 'rgba(42, 32, 48,',
    badge: '#4f7a5c',
  },
}

export function useGreenStoneTexture(
  variant: StoneVariant = 'green',
  repeat = 1.4,
) {
  const texture = useMemo(() => {
    const palette = palettes[variant]
    const size = 1024
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d')
    if (!context) return null

    const random = seededRandom(20261103)
    context.fillStyle = palette.base
    context.fillRect(0, 0, size, size)

    // 水波纹 / 层理纹理
    for (let i = 0; i < 80; i += 1) {
      const light = random() > 0.55
      context.strokeStyle = light
        ? `${palette.light}${0.06 + random() * 0.12})`
        : `${palette.dark}${0.05 + random() * 0.12})`
      context.lineWidth = 1 + random() * 7
      context.lineCap = 'round'
      context.beginPath()
      const startX = random() * size
      const startY = random() * size
      context.moveTo(startX, startY)
      context.bezierCurveTo(
        random() * size,
        random() * size,
        random() * size,
        random() * size,
        random() * size,
        random() * size,
      )
      context.stroke()
    }

    // 暗色团濡 / 湔墨点
    for (let i = 0; i < 120; i += 1) {
      const centerX = random() * size
      const centerY = random() * size
      const radius = 20 + random() * 120
      const gradient = context.createRadialGradient(
        centerX,
        centerY,
        0,
        centerX,
        centerY,
        radius,
      )
      gradient.addColorStop(0, `${palette.spot}${0.03 + random() * 0.06})`)
      gradient.addColorStop(1, `${palette.spot}0)`)
      context.fillStyle = gradient
      context.beginPath()
      context.arc(centerX, centerY, radius, 0, Math.PI * 2)
      context.fill()
    }

    // 石膘：黄膘石 / 紫石带天然色膘斑块
    if (palette.badge) {
      for (let i = 0; i < 14; i += 1) {
        const centerX = random() * size
        const centerY = random() * size
        const radius = 30 + random() * 90
        const gradient = context.createRadialGradient(
          centerX,
          centerY,
          0,
          centerX,
          centerY,
          radius,
        )
        gradient.addColorStop(0, palette.badge)
        gradient.addColorStop(1, `${palette.badge}00`)
        context.fillStyle = gradient
        context.beginPath()
        context.arc(centerX, centerY, radius, 0, Math.PI * 2)
        context.fill()
      }
    }

    const image = context.getImageData(0, 0, size, size)
    for (let i = 0; i < image.data.length; i += 4) {
      const noise = (random() - 0.5) * 10
      image.data[i] += noise
      image.data[i + 1] += noise
      image.data[i + 2] += noise
    }
    context.putImageData(image, 0, 0)

    const map = new THREE.CanvasTexture(canvas)
    map.colorSpace = THREE.SRGBColorSpace
    map.wrapS = THREE.RepeatWrapping
    map.wrapT = THREE.RepeatWrapping
    map.repeat.set(repeat, repeat)
    map.anisotropy = 8
    map.needsUpdate = true
    return map
  }, [variant, repeat])

  useEffect(() => {
    return () => {
      texture?.dispose()
    }
  }, [texture])

  return texture
}
