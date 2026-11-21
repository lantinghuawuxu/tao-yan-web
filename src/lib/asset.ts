/**
 * public/ 资源的统一路径入口。
 *
 * 以前全站写死 'images/xxx.jpg' 这种裸相对路径。它只在「当前文档 URL 恰好以 /
 * 结尾」时才指向部署目录：GitHub Pages 子路径、自定义域名、隧道预览、或者访问
 * 链接少了尾部斜杠，全站图片就会一起 404，而且线上看起来像「图片没上传」。
 *
 * 这里把资源统一解析成「部署根目录 + 资源路径」：
 *   - 构建期 base 是绝对路径（'/'、'/tao-yan-web/'、完整 URL）→ 直接用它
 *   - base 是相对路径（本项目 vite base: './'）→ 从当前文档 URL 推断部署目录，
 *     并且不依赖 URL 是否带尾部斜杠
 *
 * 用法：asset('images/stone-snow.jpg') → '/tao-yan-web/images/stone-snow.jpg'
 */

const ABSOLUTE_BASE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i

function normalizeBase(configured: string): string {
  if (configured && ABSOLUTE_BASE.test(configured)) {
    return configured.endsWith('/') ? configured : `${configured}/`
  }

  // 相对 base：从当前文档 URL 推出「部署目录」
  if (typeof window === 'undefined') return './'

  const { pathname } = window.location
  const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1)

  // 末段带扩展名 → 当前 URL 指到文件（如 /tao-yan-web/index.html），取所在目录
  if (lastSegment.includes('.')) {
    return pathname.slice(0, pathname.lastIndexOf('/') + 1)
  }
  // 末段是目录名（如 /tao-yan-web，少了尾部斜杠）→ 补斜杠，别让浏览器当成文件
  return pathname.endsWith('/') ? pathname : `${pathname}/`
}

const BASE = normalizeBase(import.meta.env.BASE_URL)

export function asset(path: string): string {
  // 去掉前导 './' 与多余的 '/': './images/x'、'/images/x'、'images/x' 都归一成 'images/x'
  const clean = path.replace(/^\.?\/+/, '')
  return `${BASE}${clean}`
}
