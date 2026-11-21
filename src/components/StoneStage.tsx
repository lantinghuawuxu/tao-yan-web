import { Suspense, useEffect, useMemo } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import {
  ContactShadows,
  Environment,
  OrbitControls,
  useGLTF,
} from '@react-three/drei'
import * as THREE from 'three'
import { asset } from '../lib/asset'
import { useIsMobile } from '../lib/useIsMobile'

const MODEL_URL = asset('models/boulder_01/boulder_01_1k.gltf')
const HDR_URL = asset('models/hdri/studio_small_08_1k.hdr')

// 注意：这里没有 useGLTF.preload()。
// 模块级 preload 意味着「JS 一解析就立刻拉 5.5MB 资源」，
// 首屏图片会被挤到最后。现在改为模型只在 StoneStage 真正被挂载时按需加载，
// 而 StoneStage 只在舞台接近视口时才挂载（见 LazyStage）。

function StoneModel() {
  const { scene } = useGLTF(MODEL_URL)

  const model = useMemo(() => {
    const clone = scene.clone(true)
    clone.updateMatrixWorld(true)

    const box = new THREE.Box3().setFromObject(clone)
    const size = box.getSize(new THREE.Vector3())
    const maxDimension = Math.max(size.x, size.y, size.z)
    const scale = 2.4 / maxDimension
    clone.scale.setScalar(scale)
    clone.updateMatrixWorld(true)

    const scaledBox = new THREE.Box3().setFromObject(clone)
    const center = scaledBox.getCenter(new THREE.Vector3())
    clone.position.x -= center.x
    clone.position.z -= center.z
    clone.position.y -= scaledBox.min.y + 1.0

    clone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true
        child.receiveShadow = true
        const materials = Array.isArray(child.material)
          ? child.material
          : [child.material]
        const tinted = materials.map((material) => {
          const next = material.clone()
          if (next instanceof THREE.MeshStandardMaterial) {
            next.color.set('#7f9d8c')
            next.roughness = 0.88
            next.metalness = 0.02
            next.envMapIntensity = 0.6
          }
          return next
        })
        child.material = Array.isArray(child.material)
          ? tinted
          : tinted[0]
      }
    })

    return clone
  }, [scene])

  useEffect(() => {
    return () => {
      model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const materials = Array.isArray(child.material)
            ? child.material
            : [child.material]
          for (const material of materials) material.dispose()
        }
      })
    }
  }, [model])

  return (
    <group rotation={[0.16, -0.5, 0.08]}>
      <primitive object={model} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.02, 0]}>
        <ringGeometry args={[1.6, 1.68, 96]} />
        <meshBasicMaterial
          color="#c7a86b"
          transparent
          opacity={0.42}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  )
}

/**
 * frameloop 从 'never' 切回 'demand' 时，R3F 不会自己补一帧。
 * 重新进入视口时手动 invalidate 一次，避免「滚回来看到一张空白画布」。
 */
function ResumeOnVisible({ inView }: { inView: boolean }) {
  const invalidate = useThree((state) => state.invalidate)
  useEffect(() => {
    if (inView) invalidate()
  }, [inView, invalidate])
  return null
}

/**
 * 把降级决策写到 canvas 的 data-* 上：线上排查「为什么这台手机卡」时，
 * 不用猜是走了哪套配置，直接看 DOM 就知道（也给自动化测试留了抓手）。
 */
function StageDiagnostics({
  mode,
  frameloop,
}: {
  mode: 'lite' | 'full'
  frameloop: string
}) {
  const gl = useThree((state) => state.gl)
  useEffect(() => {
    // 用 setAttribute 而不是 canvas.dataset.x = ...：后者会被 lint 判定为
    // 「修改了从 hook 里拿到的对象」，其实改的是 DOM 属性，不是 three 对象
    const canvas = gl.domElement
    canvas.setAttribute('data-stage-mode', mode)
    canvas.setAttribute('data-frameloop', frameloop)
    canvas.setAttribute('data-dpr', String(gl.getPixelRatio()))
  }, [gl, mode, frameloop])
  return null
}

export function StoneStage({ inView }: { inView: boolean }) {
  const isMobile = useIsMobile()

  // 移动端：不挂 Environment（1.4MB HDR），改用半球光补足环境亮度；
  // 关阴影与 ContactShadows（各一次阴影 pass），关自动旋转，
  // 帧率交给 'demand'（只有用户拖拽/缩放时才重绘）。
  const frameloop = !inView ? 'never' : isMobile ? 'demand' : 'always'

  return (
    <Canvas
      dpr={isMobile ? [1, 1.5] : [1, 2]}
      shadows={!isMobile}
      frameloop={frameloop}
      camera={{ position: [0, 1.3, 5.2], fov: 38 }}
      gl={{ alpha: true, antialias: true }}
    >
      <ambientLight intensity={isMobile ? 0.85 : 0.55} />
      {isMobile && (
        <hemisphereLight
          intensity={1.15}
          color="#e4ece5"
          groundColor="#0a1713"
        />
      )}
      <directionalLight
        position={[4, 6, 4]}
        intensity={2.4}
        castShadow={!isMobile}
        shadow-mapSize={[1024, 1024]}
      />
      <pointLight position={[-4, -2, -3]} intensity={1.4} color="#8fbfae" />
      <spotLight
        position={[0, 5, 1]}
        angle={0.6}
        penumbra={1}
        intensity={1.8}
        color="#e2d0a6"
      />

      <ResumeOnVisible inView={inView} />
      <StageDiagnostics
        mode={isMobile ? 'lite' : 'full'}
        frameloop={frameloop}
      />

      <Suspense fallback={null}>
        {!isMobile && <Environment files={HDR_URL} background={false} />}
        <StoneModel />
      </Suspense>

      {!isMobile && (
        <ContactShadows
          position={[0, -1.06, 0]}
          opacity={0.5}
          scale={7}
          blur={2.4}
          far={4}
          color="#07110e"
        />
      )}

      <OrbitControls
        makeDefault
        enablePan={false}
        autoRotate={!isMobile}
        autoRotateSpeed={0.7}
        minDistance={3.4}
        maxDistance={7.5}
        minPolarAngle={0.7}
        maxPolarAngle={Math.PI / 1.9}
      />
    </Canvas>
  )
}

export default StoneStage
