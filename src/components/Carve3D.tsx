import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import {
  ContactShadows,
  Environment,
  OrbitControls,
} from '@react-three/drei'
import * as THREE from 'three'
import type { InkstonePattern } from './InkstoneViewer'
import { useGreenStoneTexture } from './useGreenStoneTexture'
import { useRockTextures } from './useRockTextures'

type CarveTool = 'chisel' | 'fine' | 'polish'

const CANVAS_SIZE = 1024
const GUIDE_WIDTH = 2.6
const GUIDE_HEIGHT = 1.6

function roundedRectPath(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  radius: number,
) {
  const x = -width / 2
  const y = -height / 2
  const r = Math.min(radius, width / 2, height / 2)
  context.beginPath()
  context.moveTo(x + r, y)
  context.lineTo(x + width - r, y)
  context.quadraticCurveTo(x + width, y, x + width, y + r)
  context.lineTo(x + width, y + height - r)
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  context.lineTo(x + r, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - r)
  context.lineTo(x, y + r)
  context.quadraticCurveTo(x, y, x + r, y)
  context.closePath()
}

function createGuideTexture(pattern: InkstonePattern) {
  const canvas = document.createElement('canvas')
  canvas.width = CANVAS_SIZE
  canvas.height = CANVAS_SIZE
  const context = canvas.getContext('2d')
  if (!context) return null

  const scaleX = CANVAS_SIZE / 2.8
  const scaleY = CANVAS_SIZE / 1.8
  context.setTransform(
    scaleX,
    0,
    0,
    -scaleY,
    CANVAS_SIZE / 2,
    CANVAS_SIZE / 2,
  )
  context.strokeStyle = 'rgba(199, 168, 107, 0.9)'
  context.lineWidth = 0.012
  context.lineCap = 'round'
  context.lineJoin = 'round'

  roundedRectPath(context, 2.2, 1.2, 0.18)
  context.stroke()
  roundedRectPath(context, 2.0, 1.02, 0.16)
  context.stroke()

  if (pattern === 'lotus') {
    for (let i = 0; i < 10; i += 1) {
      const angle = (i / 10) * Math.PI * 2
      context.save()
      context.translate(Math.cos(angle) * 0.85, Math.sin(angle) * 0.52)
      context.rotate(angle + Math.PI / 2)
      context.beginPath()
      context.ellipse(0, 0, 0.055, 0.13, 0, 0, Math.PI * 2)
      context.stroke()
      context.restore()
    }
  } else if (pattern === 'cloud') {
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2
      context.beginPath()
      context.arc(
        Math.cos(angle) * 0.85,
        Math.sin(angle) * 0.52,
        0.12,
        angle,
        angle + Math.PI * 1.1,
      )
      context.stroke()
    }
  } else if (pattern === 'wave') {
    for (let ring = 0; ring < 3; ring += 1) {
      const rx = 0.55 + ring * 0.15
      const ry = 0.35 + ring * 0.1
      context.beginPath()
      for (let step = 0; step <= 64; step += 1) {
        const angle = (step / 64) * Math.PI * 2
        const wobble = 1 + Math.sin(angle * 8 + ring * 1.2) * 0.025
        const x = Math.cos(angle) * rx * wobble
        const y = Math.sin(angle) * ry * wobble
        if (step === 0) context.moveTo(x, y)
        else context.lineTo(x, y)
      }
      context.closePath()
      context.stroke()
    }
  } else {
    for (let i = 0; i < 10; i += 1) {
      const angle = (i / 10) * Math.PI * 2
      context.save()
      context.translate(Math.cos(angle) * 0.85, Math.sin(angle) * 0.52)
      context.rotate(angle + Math.PI / 2)
      context.beginPath()
      context.moveTo(-0.07, -0.07)
      context.lineTo(0.07, -0.07)
      context.lineTo(0.07, 0.07)
      context.lineTo(-0.03, 0.07)
      context.lineTo(-0.03, 0)
      context.lineTo(0.02, 0)
      context.stroke()
      context.restore()
    }
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  texture.needsUpdate = true
  return texture
}

function CarveSurface({
  tool,
  brushSize,
  pattern,
  orbit,
}: {
  tool: CarveTool
  brushSize: number
  pattern: InkstonePattern
  orbit: boolean
}) {
  const heightCanvas = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = CANVAS_SIZE
    canvas.height = CANVAS_SIZE
    const context = canvas.getContext('2d')
    if (context) {
      context.fillStyle = '#000'
      context.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
    }
    return canvas
  }, [])

  const colorCanvas = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = CANVAS_SIZE
    canvas.height = CANVAS_SIZE
    return canvas
  }, [])

  const heightTexture = useMemo(() => {
    const texture = new THREE.CanvasTexture(heightCanvas)
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.colorSpace = THREE.NoColorSpace
    texture.needsUpdate = true
    return texture
  }, [heightCanvas])

  const colorTexture = useMemo(() => {
    const texture = new THREE.CanvasTexture(colorCanvas)
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.colorSpace = THREE.SRGBColorSpace
    texture.needsUpdate = true
    return texture
  }, [colorCanvas])

  const guideTexture = useMemo(
    () => createGuideTexture(pattern),
    [pattern],
  )

  const geometry = useMemo(
    () => new THREE.PlaneGeometry(GUIDE_WIDTH, GUIDE_HEIGHT, 240, 180),
    [],
  )

  const stoneTextures = useRockTextures(2.2)
  const greenStone = useGreenStoneTexture(2)
  const stoneNormalScale = useMemo(() => new THREE.Vector2(0.3, 0.3), [])

  const heightTextureRef = useRef(heightTexture)
  const colorTextureRef = useRef(colorTexture)
  const drawingRef = useRef(false)
  const lastUvRef = useRef<THREE.Vector2 | null>(null)

  useEffect(() => {
    heightTextureRef.current = heightTexture
    colorTextureRef.current = colorTexture
  }, [heightTexture, colorTexture])

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => heightTexture.dispose(), [heightTexture])
  useEffect(() => () => colorTexture.dispose(), [colorTexture])
  useEffect(() => () => guideTexture?.dispose(), [guideTexture])

  const paint = (uv: THREE.Vector2) => {
    const heightContext = heightCanvas.getContext('2d')
    const colorContext = colorCanvas.getContext('2d')
    if (!heightContext || !colorContext) return

    const x = uv.x * CANVAS_SIZE
    const y = (1 - uv.y) * CANVAS_SIZE
    const radius =
      Math.max(10, brushSize * 1.2) *
      (tool === 'fine' ? 0.5 : tool === 'polish' ? 1.6 : 1)
    const alpha = tool === 'polish' ? 0.22 : 0.9

    const stamp = (stampX: number, stampY: number) => {
      const heightGradient = heightContext.createRadialGradient(
        stampX,
        stampY,
        0,
        stampX,
        stampY,
        radius,
      )
      heightGradient.addColorStop(0, `rgba(255, 255, 255, ${alpha})`)
      heightGradient.addColorStop(
        tool === 'polish' ? 0.35 : 0.62,
        `rgba(255, 255, 255, ${alpha * 0.85})`,
      )
      heightGradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
      heightContext.fillStyle = heightGradient
      heightContext.beginPath()
      heightContext.arc(stampX, stampY, radius, 0, Math.PI * 2)
      heightContext.fill()

      const colorGradient = colorContext.createRadialGradient(
        stampX,
        stampY,
        0,
        stampX,
        stampY,
        radius,
      )
      const colorAlpha = tool === 'polish' ? 0.04 : 0.1
      colorGradient.addColorStop(0, `rgba(6, 14, 11, ${colorAlpha})`)
      colorGradient.addColorStop(0.65, `rgba(6, 14, 11, ${colorAlpha * 0.55})`)
      colorGradient.addColorStop(1, 'rgba(6, 14, 11, 0)')
      colorContext.fillStyle = colorGradient
      colorContext.beginPath()
      colorContext.arc(stampX, stampY, radius, 0, Math.PI * 2)
      colorContext.fill()
    }

    heightContext.save()
    heightContext.globalCompositeOperation = 'lighter'
    colorContext.save()
    colorContext.globalCompositeOperation = 'source-over'

    if (lastUvRef.current) {
      const lastX = lastUvRef.current.x * CANVAS_SIZE
      const lastY = (1 - lastUvRef.current.y) * CANVAS_SIZE
      const dx = x - lastX
      const dy = y - lastY
      const distance = Math.hypot(dx, dy)
      const steps = Math.max(
        1,
        Math.ceil(distance / Math.max(2, radius * 0.18)),
      )
      for (let step = 1; step <= steps; step += 1) {
        const progress = step / steps
        stamp(lastX + dx * progress, lastY + dy * progress)
      }
    } else {
      stamp(x, y)
    }

    heightContext.restore()
    colorContext.restore()
    lastUvRef.current = uv.clone()
    heightTextureRef.current.needsUpdate = true
    colorTextureRef.current.needsUpdate = true
  }

  return (
    <group rotation={[0.08, -0.25, 0.01]}>
      <mesh
        geometry={geometry}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.21, 0]}
        receiveShadow
        onPointerDown={(event) => {
          if (orbit) return
          event.stopPropagation()
          drawingRef.current = true
          lastUvRef.current = null
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
      >
        <meshPhysicalMaterial
          map={greenStone}
          normalMap={stoneTextures.normalMap}
          roughnessMap={stoneTextures.roughnessMap}
          normalScale={stoneNormalScale}
          color="#ffffff"
          roughness={0.55}
          metalness={0.03}
          clearcoat={0.2}
          clearcoatRoughness={0.45}
          displacementMap={heightTexture}
          displacementScale={-0.12}
          bumpMap={heightTexture}
          bumpScale={0.45}
        />
      </mesh>

      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.211, 0]}
        raycast={() => {}}
      >
        <planeGeometry args={[GUIDE_WIDTH, GUIDE_HEIGHT]} />
        <meshBasicMaterial
          map={colorTexture}
          transparent
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {guideTexture && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.212, 0]}
          raycast={() => {}}
        >
          <planeGeometry args={[GUIDE_WIDTH, GUIDE_HEIGHT]} />
          <meshBasicMaterial
            map={guideTexture}
            transparent
            depthWrite={false}
            opacity={0.7}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      <mesh position={[-1.37, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.14, 0.4, 1.88]} />
        <meshStandardMaterial color="#3f5a4c" roughness={0.62} />
      </mesh>
      <mesh position={[1.37, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.14, 0.4, 1.88]} />
        <meshStandardMaterial color="#3f5a4c" roughness={0.62} />
      </mesh>
      <mesh position={[0, 0, -0.87]} castShadow receiveShadow>
        <boxGeometry args={[2.88, 0.4, 0.14]} />
        <meshStandardMaterial color="#3f5a4c" roughness={0.62} />
      </mesh>
      <mesh position={[0, 0, 0.87]} castShadow receiveShadow>
        <boxGeometry args={[2.88, 0.4, 0.14]} />
        <meshStandardMaterial color="#3f5a4c" roughness={0.62} />
      </mesh>
      <mesh position={[0, -0.19, 0]} receiveShadow>
        <boxGeometry args={[2.88, 0.04, 1.88]} />
        <meshStandardMaterial color="#2b1b12" roughness={0.72} />
      </mesh>
    </group>
  )
}

export function Carve3D({
  tool,
  brushSize,
  pattern,
  orbit,
}: {
  tool: CarveTool
  brushSize: number
  pattern: InkstonePattern
  orbit: boolean
}) {
  return (
    <Canvas
      dpr={[1, 2]}
      shadows
      camera={{ position: [0, 2.6, 3.8], fov: 35 }}
      gl={{ alpha: true, antialias: true }}
    >
      <Suspense fallback={null}>
        <Environment
          files="models/hdri/studio_small_08_1k.hdr"
          background={false}
          environmentIntensity={0.3}
        />
      </Suspense>
      <ambientLight intensity={0.4} />
      <directionalLight
        position={[4, 6, 4]}
        intensity={1.7}
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
      />
      <ContactShadows
        position={[0, -0.22, 0]}
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
        minDistance={2.6}
        maxDistance={7}
        minPolarAngle={0.35}
        maxPolarAngle={Math.PI / 2.2}
        target={[0, 0, 0]}
      />
    </Canvas>
  )
}

