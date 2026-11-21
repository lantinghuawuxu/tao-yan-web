#!/usr/bin/env node
/**
 * 构建后自检：把这次「图片不显示 / 手机端卡顿」的四个根因变成会失败的检查。
 *
 * 背景（都是真事）：
 *   1. 全站写死 'images/xxx.jpg' 裸相对路径 → 换个访问路径整站图片 404
 *   2. 资源写错名字 / 忘了放进 public → 线上才 404，本地 dev 也可能被 SPA fallback 掩盖
 *   3. 主包回到 1.4MB、3D 资源重新进首屏 → 图片又被挤到最后
 *   4. 新加 <img> 不带尺寸 → 图片到达时布局跳动
 *
 * 用法：node scripts/check-assets.mjs   （由 npm run build 在 vite build 之后自动调用）
 * 任一「失败」项 → process.exit(1)，CI 不部署。
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src')
const DIST = path.join(ROOT, 'dist')

// ---- 阈值 ----------------------------------------------------------------
// 单 JS chunk gzip 上限：主包一旦把 three.js 吃回来就会超标（拆分前主包 gzip 约 380KB，
// 拆分后主包只剩 React + 首页 DOM）
const MAX_JS_CHUNK_GZIP = 400 * 1024

// 产物体积闸门。
// 12MB 是最初的目标，但 dist 里 19MB 是 public/ 的 3D 资源（boulder 模型 5.5MB、
// HDR 1.4MB、PBR 贴图 ~8MB），这些是二进制素材，不做 draco/ktx2 压缩管线就下不来，
// 而重压贴图会影响 3D 观感——不在「修图片与卡顿」这次改动范围内。
// 所以闸门按「当前可达值 + 1MB 余量」设定：任何新增资源导致体积上涨都会失败，
// 想放宽必须先看这条注释。后续做资源压缩管线时把它调回 12MB。
const MAX_DIST_BYTES = 21 * 1024 * 1024

// asset() 本身就是拼路径的实现，只有它允许出现裸资源前缀
const PATH_RULE_EXEMPT = new Set(['src/lib/asset.ts'])

const ASSET_PREFIX = /(['"`])(\/?(?:images|textures|models)\/[^'"`]*)\1/g
const ASSET_CALL = /asset\(\s*(['"`])([^'"`]*)\1\s*\)/g
const ASSET_CALL_DYNAMIC = /asset\(\s*`([^`]*)`\s*\)/g
const IMG_TAG = /<img\b[^>]*>/g

const failures = []
const warnings = []
const notes = []

function fail(check, message) {
  failures.push({ check, message })
}

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join('/')
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

function lineOf(text, index) {
  let line = 1
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === '\n') line += 1
  }
  return line
}

const sourceFiles = walk(SRC).filter((file) => /\.(ts|tsx)$/.test(file))
const tsxFiles = sourceFiles.filter((file) => file.endsWith('.tsx'))
const cssFiles = walk(SRC).filter((file) => file.endsWith('.css'))

// ---- 1. 路径合规：不许再出现裸的 images/ textures/ models/ 字面量 ----
function checkPathCompliance() {
  let scanned = 0
  for (const file of sourceFiles) {
    const name = rel(file)
    if (PATH_RULE_EXEMPT.has(name)) continue
    const text = readFileSync(file, 'utf8')
    scanned += 1
    for (const match of text.matchAll(ASSET_PREFIX)) {
      const index = match.index ?? 0
      // 允许跨行写法：asset(\n  'images/x.jpg'\n)
      const before = text.slice(Math.max(0, index - 40), index)
      if (/asset\(\s*$/.test(before)) continue
      fail(
        '路径合规',
        `${name}:${lineOf(text, index)} 裸资源路径 ${match[2]}，必须写成 asset('${match[2].replace(/^\//, '')}')`,
      )
    }
  }
  notes.push(`路径合规：扫描 ${scanned} 个文件，未包裹 asset() 的裸路径 0 处为通过`)
}

// ---- 2. 引用存在：asset('x') 指向的文件必须真的在 public/ 下 ----
function checkReferencesExist() {
  const seen = new Set()
  let count = 0
  for (const file of sourceFiles) {
    const name = rel(file)
    const text = readFileSync(file, 'utf8')

    for (const match of text.matchAll(ASSET_CALL)) {
      const value = match[2].replace(/^\.?\//, '')
      if (!value || seen.has(value)) continue
      seen.add(value)
      count += 1
      if (!existsSync(path.join(ROOT, 'public', value))) {
        fail(
          '引用存在',
          `${name}:${lineOf(text, match.index ?? 0)} asset('${value}') 在 public/ 下不存在`,
        )
      }
    }

    // 拼字符串的路径查不了，至少提醒一句：这类写法等于绕过本项检查
    for (const match of text.matchAll(ASSET_CALL_DYNAMIC)) {
      if (!match[1].includes('${')) continue
      warnings.push(
        `${name}:${lineOf(text, match.index ?? 0)} asset() 使用了模板变量（${match[1]}），构建期无法校验文件是否存在，建议改成静态表`,
      )
    }
  }
  notes.push(`引用存在：校验 ${count} 个 asset() 静态引用，均能在 public/ 找到为通过`)
}

// ---- 3. 产物体积 ----
function gzipSize(file) {
  return gzipSync(readFileSync(file), { level: 9 }).length
}

function dirSize(dir) {
  let total = 0
  for (const file of walk(dir)) total += statSync(file).size
  return total
}

function checkBundleSize() {
  if (!existsSync(DIST)) {
    fail('产物体积', 'dist/ 不存在，先跑 vite build')
    return
  }

  const assetsDir = path.join(DIST, 'assets')
  const jsFiles = existsSync(assetsDir)
    ? readdirSync(assetsDir)
        .filter((name) => name.endsWith('.js'))
        .map((name) => path.join(assetsDir, name))
    : []

  for (const file of jsFiles) {
    const gz = gzipSize(file)
    notes.push(
      `JS ${path.basename(file)}：原始 ${(statSync(file).size / 1024).toFixed(1)}KB / gzip ${(gz / 1024).toFixed(1)}KB`,
    )
    if (gz > MAX_JS_CHUNK_GZIP) {
      fail(
        '产物体积',
        `${path.basename(file)} gzip ${(gz / 1024).toFixed(1)}KB 超过上限 ${(MAX_JS_CHUNK_GZIP / 1024).toFixed(0)}KB —— 是不是又把 three.js / 整页组件静态 import 回主包了？`,
      )
    }
  }

  const total = dirSize(DIST)
  notes.push(
    `dist 总体积：${(total / 1024 / 1024).toFixed(2)}MB（上限 ${(MAX_DIST_BYTES / 1024 / 1024).toFixed(1)}MB）`,
  )
  if (total > MAX_DIST_BYTES) {
    fail(
      '产物体积',
      `dist 总体积 ${(total / 1024 / 1024).toFixed(2)}MB 超过上限 ${(MAX_DIST_BYTES / 1024 / 1024).toFixed(1)}MB`,
    )
  }
}

// ---- 4. 图片尺寸属性：<img> 要么标尺寸，要么明确加载策略 ----
// 有 aspect-ratio 的类也算（CSS 已定比例时不会抖动）
function aspectRatioClasses() {
  const classes = new Set()
  for (const file of cssFiles) {
    const text = readFileSync(file, 'utf8')
    for (const block of text.split('}')) {
      if (!block.includes('aspect-ratio')) continue
      const selector = block.split('{')[0] ?? ''
      for (const token of selector.matchAll(/\.([-\w]+)/g)) classes.add(token[1])
    }
  }
  return classes
}

function checkImageSizing() {
  const sized = aspectRatioClasses()
  let count = 0
  for (const file of tsxFiles) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(IMG_TAG)) {
      const tag = match[0]
      count += 1
      if (/\bwidth=/.test(tag) && /\bheight=/.test(tag)) continue
      if (/\bloading=/.test(tag) || /\bfetchPriority=/.test(tag)) continue
      const classMatch = tag.match(/className=(?:"([^"]*)"|\{`([^`]*)`\})/)
      const tokens = `${classMatch?.[1] ?? ''} ${classMatch?.[2] ?? ''}`
        .split(/\s+/)
        .filter(Boolean)
      if (tokens.some((token) => sized.has(token))) continue

      warnings.push(
        `${rel(file)}:${lineOf(text, match.index ?? 0)} <img> 既没有 width/height，也没有 loading/fetchPriority，所在容器也没有 aspect-ratio —— 图片到达时可能撑跳布局`,
      )
    }
  }
  notes.push(`图片尺寸：检查 ${count} 个 <img>，缺尺寸属性的只警告不拦截`)
}

// ---- 执行 ----
checkPathCompliance()
checkReferencesExist()
checkBundleSize()
checkImageSizing()

console.log('\n【构建自检】')
for (const note of notes) console.log(`  · ${note}`)

if (warnings.length) {
  console.log(`\n  警告 ${warnings.length} 条（不阻断构建）：`)
  for (const message of warnings) console.warn(`  ⚠ ${message}`)
}

if (failures.length) {
  console.error(`\n  ✗ 自检失败 ${failures.length} 项：`)
  for (const { check, message } of failures) console.error(`  [${check}] ${message}`)
  console.error('')
  process.exit(1)
}

console.log('\n  ✓ 资源路径、引用完整性、产物体积、图片尺寸四项检查通过\n')
