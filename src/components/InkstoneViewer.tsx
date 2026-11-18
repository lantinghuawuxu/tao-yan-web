import { Suspense, useEffect, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import {
  ContactShadows,
  Environment,
  OrbitControls,
  RoundedBox,
} from '@react-three/drei'
import * as THREE from 'three'
import {
  createGroovedBody,
  createShape,
  POOL_FLOOR,
  type InkstoneShape,
  type InkstonePattern,
} from './inkstoneGeometry'
import { useGreenStoneTexture } from './useGreenStoneTexture'

export type { InkstoneShape, InkstonePattern }

function InkstoneModel({
  shape,
  pattern,
}: {
  shape: InkstoneShape
  pattern: InkstonePattern
}) {
  const stonePBR = useGreenStoneTexture('green', 1.2)
  const normalScale = useMemo(() => new THREE.Vector2(0.6, 0.6), [])
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
          map={stonePBR.map}
          normalMap={stonePBR.normalMap}
          roughnessMap={stonePBR.roughnessMap}
          normalScale={normalScale}
          color="#ffffff"
          roughness={0.32}
          metalness={0.03}
          clearcoat={0.4}
          clearcoatRoughness={0.35}
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
