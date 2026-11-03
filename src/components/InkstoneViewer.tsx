import { Suspense, useEffect, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import {
  ContactShadows,
  Environment,
  OrbitControls,
  RoundedBox,
} from '@react-three/drei'
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg'
import * as THREE from 'three'
import { useGreenStoneTexture } from './useGreenStoneTexture'
import { useRockTextures } from './useRockTextures'

export type InkstoneShape = '随形' | '长方' | '椭圆' | '圆形' | '双池'
export type InkstonePattern = 'lotus' | 'cloud' | 'wave' | 'meander'

const THICKNESS = 0.24
const POOL_FLOOR = -THICKNESS + 0.035
const BODY_TOP = 0.025
const GROOVE_WIDTH = 0.022
const GROOVE_HEIGHT = 0.034
const evaluator = new Evaluator()

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

function patternPolylines(shape: InkstoneShape, pattern: InkstonePattern) {
  const { outer } = createShape(shape)
  const lines: THREE.Vector2[][] = []

  for (const scale of [0.86, 0.79]) {
    const ring = outer.getPoints(48).map((point) => point.clone().multiplyScalar(scale))
    ring.push(ring[0].clone())
    lines.push(ring)
  }

  if (pattern === 'lotus') {
    for (let i = 0; i < 10; i += 1) {
      const angle = (i / 10) * Math.PI * 2
      const center = new THREE.Vector2(
        Math.cos(angle) * 0.92,
        Math.sin(angle) * 0.62,
      )
      const direction = new THREE.Vector2(Math.cos(angle), Math.sin(angle))
      const side = new THREE.Vector2(-Math.sin(angle), Math.cos(angle))
      const petal: THREE.Vector2[] = []
      for (let step = 0; step <= 8; step += 1) {
        const t = step / 8
        petal.push(
          center
            .clone()
            .addScaledVector(direction, -0.08 + 0.2 * t)
            .addScaledVector(side, Math.sin(Math.PI * t) * 0.05),
        )
      }
      for (let step = 7; step >= 0; step -= 1) {
        const t = step / 8
        petal.push(
          center
            .clone()
            .addScaledVector(direction, -0.08 + 0.2 * t)
            .addScaledVector(side, -Math.sin(Math.PI * t) * 0.05),
        )
      }
      lines.push(petal)
    }
    return lines
  }

  if (pattern === 'cloud') {
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2
      const centerX = Math.cos(angle) * 0.92
      const centerY = Math.sin(angle) * 0.62
      const arc: THREE.Vector2[] = []
      for (let step = 0; step <= 8; step += 1) {
        const arcAngle = angle + (step / 8) * Math.PI * 1.1
        arc.push(
          new THREE.Vector2(
            centerX + Math.cos(arcAngle) * 0.12,
            centerY + Math.sin(arcAngle) * 0.12,
          ),
        )
      }
      lines.push(arc)
    }
    return lines
  }

  if (pattern === 'wave') {
    for (let ring = 0; ring < 3; ring += 1) {
      const rx = 0.6 + ring * 0.14
      const ry = 0.4 + ring * 0.1
      const wave: THREE.Vector2[] = []
      for (let step = 0; step <= 64; step += 1) {
        const angle = (step / 64) * Math.PI * 2
        const wobble = 1 + Math.sin(angle * 8 + ring * 1.2) * 0.025
        wave.push(
          new THREE.Vector2(
            Math.cos(angle) * rx * wobble,
            Math.sin(angle) * ry * wobble,
          ),
        )
      }
      lines.push(wave)
    }
    return lines
  }

  for (let i = 0; i < 10; i += 1) {
    const angle = (i / 10) * Math.PI * 2
    const center = new THREE.Vector2(
      Math.cos(angle) * 0.92,
      Math.sin(angle) * 0.62,
    )
    const rotation = angle + Math.PI / 2
    const local = [
      new THREE.Vector2(-0.07, -0.07),
      new THREE.Vector2(0.07, -0.07),
      new THREE.Vector2(0.07, 0.07),
      new THREE.Vector2(-0.03, 0.07),
      new THREE.Vector2(-0.03, 0),
      new THREE.Vector2(0.02, 0),
    ]
    lines.push(
      local.map(
        (point) =>
          new THREE.Vector2(
            center.x + point.x * Math.cos(rotation) - point.y * Math.sin(rotation),
            center.y + point.x * Math.sin(rotation) + point.y * Math.cos(rotation),
          ),
      ),
    )
  }

  return lines
}

function mergeBoxes(geometries: THREE.BufferGeometry[]) {
  let vertexCount = 0
  let indexCount = 0
  for (const geometry of geometries) {
    vertexCount += geometry.attributes.position.count
    indexCount += geometry.index?.count ?? 0
  }

  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  const indices = new Uint32Array(indexCount)
  let vertexOffset = 0
  let indexOffset = 0
  let vertexBase = 0

  for (const geometry of geometries) {
    const position = geometry.getAttribute('position') as THREE.BufferAttribute
    const normal = geometry.getAttribute('normal') as THREE.BufferAttribute
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute
    positions.set(position.array as Float32Array, vertexOffset * 3)
    normals.set(normal.array as Float32Array, vertexOffset * 3)
    uvs.set(uv.array as Float32Array, vertexOffset * 2)
    if (geometry.index) {
      for (let i = 0; i < geometry.index.count; i += 1) {
        indices[indexOffset + i] = geometry.index.getX(i) + vertexBase
      }
      indexOffset += geometry.index.count
    }
    vertexOffset += position.count
    vertexBase += position.count
  }

  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  merged.setIndex(new THREE.BufferAttribute(indices, 1))
  return merged
}

function createGrooveGeometry(lines: THREE.Vector2[][]) {
  const boxes: THREE.BufferGeometry[] = []
  const centerY = BODY_TOP + 0.002 - GROOVE_HEIGHT / 2

  for (const line of lines) {
    for (let i = 0; i < line.length - 1; i += 1) {
      const from = line[i]
      const to = line[i + 1]
      const fromX = from.x
      const fromZ = -from.y
      const toX = to.x
      const toZ = -to.y
      const dx = toX - fromX
      const dz = toZ - fromZ
      const length = Math.hypot(dx, dz)
      if (length < 0.002) continue

      const box = new THREE.BoxGeometry(
        length + GROOVE_WIDTH,
        GROOVE_HEIGHT,
        GROOVE_WIDTH,
      )
      const matrix = new THREE.Matrix4()
      matrix.makeRotationY(Math.atan2(-dz, dx))
      matrix.setPosition((fromX + toX) / 2, centerY, (fromZ + toZ) / 2)
      box.applyMatrix4(matrix)
      boxes.push(box)
    }
  }

  if (boxes.length === 0) return null
  const merged = mergeBoxes(boxes)
  for (const box of boxes) box.dispose()
  return merged
}

function createGroovedBody(shape: InkstoneShape, pattern: InkstonePattern) {
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

  const grooves = createGrooveGeometry(patternPolylines(shape, pattern))
  if (!grooves) return body

  const bodyBrush = new Brush(body)
  const grooveBrush = new Brush(grooves)
  bodyBrush.updateMatrixWorld()
  grooveBrush.updateMatrixWorld()

  const result = evaluator.evaluate(bodyBrush, grooveBrush, SUBTRACTION)
  const geometry = result.geometry
  geometry.computeVertexNormals()
  body.dispose()
  grooves.dispose()
  return geometry
}

function InkstoneModel({
  shape,
  pattern,
}: {
  shape: InkstoneShape
  pattern: InkstonePattern
}) {
  const stoneTextures = useRockTextures(1.2)
  const greenStone = useGreenStoneTexture(1.2)
  const normalScale = useMemo(() => new THREE.Vector2(0.45, 0.45), [])
  const model = useMemo(() => {
    const body = createGroovedBody(shape, pattern)
    const parts = createShape(shape)
    return {
      body,
      pools: parts.pools.map((pool) => new THREE.ShapeGeometry(pool)),
    }
  }, [shape, pattern])

  useEffect(() => {
    return () => {
      model.body.dispose()
      for (const pool of model.pools) pool.dispose()
    }
  }, [model])

  return (
    <group position={[0, 0.05, 0]} rotation={[0.12, -0.4, 0.02]}>
      <mesh geometry={model.body} castShadow receiveShadow>
        <meshPhysicalMaterial
          map={greenStone}
          normalMap={stoneTextures.normalMap}
          roughnessMap={stoneTextures.roughnessMap}
          normalScale={normalScale}
          color="#ffffff"
          roughness={0.55}
          metalness={0.03}
          clearcoat={0.22}
          clearcoatRoughness={0.5}
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
}: {
  shape: InkstoneShape
  pattern: InkstonePattern
}) {
  return (
    <Canvas
      dpr={[1, 2]}
      shadows
      camera={{ position: [0, 2.3, 3.9], fov: 34 }}
      gl={{ alpha: true, antialias: true }}
    >
      <Suspense fallback={null}>
        <Environment
          files="models/hdri/studio_small_08_1k.hdr"
          background={false}
          environmentIntensity={0.2}
        />
      </Suspense>
      <ambientLight intensity={0.35} />
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
      <InkstoneModel shape={shape} pattern={pattern} />
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
