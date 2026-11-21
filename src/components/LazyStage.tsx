import { useEffect, useRef, useState, type ReactNode } from 'react'

type LazyStageProps = {
  /**
   * 进入视口附近后才渲染的内容。
   * 参数 inView 表示「此刻是否真的在视口内」，用来暂停/恢复持续渲染，
   * 而不是卸载 —— 卸载会重建 WebGL 上下文，比不渲染更卡。
   */
  children: (inView: boolean) => ReactNode
  /** 未接近视口时的等面积占位（必须撑满父容器，避免布局跳动） */
  placeholder: ReactNode
  /** 提前多少距离开始加载，默认 300px，滚动到附近就准备好，不会看到空窗 */
  rootMargin?: string
}

/**
 * 3D 画布的「进视口才加载」包装。
 *
 * 首页原来一进页面就下载 5.5MB 模型 + 1.4MB HDR，和首屏图片抢同一条网络，
 * 结果首屏图片半天出不来。现在 3D 资源只在舞台接近视口时才请求，
 * 首屏带宽全部留给图片和文字。
 */
export function LazyStage({
  children,
  placeholder,
  rootMargin = '300px',
}: LazyStageProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host || typeof IntersectionObserver === 'undefined') {
      // 没有 IntersectionObserver 的极端环境：直接加载，宁可慢也不要空着
      setNear(true)
      setInView(true)
      return
    }

    // 一次性：接近过就一直保留，来回滚动不重复销毁重建
    const nearObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true)
          nearObserver.disconnect()
        }
      },
      { rootMargin },
    )
    nearObserver.observe(host)

    // 持续：用来在画布离开视口时停止 requestAnimationFrame 空转
    const viewObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setInView(entry.isIntersecting)
      },
      { rootMargin: '0px' },
    )
    viewObserver.observe(host)

    return () => {
      nearObserver.disconnect()
      viewObserver.disconnect()
    }
  }, [rootMargin])

  return (
    <div className="lazy-stage" ref={hostRef}>
      {near ? children(inView) : placeholder}
    </div>
  )
}

export default LazyStage
