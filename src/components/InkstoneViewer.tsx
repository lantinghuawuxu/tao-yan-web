import { useEffect, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { ContactShadows, OrbitControls, RoundedBox } from '@react-three/drei'
import * as THREE from 'three'

export type InkstoneShape = '随形' | '长方' | '椭圆' | '圆形' | '双池'
export type InkstonePattern = 'lotus' | 'cloud' | 'wave' | 'meander'

const THICKNESS = 0.24
const PATTERN_CANVAS_SIZE = 1024
const PATTERN_WORLD_WIDTH = 3
const PATTERN_WORLD_HEIGHT = 2.4
const POOL_FLOOR = -THICKNESS + 0.035

function roundedRect(
  width: number,
  height: number,
  radius: number,
  cx = 0,
  cy = 0,
) {
  const x = cx - width / 2
  const y = cy - height / 2
  const r = Math.min(radius, width / 2, height / 2)
  const shape = new THREE.Shape()

  shape.moveTo(x + r, y)
  shape.lineTo(x + width - r, y)
  shape.quadraticCurveTo(x + width, y, x + width, y + r)
  shape.lineTo(x + width, y + height - r)
  shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  shape.lineTo(x + r, y + height)
  shape.quadraticCurveTo(x, y + height, x, y + height - r)
  shape.lineTo(x, y + r)
  shape.quadraticCurveTo(x, y, x + r, y)

  return shape
}

function ellipse(
  rx: number,
  ry: number,
  cx = 0,
  cy = 0,
  clockwise = false,
) {
  const shape = new THREE.Shape()
  shape.absellipse(cx, cy, rx, ry, 0, Math.PI * 2, clockwise, 0)
  return shape
}

function freeform(scale = 1) {
  const points: THREE.Vector2[] = []
  const segments = 72

  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2
    const radius =
      1 +
      Math.sin(angle * 3 + 0.8) * 0.08 +
      Math.cos(angle * 5 - 0.4) * 0.05
    points.push(
      new THREE.Vector2(
        Math.cos(angle) * radius * 1.15 * scale,
        Math.sin(angle) * radius * 0.78 * scale,
      ),
    )
  }

  return new THREE.Shape(points)
}

function createShape(shape: InkstoneShape) {
  if (shape === '长方') {
    return {
      outer: roundedRect(2.3, 1.5, 0.18),
      pools: [roundedRect(1.4, 0.66, 0.16)],
    }
  }

  if (shape === '椭圆') {
    return {
      outer: ellipse(1.3, 0.88),
      pools: [ellipse(0.72, 0.42)],
    }
  }

  if (shape === '圆形') {
    return {
      outer: ellipse(1.05, 1.05),
      pools: [ellipse(0.55, 0.55)],
    }
  }

  if (shape === '双池') {
    return {
      outer: roundedRect(2.4, 1.5, 0.2),
      pools: [
        ellipse(0.5, 0.38, -0.48, 0),
        ellipse(0.28, 0.2, 0.72, 0),
      ],
    }
  }

  return {
    outer: freeform(1),
    pools: [freeform(0.62)],
  }
}

function reverseShape(shape: THREE.Shape) {
  return new THREE.Shape(shape.getPoints(64).reverse())
}

function traceShape(
  ctx: CanvasRenderingContext2D,
  shape: THREE.Shape,
  scale = 1,
) {
  const points = shape.getPoints(80)
  ctx.beginPath()
  points.forEach((point, index) => {
    const x = point.x * scale
    const y = point.y * scale
    if (index === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.closePath()
}

function drawPattern(
  ctx: CanvasRenderingContext2D,
  pattern: InkstonePattern,
) {
  if (pattern === 'lotus') {
    for (let i = 0; i < 10; i += 1) {
      const angle = (i / 10) * Math.PI * 2
      ctx.save()
      ctx.translate(Math.cos(angle) * 0.92, Math.sin(angle) * 0.62)
      ctx.rotate(angle + Math.PI / 2)
      ctx.beginPath()
      ctx.moveTo(0, -0.1)
      ctx.quadraticCurveTo(0.08, 0, 0, 0.1)
      ctx.quadraticCurveTo(-0.08, 0, 0, -0.1)
      ctx.stroke()
      ctx.restore()
    }
    return
  }

  if (pattern === 'cloud') {
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2
      ctx.beginPath()
      ctx.arc(
        Math.cos(angle) * 0.92,
        Math.sin(angle) * 0.62,
        0.12,
        angle,
        angle + Math.PI * 1.1,
      )
      ctx.stroke()
    }
    return
  }

  if (pattern === 'wave') {
    for (let ring = 0; ring < 3; ring += 1) {
      const rx = 0.6 + ring * 0.14
      const ry = 0.4 + ring * 0.1
      ctx.beginPath()
      for (let i = 0; i <= 160; i += 1) {
        const angle = (i / 160) * Math.PI * 2
        const wobble = 1 + Math.sin(angle * 8 + ring * 1.2) * 0.025
        const x = Math.cos(angle) * rx * wobble
        const y = Math.sin(angle) * ry * wobble
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.stroke()
    }
    return
  }

  for (let i = 0; i < 10; i += 1) {
    const angle = (i / 10) * Math.PI * 2
    ctx.save()
    ctx.translate(Math.cos(angle) * 0.92, Math.sin(angle) * 0.62)
    ctx.rotate(angle + Math.PI / 2)
    ctx.beginPath()
    ctx.moveTo(-0.07, -0.07)
    ctx.lineTo(0.07, -0.07)
    ctx.lineTo(0.07, 0.07)
    ctx.lineTo(-0.03, 0.07)
    ctx.lineTo(-0.03, 0)
    ctx.lineTo(0.02, 0)
    ctx.stroke()
    ctx.restore()
  }
}

function createPatternTextures(
  shape: InkstoneShape,
  pattern: InkstonePattern,
  patternScale: number,
) {
  const size = PATTERN_CANVAS_SIZE
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const scaleX = size / PATTERN_WORLD_WIDTH
  const scaleY = size / PATTERN_WORLD_HEIGHT
  ctx.setTransform(scaleX, 0, 0, -scaleY, size / 2, size / 2)

  const parts = createShape(shape)
  ctx.save()
  traceShape(ctx, parts.outer)
  ctx.clip()
  ctx.save()
  ctx.scale(patternScale, patternScale)

  ctx.strokeStyle = 'rgba(199, 168, 107, 0.92)'
  ctx.lineWidth = 0.012
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  traceShape(ctx, parts.outer, 0.86)
  ctx.stroke()
  traceShape(ctx, parts.outer, 0.79)
  ctx.stroke()
  drawPattern(ctx, pattern)
  ctx.restore()
  ctx.restore()

  ctx.globalCompositeOperation = 'destination-out'
  for (const pool of parts.pools) {
    traceShape(ctx, pool)
    ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'

  const source = ctx.getImageData(0, 0, size, size)
  const normalCanvas = document.createElement('canvas')
  normalCanvas.width = size
  normalCanvas.height = size
  const normalCtx = normalCanvas.getContext('2d')
  if (!normalCtx) return null

  const normalImage = normalCtx.createImageData(size, size)
  const heightAt = (x: number, y: number) =>
    source.data[(y * size + x) * 4 + 3] / 255
  const strength = 3.2

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const left = heightAt(Math.max(x - 1, 0), y)
      const right = heightAt(Math.min(x + 1, size - 1), y)
      const up = heightAt(x, Math.max(y - 1, 0))
      const down = heightAt(x, Math.min(y + 1, size - 1))
      const nx = (left - right) * strength
      const ny = (up - down) * strength
      const length = Math.hypot(nx, ny, 1)
      const index = (y * size + x) * 4
      normalImage.data[index] = ((nx / length) * 0.5 + 0.5) * 255
      normalImage.data[index + 1] = ((ny / length) * 0.5 + 0.5) * 255
      normalImage.data[index + 2] = (1 / length) * 0.5 * 255 + 127.5
      normalImage.data[index + 3] = 255
    }
  }
  normalCtx.putImageData(normalImage, 0, 0)

  const map = new THREE.CanvasTexture(canvas)
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = 8
  map.needsUpdate = true

  const normalMap = new THREE.CanvasTexture(normalCanvas)
  normalMap.colorSpace = THREE.NoColorSpace
  normalMap.anisotropy = 8
  normalMap.needsUpdate = true

  return { map, normalMap }
}

function InkstoneModel({
  shape,
  pattern,
  patternScale,
}: {
  shape: InkstoneShape
  pattern: InkstonePattern
  patternScale: number
}) {
  const model = useMemo(() => {
    const parts = createShape(shape)
    parts.outer.holes = parts.pools.map(reverseShape)

    const body = new THREE.ExtrudeGeometry(parts.outer, {
      depth: THICKNESS,
      bevelEnabled: true,
      bevelSegments: 4,
      bevelSize: 0.035,
      bevelThickness: 0.025,
      curveSegments: 48,
    })
    body.rotateX(-Math.PI / 2)
    body.translate(0, -THICKNESS, 0)
    body.computeVertexNormals()

    return {
      body,
      pools: parts.pools.map((pool) => new THREE.ShapeGeometry(pool)),
    }
  }, [shape])

  const overlay = useMemo(
    () => createPatternTextures(shape, pattern, patternScale),
    [shape, pattern, patternScale],
  )

  const overlayNormalScale = useMemo(
    () => new THREE.Vector2(1.2, 1.2),
    [],
  )

  useEffect(() => {
    return () => {
      model.body.dispose()
      for (const pool of model.pools) pool.dispose()
    }
  }, [model])

  useEffect(() => {
    return () => {
      overlay?.map.dispose()
      overlay?.normalMap.dispose()
    }
  }, [overlay])

  return (
    <group position={[0, 0.05, 0]} rotation={[0.12, -0.4, 0.02]}>
      <mesh geometry={model.body} castShadow receiveShadow>
        <meshPhysicalMaterial
          color="#5f7f70"
          roughness={0.38}
          metalness={0.04}
          clearcoat={0.32}
          clearcoatRoughness={0.45}
        />
      </mesh>

      {model.pools.map((pool, index) => (
        <mesh
          key={index}
          geometry={pool}
          position={[0, POOL_FLOOR, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          receiveShadow
        >
          <meshPhysicalMaterial
            color="#1d2924"
            roughness={0.55}
            metalness={0.02}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}

      {overlay && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.032, 0]}
          renderOrder={1}
        >
          <planeGeometry args={[PATTERN_WORLD_WIDTH, PATTERN_WORLD_HEIGHT]} />
          <meshStandardMaterial
            map={overlay.map}
            normalMap={overlay.normalMap}
            normalScale={overlayNormalScale}
            transparent
            depthWrite={false}
            roughness={0.38}
            metalness={0.32}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      <RoundedBox
        args={[2.6, 0.18, 1.75]}
        radius={0.07}
        smoothness={4}
        position={[0, -0.33, 0]}
      >
        <meshStandardMaterial color="#2b1b12" roughness={0.72} />
      </RoundedBox>

      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.44, 0]}
        scale={[1.2, 1, 0.82]}
      >
        <ringGeometry args={[1.3, 1.36, 96]} />
        <meshBasicMaterial
          color="#c7a86b"
          transparent
          opacity={0.24}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  )
}

export function InkstoneViewer({
  shape,
  pattern,
  patternScale = 1,
}: {
  shape: InkstoneShape
  pattern: InkstonePattern
  patternScale?: number
}) {
  return (
    <Canvas
      dpr={[1, 2]}
      shadows
      camera={{ position: [0, 2.3, 3.9], fov: 34 }}
      gl={{ alpha: true, antialias: true }}
    >
      <ambientLight intensity={0.65} />
      <directionalLight
        position={[4, 6, 4]}
        intensity={2.2}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
      <pointLight position={[-4, 2, -3]} intensity={1.1} color="#8fbfae" />
      <spotLight
        position={[0, 5, 1]}
        angle={0.6}
        penumbra={1}
        intensity={1.5}
        color="#e2d0a6"
      />
      <InkstoneModel
        shape={shape}
        pattern={pattern}
        patternScale={patternScale}
      />
      <ContactShadows
        position={[0, -0.44, 0]}
        opacity={0.45}
        scale={6}
        blur={2.6}
        far={4}
        color="#07110e"
      />
      <OrbitControls
        makeDefault
        enablePan={false}
        autoRotate
        autoRotateSpeed={0.8}
        minDistance={3}
        maxDistance={7}
        minPolarAngle={0.55}
        maxPolarAngle={Math.PI / 2.05}
      />
    </Canvas>
  )
}
