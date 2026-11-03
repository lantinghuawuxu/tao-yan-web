import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { ContactShadows, Environment } from '@react-three/drei'
import * as THREE from 'three'
import { useGreenStoneTexture } from './useGreenStoneTexture'
import { useRockTextures } from './useRockTextures'

type CarveTool = 'chisel' | 'fine' | 'polish'

const CANVAS_SIZE = 1024

function CarveSurface({
  tool,
  brushSize,
}: {
  tool: CarveTool
  brushSize: number
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

  const heightTexture = useMemo(() => {
    const texture = new THREE.CanvasTexture(heightCanvas)
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.colorSpace = THREE.NoColorSpace
    texture.needsUpdate = true
    return texture
  }, [heightCanvas])

  const geometry = useMemo(
    () => new THREE.PlaneGeometry(2.6, 1.6, 240, 180),
    [],
  )

  const stoneTextures = useRockTextures(2.2)
  const greenStone = useGreenStoneTexture(2)
  const stoneNormalScale = useMemo(() => new THREE.Vector2(0.3, 0.3), [])

  const heightTextureRef = useRef(heightTexture)
  const drawingRef = useRef(false)
  const lastUvRef = useRef<THREE.Vector2 | null>(null)

  useEffect(() => {
    heightTextureRef.current = heightTexture
  }, [heightTexture])

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => heightTexture.dispose(), [heightTexture])

  const paint = (uv: THREE.Vector2) => {
    const context = heightCanvas.getContext('2d')
    if (!context) return

    const x = uv.x * CANVAS_SIZE
    const y = (1 - uv.y) * CANVAS_SIZE
    const radius =
      Math.max(10, brushSize * 1.2) *
      (tool === 'fine' ? 0.5 : tool === 'polish' ? 1.6 : 1)
    const alpha = tool === 'polish' ? 0.22 : 0.9

    const stamp = (stampX: number, stampY: number) => {
      const gradient = context.createRadialGradient(
        stampX,
        stampY,
        0,
        stampX,
        stampY,
        radius,
      )
      gradient.addColorStop(0, `rgba(255, 255, 255, ${alpha})`)
      gradient.addColorStop(
        tool === 'polish' ? 0.35 : 0.62,
        `rgba(255, 255, 255, ${alpha * 0.85})`,
      )
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
      context.fillStyle = gradient
      context.beginPath()
      context.arc(stampX, stampY, radius, 0, Math.PI * 2)
      context.fill()
    }

    context.save()
    context.globalCompositeOperation = 'lighter'

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

    context.restore()
    lastUvRef.current = uv.clone()
    heightTextureRef.current.needsUpdate = true
  }

  return (
    <group rotation={[0.08, -0.25, 0.01]}>
      <mesh
        geometry={geometry}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.21, 0]}
        receiveShadow
        onPointerDown={(event) => {
          event.stopPropagation()
          drawingRef.current = true
          lastUvRef.current = null
          if (event.uv) paint(event.uv)
        }}
        onPointerMove={(event) => {
          if (drawingRef.current && event.uv) paint(event.uv)
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
        <meshStandardMaterial
          map={greenStone}
          normalMap={stoneTextures.normalMap}
          roughnessMap={stoneTextures.roughnessMap}
          normalScale={stoneNormalScale}
          color="#ffffff"
          roughness={0.65}
          metalness={0.02}
          displacementMap={heightTexture}
          displacementScale={-0.2}
          bumpMap={heightTexture}
          bumpScale={0.4}
        />
      </mesh>

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
}: {
  tool: CarveTool
  brushSize: number
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
          environmentIntensity={0.25}
        />
      </Suspense>
      <ambientLight intensity={0.4} />
      <directionalLight
        position={[4, 6, 4]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
      <pointLight position={[-4, 2, -3]} intensity={0.8} color="#8fbfae" />
      <spotLight
        position={[0, 5, 1]}
        angle={0.6}
        penumbra={1}
        intensity={1}
        color="#e2d0a6"
      />
      <CarveSurface tool={tool} brushSize={brushSize} />
      <ContactShadows
        position={[0, -0.22, 0]}
        opacity={0.45}
        scale={6}
        blur={2.6}
        far={4}
        color="#07110e"
      />
    </Canvas>
  )
}
