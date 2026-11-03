import { useEffect, useMemo, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { ContactShadows } from '@react-three/drei'
import * as THREE from 'three'

type CarveTool = 'chisel' | 'fine' | 'polish'

const CANVAS_SIZE = 512

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
    () => new THREE.PlaneGeometry(2.6, 1.6, 140, 100),
    [],
  )

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
      Math.max(6, brushSize * 0.8) *
      (tool === 'fine' ? 0.5 : tool === 'polish' ? 1.6 : 1)

    context.save()
    context.globalAlpha = tool === 'polish' ? 0.22 : 1
    context.strokeStyle = '#fff'
    context.fillStyle = '#fff'
    context.lineCap = 'round'
    context.lineJoin = 'round'

    if (lastUvRef.current) {
      const lastX = lastUvRef.current.x * CANVAS_SIZE
      const lastY = (1 - lastUvRef.current.y) * CANVAS_SIZE
      context.lineWidth = radius * 2
      context.beginPath()
      context.moveTo(lastX, lastY)
      context.lineTo(x, y)
      context.stroke()
    }

    context.beginPath()
    context.arc(x, y, radius, 0, Math.PI * 2)
    context.fill()
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
          color="#5f7f70"
          roughness={0.78}
          metalness={0.02}
          displacementMap={heightTexture}
          displacementScale={-0.2}
          bumpMap={heightTexture}
          bumpScale={0.5}
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
      <ambientLight intensity={0.75} />
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
        intensity={1.4}
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
