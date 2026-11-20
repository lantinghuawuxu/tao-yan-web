import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { execSync } from 'node:child_process'

// 构建版本：把 commit 短哈希和构建时间打进产物。
// 页面上显示这一行，用来判断「打开的是不是最新那版」——
// 反复出现「你到底传了吗」的争执，根源是用户没有任何办法自查版本。
function buildInfo() {
  let commit = 'dev'
  try {
    commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    // CI 里没有 git 时退回环境变量
    commit = (process.env.GITHUB_SHA ?? 'dev').slice(0, 7)
  }
  const time = new Date()
    .toISOString()
    .slice(0, 16)
    .replace('T', ' ')
  return { commit, time }
}

const info = buildInfo()

export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    __BUILD_COMMIT__: JSON.stringify(info.commit),
    __BUILD_TIME__: JSON.stringify(info.time),
  },
  server: {
    allowedHosts: ['.trycloudflare.com'],
  },
  preview: {
    allowedHosts: ['.trycloudflare.com'],
  },
})
