import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import '../Studio.css'

type Step = 1 | 2 | 3 | 4 | 5
type Tool = 'chisel' | 'fine' | 'polish'
type PatternId = 'lotus' | 'cloud' | 'wave' | 'meander'

type Point = {
  x: number
  y: number
}

type Stone = {
  id: string
  name: string
  subtitle: string
  image: string
  completeness: number
  cracks: number
  carvable: number
  suggestion: string
  confidence: number
}

const stones: Stone[] = [
  {
    id: 'green',
    name: '鹦哥绿',
    subtitle: '水泉湾 · 细密水纹',
    image: 'images/stone-snow.jpg',
    completeness: 94,
    cracks: 1,
    carvable: 82,
    suggestion: '莲纹 / 水波',
    confidence: 93,
  },
  {
    id: 'yellow',
    name: '黄膘石',
    subtitle: '喇嘛崖 · 金黄石膘',
    image: 'images/stone-yellow.jpg',
    completeness: 91,
    cracks: 2,
    carvable: 76,
    suggestion: '云纹 / 回纹',
    confidence: 90,
  },
  {
    id: 'purple',
    name: '紫石',
    subtitle: '喇嘛崖 · 上紫下绿',
    image: 'images/stone-purple.jpg',
    completeness: 88,
    cracks: 2,
    carvable: 71,
    suggestion: '莲纹 / 云纹',
    confidence: 87,
  },
]

const patterns: {
  id: PatternId
  name: string
  note: string
  meaning: string
}[] = [
  {
    id: 'lotus',
    name: '莲纹',
    note: '清雅吉祥',
    meaning: '莲花出淤泥而不染，是洮砚最常见的传统题材之一，常与砚池、水波一起构图。',
  },
  {
    id: 'cloud',
    name: '云纹',
    note: '如意绵延',
    meaning: '云气纹在洮砚与汉藏装饰中都有悠久传统，线条回旋，寓意吉祥绵延。',
  },
  {
    id: 'wave',
    name: '水波',
    note: '顺势而刻',
    meaning: '顺着洮河石天然水纹构图，因石施艺，是洮砚“相石而作”的典型思路。',
  },
  {
    id: 'meander',
    name: '回纹',
    note: '绵长不断',
    meaning: '回纹以连续折线寓意绵延不绝，常作为砚台边饰，稳重而有秩序。',
  },
]

const stepMeta = [
  {
    label: '选石',
    title: '先选一块石头',
    desc: '观察它的石膘、水纹与形状。每一块洮河石都不一样，雕刻方案也要因石而异。',
  },
  {
    label: 'AI 识石',
    title: '让 AI 先看一眼',
    desc: '上传照片，AI 辅助识别石料轮廓、裂纹与可雕刻区域，给出纹样建议。',
  },
  {
    label: '纹样',
    title: '挑一个纹样，作为下刀的依据',
    desc: '从传统纹样中选择一个作为辅助线。它不是标准答案，最终构图仍由你决定。',
  },
  {
    label: '雕刻',
    title: '在石面上，落下第一刀',
    desc: '按住鼠标或手指拖动，刻刀会削去表层，露出更深的石色。先粗后细，慢慢来。',
  },
  {
    label: '完成',
    title: '你的数字洮砚，完成了',
    desc: '保存作品，或者回到雕刻台继续调整。优秀设计有机会交由合作工坊落地。',
  },
]

const tips = [
  '洮砚讲究“相石而作”，先看石形、石膘与裂纹，再定题材。',
  '真正的洮砚雕刻要经过选石、设计、粗雕、细刻、打磨等十余道工序。',
  '纹样在洮砚上不仅是装饰，也承载着汉藏交融的审美与祝福。',
  '刻刀走线要顺石纹而行；先粗后细，最后蘸水打磨。',
  '不必人人成为匠人，但人人皆可通过了解、传播与体验来保护非遗。',
]

const tools: { id: Tool; label: string; glyph: string; note: string }[] = [
  {
    id: 'chisel',
    label: '刻刀',
    glyph: '刻',
    note: '宽刃刻出主纹，适合勾勒大面积轮廓。',
  },
  {
    id: 'fine',
    label: '细刻',
    glyph: '细',
    note: '小刀口刻画细节，适合线条与转折。',
  },
  {
    id: 'polish',
    label: '打磨',
    glyph: '磨',
    note: '柔化刻痕边缘，模拟蘸水打磨的效果。',
  },
]

function LotusPattern() {
  return (
    <svg
      viewBox="0 0 400 300"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="200" cy="146" r="118" strokeDasharray="2 7" opacity="0.5" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
        <path
          key={angle}
          d="M200 146 C176 118 176 82 200 58 C224 82 224 118 200 146Z"
          transform={`rotate(${angle} 200 146)`}
        />
      ))}
      <circle cx="200" cy="146" r="18" />
      <path d="M200 146 C170 176 132 190 92 190 C116 210 156 212 200 192 C244 212 284 210 308 190 C268 190 230 176 200 146Z" />
      <path d="M200 192 L200 264" />
      <path d="M200 224 C176 216 158 220 146 238 C168 244 186 240 200 224Z" />
      <path d="M200 240 C224 232 242 236 254 254 C232 260 214 256 200 240Z" />
    </svg>
  )
}

function CloudPattern() {
  return (
    <svg
      viewBox="0 0 400 300"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M46 188 C46 158 78 146 100 158 C104 124 152 116 174 146 C190 114 244 114 260 148 C286 132 322 148 322 178 C350 178 358 212 334 224 L74 224 C50 224 38 202 46 188Z" />
      <path d="M92 252 C112 236 134 236 154 252" />
      <path d="M176 252 C196 236 218 236 238 252" />
      <path d="M260 252 C280 236 302 236 322 252" />
      <path d="M86 96 C104 80 124 80 142 96" />
      <path d="M258 96 C276 80 296 80 314 96" />
    </svg>
  )
}

function WavePattern() {
  return (
    <svg
      viewBox="0 0 400 300"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {[0, 1, 2, 3].map((row) => (
        <path
          key={row}
          d={`M10 ${96 + row * 46} C48 ${60 + row * 46} 90 ${60 + row * 46} 128 ${96 + row * 46} C166 ${132 + row * 46} 208 ${132 + row * 46} 246 ${96 + row * 46} C284 ${60 + row * 46} 326 ${60 + row * 46} 390 ${96 + row * 46}`}
        />
      ))}
      <path d="M70 64 C88 48 108 48 126 64" />
      <path d="M230 64 C248 48 268 48 286 64" />
    </svg>
  )
}

function MeanderPattern() {
  return (
    <svg
      viewBox="0 0 400 300"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M44 54 H356 V246 H44 V96 H310 V204 H86 V138 H264 V170 H128" />
      <path d="M78 78 H322 V222 H78 V120 H280 V180 H112" opacity="0.55" />
    </svg>
  )
}

function PatternArt({ id }: { id: PatternId }) {
  if (id === 'lotus') return <LotusPattern />
  if (id === 'cloud') return <CloudPattern />
  if (id === 'wave') return <WavePattern />
  return <MeanderPattern />
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
) {
  const width = ctx.canvas.width
  const height = ctx.canvas.height
  const imageRatio = img.naturalWidth / img.naturalHeight
  const canvasRatio = width / height
  let sw = img.naturalWidth
  let sh = img.naturalHeight

  if (imageRatio > canvasRatio) {
    sw = sh * canvasRatio
  } else {
    sh = sw / canvasRatio
  }

  const sx = (img.naturalWidth - sw) / 2
  const sy = (img.naturalHeight - sh) / 2
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height)
}

function Studio() {
  const [step, setStep] = useState<Step>(1)
  const [maxStep, setMaxStep] = useState(1)
  const [stone, setStone] = useState<Stone>(stones[0])
  const [customImage, setCustomImage] = useState<string | null>(null)
  const [customLabel, setCustomLabel] = useState<string | null>(null)
  const [scanned, setScanned] = useState(false)
  const [pattern, setPattern] = useState(patterns[0])
  const [patternScale, setPatternScale] = useState(1)
  const [showGuide, setShowGuide] = useState(true)
  const [tool, setTool] = useState<Tool>('chisel')
  const [brushSize, setBrushSize] = useState(28)
  const [artwork, setArtwork] = useState<string | null>(null)
  const [finishedAt, setFinishedAt] = useState('')

  const fileInputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const drawingRef = useRef(false)
  const lastPointRef = useRef<Point | null>(null)
  const historyRef = useRef<ImageData[]>([])
  const surfaceBackupRef = useRef<string | null>(null)

  const activeImage = customImage ?? stone.image
  const materialName = customImage ? (customLabel ?? '自定义石料') : stone.name
  const scanning = step === 2 && !scanned
  const analysis = customImage
    ? {
        completeness: 90,
        cracks: 1,
        carvable: 79,
        suggestion: '莲纹 / 云纹',
        confidence: 88,
      }
    : stone

  useEffect(() => {
    if (step !== 2 || scanned) return
    const timer = window.setTimeout(() => setScanned(true), 2600)
    return () => window.clearTimeout(timer)
  }, [step, scanned, activeImage])

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [step])

  useEffect(() => {
    return () => {
      if (customImage) URL.revokeObjectURL(customImage)
    }
  }, [customImage])

  useEffect(() => {
    if (step !== 4) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let cancelled = false
    imageRef.current = null
    const img = new Image()

    img.onload = () => {
      if (cancelled) return
      imageRef.current = img
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      historyRef.current = []
      const backup = surfaceBackupRef.current
      if (backup) {
        const restored = new Image()
        restored.onload = () => {
          if (cancelled) return
          ctx.clearRect(0, 0, canvas.width, canvas.height)
          ctx.drawImage(restored, 0, 0, canvas.width, canvas.height)
        }
        restored.src = backup
      } else {
        drawCover(ctx, img)
      }
    }

    img.src = activeImage

    return () => {
      cancelled = true
    }
  }, [step, activeImage])

  const resetSurface = useCallback(() => {
    const canvas = canvasRef.current
    const img = imageRef.current
    if (!canvas || !img) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    drawCover(ctx, img)
    historyRef.current = []
  }, [])

  const getPoint = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ): Point => {
    const canvas = event.currentTarget
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    }
  }

  const carveSegment = (a: Point, b: Point) => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const width =
      tool === 'fine'
        ? brushSize * 0.45
        : tool === 'polish'
          ? brushSize * 1.7
          : brushSize

    ctx.save()
    ctx.globalCompositeOperation = 'destination-out'
    ctx.globalAlpha = tool === 'polish' ? 0.24 : 1
    ctx.strokeStyle = '#000'
    ctx.fillStyle = '#000'
    ctx.lineWidth = width
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()

    const distance = Math.hypot(b.x - a.x, b.y - a.y)
    const count = Math.max(
      1,
      Math.floor(distance / Math.max(5, width * 0.35)),
    )
    for (let i = 0; i <= count; i += 1) {
      const t = count === 0 ? 0 : i / count
      const x =
        a.x + (b.x - a.x) * t + (Math.random() - 0.5) * width * 0.2
      const y =
        a.y + (b.y - a.y) * t + (Math.random() - 0.5) * width * 0.2
      ctx.beginPath()
      ctx.arc(
        x,
        y,
        width * (0.3 + Math.random() * 0.12),
        0,
        Math.PI * 2,
      )
      ctx.fill()
    }
    ctx.restore()
  }

  const startStroke = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !imageRef.current) return
    event.preventDefault()
    canvas.setPointerCapture(event.pointerId)
    if (historyRef.current.length > 18) historyRef.current.shift()
    historyRef.current.push(
      ctx.getImageData(0, 0, canvas.width, canvas.height),
    )
    drawingRef.current = true
    const point = getPoint(event)
    lastPointRef.current = point
    carveSegment(point, point)
  }

  const moveStroke = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) => {
    if (!drawingRef.current) return
    event.preventDefault()
    const point = getPoint(event)
    if (lastPointRef.current) {
      carveSegment(lastPointRef.current, point)
    }
    lastPointRef.current = point
  }

  const endStroke = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) => {
    if (!drawingRef.current) return
    drawingRef.current = false
    lastPointRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const undo = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const snapshot = historyRef.current.pop()
    if (!canvas || !ctx || !snapshot) return
    ctx.putImageData(snapshot, 0, 0)
  }

  const selectStone = (next: Stone) => {
    const changed = next.id !== stone.id || customImage !== null
    setStone(next)
    if (changed) {
      setCustomImage(null)
      setCustomLabel(null)
      setScanned(false)
      setArtwork(null)
      setMaxStep(1)
      surfaceBackupRef.current = null
      historyRef.current = []
      imageRef.current = null
    }
  }

  const onUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !file.type.startsWith('image/')) return
    const url = URL.createObjectURL(file)
    setCustomImage(url)
    setCustomLabel(file.name)
    setScanned(false)
    setArtwork(null)
    setMaxStep(2)
    surfaceBackupRef.current = null
    historyRef.current = []
    imageRef.current = null
    if (step === 1) setStep(2)
  }

  const goTo = (target: Step) => {
    if (target === step || target > maxStep) return
    if (step === 4 && canvasRef.current) {
      surfaceBackupRef.current =
        canvasRef.current.toDataURL('image/png')
    }
    setStep(target)
  }

  const goBack = () => {
    if (step === 1) return
    if (step === 4 && canvasRef.current) {
      surfaceBackupRef.current =
        canvasRef.current.toDataURL('image/png')
    }
    setStep((step - 1) as Step)
  }

  const goNext = () => {
    if (step === 1) {
      setScanned(false)
      setMaxStep((current) => Math.max(current, 2))
      setStep(2)
    } else if (step === 2 && scanned) {
      setMaxStep((current) => Math.max(current, 3))
      setStep(3)
    } else if (step === 3) {
      setMaxStep((current) => Math.max(current, 4))
      setStep(4)
    } else if (step === 4) {
      finish()
    }
  }

  const finish = () => {
    const canvas = canvasRef.current
    const img = imageRef.current
    if (!canvas || !img) return
    const out = document.createElement('canvas')
    out.width = 1200
    out.height = 800
    const ctx = out.getContext('2d')
    if (!ctx) return

    drawCover(ctx, img)
    ctx.fillStyle = 'rgba(7, 18, 15, 0.5)'
    ctx.fillRect(0, 0, out.width, out.height)
    ctx.drawImage(canvas, 0, 0)

    const vignette = ctx.createLinearGradient(0, 0, 0, out.height)
    vignette.addColorStop(0, 'rgba(8, 20, 17, 0.18)')
    vignette.addColorStop(0.5, 'rgba(8, 20, 17, 0)')
    vignette.addColorStop(1, 'rgba(8, 20, 17, 0.82)')
    ctx.fillStyle = vignette
    ctx.fillRect(0, 0, out.width, out.height)

    ctx.fillStyle = 'rgba(13, 29, 25, 0.9)'
    ctx.fillRect(0, out.height - 108, out.width, 108)
    ctx.fillStyle = '#f5f1e6'
    ctx.font = '32px KaiTi, STKaiti, serif'
    ctx.fillText('陇上砚语 · 我的数字洮砚', 48, out.height - 54)
    const dateLabel = new Date().toLocaleDateString('zh-CN')
    ctx.fillStyle = '#c7a86b'
    ctx.font = '16px "Microsoft YaHei", sans-serif'
    ctx.fillText(
      `${materialName} · ${pattern.name} · ${dateLabel}`,
      48,
      out.height - 26,
    )

    ctx.fillStyle = '#a8402f'
    ctx.fillRect(out.width - 124, out.height - 84, 64, 64)
    ctx.fillStyle = '#f5f1e6'
    ctx.font = '36px KaiTi, STKaiti, serif'
    ctx.textAlign = 'center'
    ctx.fillText('砚', out.width - 92, out.height - 38)
    ctx.textAlign = 'start'

    surfaceBackupRef.current = canvas.toDataURL('image/png')
    setArtwork(out.toDataURL('image/png'))
    setFinishedAt(dateLabel)
    setMaxStep(5)
    setStep(5)
  }

  const resetAll = () => {
    setStep(1)
    setMaxStep(1)
    setStone(stones[0])
    setCustomImage(null)
    setCustomLabel(null)
    setScanned(false)
    setFinishedAt('')
    setPattern(patterns[0])
    setPatternScale(1)
    setShowGuide(true)
    setTool('chisel')
    setBrushSize(28)
    setArtwork(null)
    surfaceBackupRef.current = null
    historyRef.current = []
    imageRef.current = null
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const activeTool = tools.find((item) => item.id === tool) ?? tools[0]

  return (
    <div className="studio-page">
      <header className="studio-top">
        <div className="wrap studio-header">
          <a className="brand" href="#top" aria-label="返回首页">
            <span className="seal">砚</span>
            <span>
              <span className="brand-name">陇上砚语</span>
              <span className="brand-sub">TAO INKSTONE · 非遗数字化</span>
            </span>
          </a>
          <div className="studio-header-right">
            <span className="studio-mode">虚拟雕刻体验 · DEMO</span>
            <a className="studio-back" href="#top">
              返回首页
            </a>
          </div>
        </div>

        <div className="wrap">
          <ol className="studio-steps" aria-label="体验步骤">
            {stepMeta.map((item, index) => {
              const number = (index + 1) as Step
              const state =
                number === step
                  ? 'active'
                  : number < step
                    ? 'done'
                    : number <= maxStep
                      ? 'available'
                      : ''
              return (
                <li key={item.label}>
                  <button
                    type="button"
                    className={`studio-step ${state}`}
                    onClick={() => goTo(number)}
                    disabled={number > maxStep}
                    aria-current={number === step ? 'step' : undefined}
                  >
                    <span className="studio-step-num">
                      {number < step ? '✓' : number}
                    </span>
                    <span className="studio-step-label">{item.label}</span>
                  </button>
                  {index < stepMeta.length - 1 && (
                    <span className="studio-step-line" aria-hidden="true" />
                  )}
                </li>
              )
            })}
          </ol>
        </div>
      </header>

      <main className="studio-main">
        <div className="wrap">
          <div className="studio-heading">
            <div className="section-label">虚拟雕刻体验</div>
            <h1>{stepMeta[step - 1].title}</h1>
            <p>{stepMeta[step - 1].desc}</p>
            <div className="studio-tip">
              <span>非遗小知识</span>
              {tips[step - 1]}
            </div>
          </div>

          <div className="studio-content" key={step}>
            {step === 1 && (
              <div className="studio-grid">
                <div className="studio-panel">
                  <h2 className="panel-title">选择一块数字原石</h2>
                  <p className="panel-desc">
                    这些石料来自洮河峡谷的不同坑口。点选一块，观察它的颜色、石膘与水纹。
                  </p>

                  <div className="stone-select">
                    {stones.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`stone-option ${
                          !customImage && item.id === stone.id
                            ? 'active'
                            : ''
                        }`}
                        onClick={() => selectStone(item)}
                      >
                        <img src={item.image} alt={item.name} />
                        <span className="stone-option-info">
                          <strong>{item.name}</strong>
                          <span>{item.subtitle}</span>
                        </span>
                        <span className="stone-option-check">✓</span>
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    className="text-btn"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    没有合适的？上传自己的石料照片
                  </button>

                  <div className="step-actions">
                    <span className="step-note">
                      当前：{materialName}
                    </span>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={goNext}
                    >
                      下一步：AI 识石
                    </button>
                  </div>
                </div>

                <div className="preview-panel">
                  <div className="preview-frame">
                    <img src={activeImage} alt={materialName} />
                    <span className="preview-tag">当前石料</span>
                    <span className="preview-name">
                      {materialName} · {customImage ? '自定义上传' : stone.subtitle}
                    </span>
                  </div>
                  <div className="preview-meta">
                    <div>
                      <span>石料</span>
                      <strong>{materialName}</strong>
                    </div>
                    <div>
                      <span>建议题材</span>
                      <strong>{analysis.suggestion}</strong>
                    </div>
                    <div>
                      <span>可雕刻区</span>
                      <strong>{analysis.carvable}%</strong>
                    </div>
                  </div>
                  <p className="preview-note">
                    提示：原石越不规则，越需要“因石施艺”。这也是洮砚雕刻最迷人的地方。
                  </p>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="studio-grid">
                <div className="studio-panel">
                  <h2 className="panel-title">AI 石料分析</h2>
                  <p className="panel-desc">
                    AI 会先识别石料轮廓、裂纹和可雕刻区域，再给出纹样建议。演示版本使用模拟数据。
                  </p>

                  <div className={`scan-status ${scanned ? 'done' : ''}`}>
                    {scanning ? (
                      <>
                        <span className="pulse-dot" />
                        正在识别石料轮廓、裂纹与可雕刻区域…
                      </>
                    ) : scanned ? (
                      <>
                        <span className="scan-check">✓</span>
                        分析完成 · 置信度 {analysis.confidence}%
                      </>
                    ) : (
                      '准备分析'
                    )}
                  </div>

                  {scanned && (
                    <div className="analysis-list">
                      <div className="analysis-row">
                        <div className="analysis-label">
                          <span>石料完整度</span>
                          <strong>{analysis.completeness}%</strong>
                        </div>
                        <div className="analysis-meter">
                          <span
                            style={{
                              width: `${analysis.completeness}%`,
                            }}
                          />
                        </div>
                      </div>
                      <div className="analysis-row">
                        <div className="analysis-label">
                          <span>可雕刻区域</span>
                          <strong>{analysis.carvable}%</strong>
                        </div>
                        <div className="analysis-meter">
                          <span
                            style={{ width: `${analysis.carvable}%` }}
                          />
                        </div>
                      </div>
                      <div className="analysis-row">
                        <div className="analysis-label">
                          <span>疑似裂纹</span>
                          <strong>{analysis.cracks} 处</strong>
                        </div>
                      </div>
                      <div className="analysis-suggestion">
                        <span>建议题材</span>
                        <strong>{analysis.suggestion}</strong>
                      </div>
                      <p className="mock-note">
                        演示版本：分析结果为模拟数据，石料识别模型正在训练中。
                      </p>
                    </div>
                  )}

                  <div className="upload-box">
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      上传石料照片
                    </button>
                    <span>支持 JPG / PNG，建议正面、光线均匀</span>
                  </div>

                  <div className="step-actions">
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={goBack}
                    >
                      上一步
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={!scanned}
                      onClick={goNext}
                    >
                      选择纹样
                    </button>
                  </div>
                </div>

                <div className="preview-panel">
                  <div
                    className={`preview-frame scan-frame ${
                      scanning ? 'scanning' : ''
                    }`}
                  >
                    <img src={activeImage} alt={materialName} />
                    {scanning && (
                      <>
                        <span className="scan-grid" aria-hidden="true" />
                        <span className="scan-line" aria-hidden="true" />
                      </>
                    )}
                    <span className="preview-tag">AI VISION</span>
                    <span className="preview-name">{materialName}</span>
                    {scanned && (
                      <span className="scan-done">分析完成</span>
                    )}
                  </div>
                  <div className="preview-meta">
                    <div>
                      <span>识别对象</span>
                      <strong>{materialName}</strong>
                    </div>
                    <div>
                      <span>分析方式</span>
                      <strong>图像识别 · 模拟</strong>
                    </div>
                    <div>
                      <span>建议</span>
                      <strong>{analysis.suggestion}</strong>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="studio-grid">
                <div className="studio-panel">
                  <h2 className="panel-title">选择雕刻纹样</h2>
                  <p className="panel-desc">
                    选一个纹样作为辅助线。纹样会以金色线条叠加在石面上，你可以按自己的理解下刀。
                  </p>

                  <div className="pattern-grid">
                    {patterns.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`pattern-option ${
                          item.id === pattern.id ? 'active' : ''
                        }`}
                        onClick={() => setPattern(item)}
                      >
                        <span className="pattern-thumb">
                          <PatternArt id={item.id} />
                        </span>
                        <span className="pattern-text">
                          <strong>{item.name}</strong>
                          <span>{item.note}</span>
                        </span>
                      </button>
                    ))}
                  </div>

                  <div className="scale-control">
                    <label htmlFor="pattern-scale">
                      纹样大小
                      <strong>{Math.round(patternScale * 100)}%</strong>
                    </label>
                    <input
                      id="pattern-scale"
                      type="range"
                      min="0.6"
                      max="1.3"
                      step="0.05"
                      value={patternScale}
                      onChange={(event) =>
                        setPatternScale(Number(event.target.value))
                      }
                    />
                  </div>

                  <div className="pattern-meaning">
                    <span>纹样寓意</span>
                    <p>{pattern.meaning}</p>
                  </div>

                  <div className="step-actions">
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={goBack}
                    >
                      上一步
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={goNext}
                    >
                      开始雕刻
                    </button>
                  </div>
                </div>

                <div className="preview-panel">
                  <div className="preview-frame">
                    <img src={activeImage} alt={materialName} />
                    <div
                      className="pattern-overlay"
                      style={{
                        transform: `scale(${patternScale})`,
                      }}
                    >
                      <PatternArt id={pattern.id} />
                    </div>
                    <span className="preview-tag">纹样辅助线</span>
                    <span className="preview-name">
                      {pattern.name} · {Math.round(patternScale * 100)}%
                    </span>
                  </div>
                  <p className="preview-note">
                    金色线条只是辅助。真正的刻痕由你决定，也可以完全抛开纹样自由发挥。
                  </p>
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="carve-layout">
                <div className="carve-main">
                  <div className="carve-toolbar">
                    <div className="tool-group">
                      {tools.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={`tool-btn ${
                            tool === item.id ? 'active' : ''
                          }`}
                          onClick={() => setTool(item.id)}
                        >
                          <span>{item.glyph}</span>
                          {item.label}
                        </button>
                      ))}
                    </div>

                    <div className="brush-control">
                      <label htmlFor="brush-size">刀口</label>
                      <input
                        id="brush-size"
                        type="range"
                        min="10"
                        max="64"
                        value={brushSize}
                        onChange={(event) =>
                          setBrushSize(Number(event.target.value))
                        }
                      />
                      <span>{brushSize}px</span>
                    </div>

                    <div className="tool-actions">
                      <button type="button" onClick={undo}>
                        撤销
                      </button>
                      <button type="button" onClick={resetSurface}>
                        清除
                      </button>
                    </div>
                  </div>

                  <div className="carve-stage">
                    <img
                      className="carve-base"
                      src={activeImage}
                      alt=""
                      aria-hidden="true"
                    />
                    <canvas
                      ref={canvasRef}
                      width={1200}
                      height={800}
                      className="carve-surface"
                      aria-label="虚拟雕刻画布：按住鼠标或手指拖动进行雕刻"
                      onPointerDown={startStroke}
                      onPointerMove={moveStroke}
                      onPointerUp={endStroke}
                      onPointerCancel={endStroke}
                    />
                    <div
                      className={`pattern-overlay carve-guide ${
                        showGuide ? '' : 'hidden'
                      }`}
                      style={{ transform: `scale(${patternScale})` }}
                    >
                      <PatternArt id={pattern.id} />
                    </div>
                    <span className="carve-hint">
                      按住鼠标 / 手指，在石面上拖动雕刻
                    </span>
                  </div>

                  <div className="carve-footer">
                    <span>
                      {materialName} · {pattern.name} · {activeTool.label}
                    </span>
                    <div className="step-actions">
                      <button
                        type="button"
                        className="btn btn-outline"
                        onClick={goBack}
                      >
                        上一步
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={finish}
                      >
                        完成作品
                      </button>
                    </div>
                  </div>
                </div>

                <aside className="carve-side">
                  <div className="side-card">
                    <span>当前石料</span>
                    <strong>{materialName}</strong>
                    <p>{customImage ? '来自你的上传图片' : stone.subtitle}</p>
                  </div>
                  <div className="side-card">
                    <span>当前纹样</span>
                    <strong>{pattern.name}</strong>
                    <p>{pattern.note} · {Math.round(patternScale * 100)}%</p>
                  </div>
                  <div className="side-card">
                    <span>当前工具</span>
                    <strong>{activeTool.label}</strong>
                    <p>{activeTool.note}</p>
                  </div>
                  <button
                    type="button"
                    className={`guide-toggle ${showGuide ? 'on' : ''}`}
                    onClick={() => setShowGuide((current) => !current)}
                  >
                    <span className="toggle-dot" />
                    显示纹样辅助线
                  </button>
                  <div className="side-card side-note">
                    <span>关于虚拟雕刻</span>
                    <p>
                      本 Demo 用数字方式模拟刻痕。真实洮砚雕刻需要匠人根据石料纹理手工完成。
                    </p>
                  </div>
                </aside>
              </div>
            )}

            {step === 5 && (
              <div className="result-layout">
                <div className="result-art">
                  {artwork ? (
                    <img src={artwork} alt="我的数字洮砚作品" />
                  ) : (
                    <div className="result-placeholder">作品生成中…</div>
                  )}
                </div>

                <div className="result-info">
                  <div className="section-label">作品完成</div>
                  <h2>你的第一方数字洮砚</h2>
                  <p className="result-lead">
                    石料：{materialName}
                    <br />
                    纹样：{pattern.name}
                    <br />
                    日期：{finishedAt}
                  </p>

                  <div className="result-actions">
                    <a
                      className="btn btn-primary"
                      href={artwork ?? '#'}
                      download={`陇上砚语-${materialName}.png`}
                    >
                      保存作品
                    </a>
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => goTo(4)}
                    >
                      继续雕刻
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={resetAll}
                    >
                      再做一方
                    </button>
                  </div>

                  <p className="mock-note">
                    作品仅用于演示。优秀数字设计可在后续版本中提交合作工坊评估，有机会转化为实物洮砚。
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      <footer className="studio-footer">
        <div className="wrap">
          <span>陇上砚语 · 技术为非遗服务</span>
          <a href="#top">返回首页</a>
        </div>
      </footer>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={onUpload}
      />
    </div>
  )
}

export default Studio
