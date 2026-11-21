import { useEffect, useState } from 'react'

/** 与 App.css 的移动端断点保持一致 */
const MOBILE_QUERY = '(max-width: 768px)'

function detectMobile(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  if (window.matchMedia(MOBILE_QUERY).matches) return true

  // 窄屏之外的另一种「带不动 3D」的设备：触屏 + 核心数少（低端安卓平板 / 旧手机）
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches
  const cores = navigator.hardwareConcurrency ?? 8
  return coarsePointer && cores <= 4
}

/**
 * 是否走移动端 / 低功耗降级渲染。
 *
 * 只在需要在两者之间切换渲染参数的地方用（3D 画布的 dpr、阴影、环境光、是否自转）。
 * 首次渲染就用真实值，避免「先按桌面配置建一次画布、再降级重建」的白屏。
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(detectMobile)

  useEffect(() => {
    if (!window.matchMedia) return
    const queries = [
      window.matchMedia(MOBILE_QUERY),
      window.matchMedia('(pointer: coarse)'),
    ]
    const onChange = () => setIsMobile(detectMobile())
    for (const query of queries) query.addEventListener('change', onChange)
    return () => {
      for (const query of queries) query.removeEventListener('change', onChange)
    }
  }, [])

  return isMobile
}
