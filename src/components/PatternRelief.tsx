import { useEffect, useRef } from 'react'
import type { InkstonePattern } from './inkstoneGeometry'

// 与 3D 雕刻面用的是同一套高度图：预览即所得
const HEIGHT_SRC: Record<InkstonePattern, string> = {
  lotus: 'textures/patterns/lotus_height.png',
  cloud: 'textures/patterns/cloud_height.png',
  wave: 'textures/patterns/wave_height.png',
  meander: 'textures/patterns/meander_height.png',
}

// 三种洮河石的基调色：预览必须跟随所选石料，否则紫石也会显示成绿石
const BASE_BY_STONE: Record<string, { r: number; g: number; b: number }> = {
  green: { r: 76, g: 118, b: 102 },
  yellow: { r: 132, g: 114, b: 72 },
  purple: { r: 112, g: 80, b: 92 },
}

/**
 * 用真实纹样高度图做浮雕光照渲染：
 * 从高度场求法线，打一束左上斜光，得到凸起受光、凹槽积影的浮雕效果。
 * 预览和 3D 雕刻面共用同一张高度图，所以「看到什么就刻出什么」。
 */
export function PatternRelief({
  id,
  stone = 'green',
}: {
  id: InkstonePattern
  stone?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let cancelled = false
    const img = new Image()

    img.onload = () => {
      if (cancelled) return
      const canvas = canvasRef.current
      const context = canvas?.getContext('2d')
      if (!canvas || !context) return

      const size = 512
      canvas.width = size
      canvas.height = size

      const scratch = document.createElement('canvas')
      scratch.width = size
      scratch.height = size
      const scratchContext = scratch.getContext('2d')
      if (!scratchContext) return
      scratchContext.drawImage(img, 0, 0, size, size)
      const source = scratchContext.getImageData(0, 0, size, size).data

      // 高度图语义是「黑=凸、白=凹」，反转成 1 = 最高
      const height = new Float32Array(size * size)
      for (let i = 0; i < height.length; i += 1) {
        height[i] = 1 - source[i * 4] / 255
      }

      const BASE = BASE_BY_STONE[stone] ?? BASE_BY_STONE.green
      const out = context.createImageData(size, size)
      // 左上斜射光
      const lxRaw = -0.5
      const lyRaw = -0.56
      const lzRaw = 0.66
      const lLen = Math.hypot(lxRaw, lyRaw, lzRaw)
      const lx = lxRaw / lLen
      const ly = lyRaw / lLen
      const lz = lzRaw / lLen
      const hx = lx
      const hy = ly
      const hz = lz + 1
      const hLen = Math.hypot(hx, hy, hz)
      const strength = 2.8

      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const index = y * size + x
          const x0 = x > 0 ? index - 1 : index
          const x1 = x < size - 1 ? index + 1 : index
          const y0 = y > 0 ? index - size : index
          const y1 = y < size - 1 ? index + size : index

          const dx = (height[x1] - height[x0]) * strength
          const dy = (height[y1] - height[y0]) * strength
          const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1)
          const nx = -dx * inv
          const ny = -dy * inv
          const nz = inv

          const diffuse = Math.max(0, nx * lx + ny * ly + nz * lz)
          const spec = Math.pow(
            Math.max(0, (nx * hx + ny * hy + nz * hz) / hLen),
            24,
          )

          const relief = height[index]
          const shade = (0.4 + diffuse * 0.78) * (0.84 + relief * 0.34)
          const highlight = spec * 172

          const target = index * 4
          out.data[target] = Math.min(255, BASE.r * shade + highlight)
          out.data[target + 1] = Math.min(255, BASE.g * shade + highlight * 0.94)
          out.data[target + 2] = Math.min(255, BASE.b * shade + highlight * 0.8)
          out.data[target + 3] = 255
        }
      }
      context.putImageData(out, 0, 0)
    }

    img.src = HEIGHT_SRC[id]
    return () => {
      cancelled = true
      img.onload = null
    }
  }, [id, stone])

  return <canvas ref={canvasRef} className="pattern-relief" />
}
