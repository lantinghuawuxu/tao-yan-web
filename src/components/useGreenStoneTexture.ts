import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

function seededRandom(seed: number) {
  let value = seed >>> 0
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return value / 4294967296
  }
}

export function useGreenStoneTexture(repeat = 1.4) {
  const texture = useMemo(() => {
    const size = 1024
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d')
    if (!context) return null

    const random = seededRandom(20261103)
    context.fillStyle = '#5b7a69'
    context.fillRect(0, 0, size, size)

    for (let i = 0; i < 80; i += 1) {
      const light = random() > 0.55
      context.strokeStyle = light
        ? `rgba(154, 180, 164, ${0.06 + random() * 0.12})`
        : `rgba(45, 67, 56, ${0.05 + random() * 0.12})`
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
      gradient.addColorStop(0, `rgba(30, 48, 40, ${0.03 + random() * 0.06})`)
      gradient.addColorStop(1, 'rgba(30, 48, 40, 0)')
      context.fillStyle = gradient
      context.beginPath()
      context.arc(centerX, centerY, radius, 0, Math.PI * 2)
      context.fill()
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
  }, [repeat])

  useEffect(() => {
    return () => {
      texture?.dispose()
    }
  }, [texture])

  return texture
}
