import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  /** 出错时替换这一块内容，其它区块保持正常 */
  fallback: ReactNode
  children: ReactNode
}

type State = { failed: boolean }

/**
 * 局部错误边界。
 *
 * 实测：模型请求失败（弱网、被拦截、资源路径错）时，Suspense 里抛出的错误
 * 会一路冒到根节点，React 直接把整个 #root 卸载 —— 整页白屏，
 * 用户看到的就是「网站挂了、图片全没了」。
 *
 * 3D 是锦上添花，绝不能因为它挂掉让首页文字和图片一起消失，
 * 所以把每个可能加载失败的区域（3D 画布、按需加载的整页）各自围起来。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] 该区域已隔离，页面其余部分继续可用', error, info)
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

export default ErrorBoundary
