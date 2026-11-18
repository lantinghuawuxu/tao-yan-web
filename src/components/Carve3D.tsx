import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import {
  ContactShadows,
  Environment,
  OrbitControls,
  RoundedBox,
} from '@react-three/drei'
import * as THREE from 'three'
import {
  createCarveBody,
  createShape,
  type InkstoneShape,
  type InkstonePattern,
} from './inkstoneGeometry'
import {
  useGreenStoneTexture,
  type StoneVariant,
} from './useGreenStoneTexture'
import { useRockTextures } from './useRockTextures'

type CarveTool = 'chisel' | 'fine' | 'polish'

const CANVAS_SIZE = 1024
const GUIDE_WIDTH = 2.6
const GUIDE_HEIGHT = 1.6
// 纹样 → 砚池器型映射：不同题材配不同形状的砚池（真实洮砚「因题材定池」）
const PATTERN_SHAPE: Record<InkstonePattern, InkstoneShape> = {
  lotus: '圆形',
  cloud: '椭圆',
  wave: '随形',
  meander: '长方',
}

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

function createGuideTexture(pattern: InkstonePattern, patternScale = 1) {
  const canvas = document.createElement('canvas')
  canvas.width = CANVAS_SIZE
  canvas.height = CANVAS_SIZE
  const context = canvas.getContext('2d')
  if (!context) return null

  const scaleX = (CANVAS_SIZE / GUIDE_WIDTH) * patternScale
  const scaleY = (CANVAS_SIZE / GUIDE_HEIGHT) * patternScale
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
  patternScale,
  showGuide,
  stone,
}: {
  tool: CarveTool
  brushSize: number
  pattern: InkstonePattern
  orbit: boolean
  patternScale: number
  showGuide: boolean
  stone: StoneVariant
}) {
  const heightCanvas = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = CANVAS_SIZE
    canvas.height = CANVAS_SIZE
    const context = canvas.getContext('2d')
    if (context) {
      context.fillStyle = '#000'
      context.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
      // 预置砚池凹陷：让雕刻面在砚池位置下沉，露出下方深色砚池片
      const { pools } = createShape(PATTERN_SHAPE[pattern])
      context.fillStyle = 'rgba(255, 255, 255, 1)'
      for (const pool of pools) {
        const points = pool.getPoints(64)
        context.beginPath()
        points.forEach((point, index) => {
          const px = ((point.x + GUIDE_WIDTH / 2) / GUIDE_WIDTH) * CANVAS_SIZE
          // 注意 Y 反向：shape 的 +Y 经 rotateX(-90°) 映射到世界 -Z，
          // 与池片 ShapeGeometry 的朝向保持一致
          const py = ((GUIDE_HEIGHT / 2 - point.y) / GUIDE_HEIGHT) * CANVAS_SIZE
          if (index === 0) context.moveTo(px, py)
          else context.lineTo(px, py)
        })
        context.closePath()
        context.fill()
      }
    }
    return canvas
  }, [pattern])

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
    () => createGuideTexture(pattern, patternScale),
    [pattern, patternScale],
  )

  const geometry = useMemo(
    () => new THREE.PlaneGeometry(GUIDE_WIDTH, GUIDE_HEIGHT, 240, 180),
    [],
  )

  const poolGeometries = useMemo(
    () =>
      createShape(PATTERN_SHAPE[pattern]).pools.map(
        (pool) => new THREE.ShapeGeometry(pool),
      ),
    [pattern],
  )

  const bodyGeometry = useMemo(
    () => createCarveBody(GUIDE_WIDTH, GUIDE_HEIGHT),
    [],
  )

  const stoneTextures = useRockTextures(2.2)
  const greenStone = useGreenStoneTexture(stone, 2)
  const stoneNormalScale = useMemo(() => new THREE.Vector2(0.12, 0.12), [])

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
  useEffect(
    () => () => {
      for (const pool of poolGeometries) pool.dispose()
    },
    [poolGeometries],
  )
  useEffect(() => () => bodyGeometry.dispose(), [bodyGeometry])

  const paint = (uv: THREE.Vector2) => {
    const heightContext = heightCanvas.getContext('2d')
    const colorContext = colorCanvas.getContext('2d')
    if (!heightContext || !colorContext) return

    const x = uv.x * CANVAS_SIZE
    const y = (1 - uv.y) * CANVAS_SIZE
    const baseRadius =
      Math.max(10, brushSize * 1.2) *
      (tool === 'fine' ? 0.5 : tool === 'polish' ? 1.6 : 1)
    const baseAlpha = tool === 'polish' ? 0.12 : tool === 'fine' ? 0.4 : 0.28

    const stamp = (
      stampX: number,
      stampY: number,
      dirX: number,
      dirY: number,
      pressure: number,
    ) => {
      const radius = baseRadius * (tool === 'polish' ? 1 : pressure)
      const alpha = Math.min(1, baseAlpha * pressure)
      const angle = Math.atan2(dirY, dirX)

      heightContext.save()
      heightContext.translate(stampX, stampY)
      heightContext.rotate(angle)

      if (tool === 'chisel') {
        // 楔形 V 槽：沿刀口方向拉伸成刃，垂直方向线性渐变做出「中间深、两侧浅」的 V 形
        const length = radius * 2.2
        const width = radius * 0.5
        const vGradient = heightContext.createLinearGradient(0, -width, 0, width)
        vGradient.addColorStop(0, 'rgba(255, 255, 255, 0)')
        vGradient.addColorStop(0.5, `rgba(255, 255, 255, ${alpha})`)
        vGradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
        heightContext.fillStyle = vGradient
        heightContext.beginPath()
        heightContext.ellipse(0, 0, length, width, 0, 0, Math.PI * 2)
        heightContext.fill()
      } else if (tool === 'fine') {
        // 窄 U 槽：硬边、短刃
        const length = radius * 1.5
        const width = radius * 0.7
        const uGradient = heightContext.createRadialGradient(
          0,
          0,
          0,
          0,
          0,
          width,
        )
        uGradient.addColorStop(0, `rgba(255, 255, 255, ${alpha})`)
        uGradient.addColorStop(0.7, `rgba(255, 255, 255, ${alpha * 0.9})`)
        uGradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
        heightContext.fillStyle = uGradient
        heightContext.beginPath()
        heightContext.ellipse(0, 0, length, width, 0, 0, Math.PI * 2)
        heightContext.fill()
      } else {
        // polish 软高斯柔化
        const softGradient = heightContext.createRadialGradient(
          0,
          0,
          0,
          0,
          0,
          radius,
        )
        softGradient.addColorStop(0, `rgba(255, 255, 255, ${alpha})`)
        softGradient.addColorStop(0.4, `rgba(255, 255, 255, ${alpha * 0.6})`)
        softGradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
        heightContext.fillStyle = softGradient
        heightContext.beginPath()
        heightContext.arc(0, 0, radius, 0, Math.PI * 2)
        heightContext.fill()
      }
      heightContext.restore()

      const colorAlpha = tool === 'polish' ? 0.12 : tool === 'fine' ? 0.32 : 0.42
      const colorRadius = radius * 0.85
      const colorGradient = colorContext.createRadialGradient(
        stampX,
        stampY,
        0,
        stampX,
        stampY,
        colorRadius,
      )
      colorGradient.addColorStop(0, `rgba(4, 11, 8, ${colorAlpha})`)
      colorGradient.addColorStop(0.65, `rgba(4, 11, 8, ${colorAlpha * 0.55})`)
      colorGradient.addColorStop(1, 'rgba(4, 11, 8, 0)')
      colorContext.fillStyle = colorGradient
      colorContext.beginPath()
      colorContext.arc(stampX, stampY, colorRadius, 0, Math.PI * 2)
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
      const dirX = distance > 0 ? dx / distance : 1
      const dirY = distance > 0 ? dy / distance : 0
      // 速度压力：慢刀重、快刀轻
      const pressure = Math.max(0.6, Math.min(1.15, 1.3 - distance / 40))
      const steps = Math.max(
        1,
        Math.ceil(distance / Math.max(2, baseRadius * 0.18)),
      )
      for (let step = 1; step <= steps; step += 1) {
        const progress = step / steps
        // 顿挫：刻刀/细刻走刀时沿垂直方向轻微摆动，模拟手工刀痕
        const jitter =
          tool === 'polish' ? 0 : (Math.random() - 0.5) * baseRadius * 0.3
        stamp(
          lastX + dx * progress - jitter * dirY,
          lastY + dy * progress + jitter * dirX,
          dirX,
          dirY,
          pressure,
        )
      }
    } else {
      stamp(x, y, 1, 0, 1)
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
        position={[0, 0.2, 0]}
        receiveShadow
        renderOrder={0}
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
          roughness={0.32}
          metalness={0.03}
          clearcoat={0.4}
          clearcoatRoughness={0.35}
          displacementMap={heightTexture}
          displacementScale={-0.08}
          emissive="#ffffff"
          emissiveMap={guideTexture ?? undefined}
          emissiveIntensity={showGuide ? 0.9 : 0}
        />
      </mesh>

      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.201, 0]}
        raycast={() => {}}
        renderOrder={1}
      >
        <planeGeometry args={[GUIDE_WIDTH, GUIDE_HEIGHT]} />
        <meshBasicMaterial
          map={colorTexture}
          transparent
          depthWrite={false}
          side={THREE.FrontSide}
        />
      </mesh>

      {/* 砚身：圆角矩形砚边（边框），中央开口露出雕刻面 */}
      <mesh
        geometry={bodyGeometry}
        position={[0, 0.21, 0]}
        raycast={() => {}}
        castShadow
        receiveShadow
      >
        <meshPhysicalMaterial
          map={greenStone}
          normalMap={stoneTextures.normalMap}
          roughnessMap={stoneTextures.roughnessMap}
          normalScale={stoneNormalScale}
          color="#ffffff"
          roughness={0.32}
          metalness={0.03}
          clearcoat={0.4}
          clearcoatRoughness={0.35}
        />
      </mesh>

      {/* 砚池深色池片：沉在雕刻面下方，露出深色水窝 */}
      {poolGeometries.map((pool, index) => (
        <mesh
          key={index}
          geometry={pool}
          position={[0, 0.13, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          raycast={() => {}}
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

      {/* 木质底座 */}
      <RoundedBox
        args={[2.9, 0.12, 1.9]}
        radius={0.06}
        smoothness={4}
        position={[0, -0.15, 0]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color="#2b1b12" roughness={0.72} />
      </RoundedBox>
    </group>
  )
}

export function Carve3D({
  tool,
  brushSize,
  pattern,
  orbit,
  patternScale,
  showGuide,
  stone = 'green',
  onCaptureReady,
}: {
  tool: CarveTool
  brushSize: number
  pattern: InkstonePattern
  orbit: boolean
  patternScale: number
  showGuide: boolean
  stone?: StoneVariant
  onCaptureReady?: (capture: () => string | null) => void
}) {
  return (
    <Canvas
      dpr={[1, 2]}
      shadows
      camera={{ position: [0, 2.6, 3.8], fov: 35 }}
      gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }}
      onCreated={(state) => {
        onCaptureReady?.(() => state.gl.domElement.toDataURL('image/png'))
      }}
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
        patternScale={patternScale}
        showGuide={showGuide}
        stone={stone}
      />
      <ContactShadows
        position={[0, -0.23, 0]}
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

