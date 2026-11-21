import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react'
import { Carve3D } from '../components/Carve3D'
import { carveSound } from '../components/carveSound'
import { InkstoneViewer } from '../components/InkstoneViewer'
import { PatternRelief } from '../components/PatternRelief'
import '../Studio.css'

type Step = 1 | 2 | 3 | 4 | 5
type Tool = 'chisel' | 'fine' | 'polish'
type PatternId = 'lotus' | 'cloud' | 'wave' | 'meander'

type Stone = {
  id: 'green' | 'yellow' | 'purple'
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
    subtitle: '喇嘛崖 · 深绿细润',
    image: 'images/stone-green.jpg',
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
  image: string
  shape: string
}[] = [
  {
    id: 'lotus',
    name: '莲纹',
    note: '清雅吉祥',
    meaning: '莲花出淤泥而不染，是洮砚最常见的传统题材之一，常与砚池、水波一起构图。',
    image: 'images/inkstones/lianwen-yuan.jpg',
    shape: '圆形砚',
  },
  {
    id: 'cloud',
    name: '云纹',
    note: '如意绵延',
    meaning: '云气纹在洮砚与汉藏装饰中都有悠久传统，线条回旋，寓意吉祥绵延。',
    image: 'images/inkstones/heyu-tuoyuan.jpg',
    shape: '椭圆砚',
  },
  {
    id: 'wave',
    name: '水波',
    note: '顺势而刻',
    meaning: '顺着洮河石天然水纹构图，因石施艺，是洮砚“相石而作”的典型思路。',
    image: 'images/inkstones/shuangchi-suxian.jpg',
    shape: '随形砚',
  },
  {
    id: 'meander',
    name: '回纹',
    note: '绵长不断',
    meaning: '回纹以连续折线寓意绵延不绝，常作为砚台边饰，稳重而有秩序。',
    image: 'images/inkstones/zhezhi-changfang.jpg',
    shape: '长方砚',
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
    desc: '从传统纹样中选一个，它会以朱砂描稿的形式落在砚堂上，成为你的刀路。最终构图仍由你决定。',
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
  const [previewMode, setPreviewMode] = useState<'stone' | 'inkstone'>('stone')
  const [carve3DKey, setCarve3DKey] = useState(0)
  const [carve3DMode, setCarve3DMode] = useState<'carve' | 'orbit'>('carve')
  const [showGuide, setShowGuide] = useState(true)
  const [carveProgress, setCarveProgress] = useState(0)
  const [briefOpen, setBriefOpen] = useState(true)
  const [tool, setTool] = useState<Tool>('chisel')
  // 默认 14（≈0.9mm 刀宽）：比描稿线（1.4mm）略窄，
  // 刀压上去正好把线吃掉，不会一刀连旁边的稿一起抹掉
  const [brushSize, setBrushSize] = useState(16)
  // 凿石声默认开：没有声音，下刀就只剩「拖了一个色块」的感觉
  const [soundOn, setSoundOn] = useState(true)
  const [artwork, setArtwork] = useState<string | null>(null)
  const [finishedAt, setFinishedAt] = useState('')

  const fileInputRef = useRef<HTMLInputElement>(null)
  const captureRef = useRef<(() => string | null) | null>(null)
  const undoRef = useRef<(() => void) | null>(null)
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(
    null,
  )

  const activeImage = customImage ?? stone.image
  const materialName = customImage ? (customLabel ?? '自定义石料') : stone.name
  const scanning = step === 2 && !scanned
  // 动刀进度 → 当前工序：先粗后细再收光，是砚雕的固定次序
  const carveStage = carveProgress < 0.25 ? 0 : carveProgress < 0.7 ? 1 : 2
  // 刀口实际宽度（mm）。雕刻面 1024px 对应 260mm，1px ≈ 0.25mm。
  // 系数必须和 Carve3D 里那套完全一致，否则滑块上写的数字是假的
  const knifeMm =
    Math.max(1.6, brushSize * 0.34) *
    (tool === 'fine' ? 0.55 : tool === 'polish' ? 1.75 : 1) *
    (tool === 'fine' ? 0.52 : tool === 'polish' ? 1 : 0.6) *
    2 *
    0.254
  const stageNames = ['粗雕', '细刻', '打磨']
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

  const selectStone = (next: Stone) => {
    const changed = next.id !== stone.id || customImage !== null
    setStone(next)
    if (changed) {
      setCustomImage(null)
      setCustomLabel(null)
      setScanned(false)
      setArtwork(null)
      setMaxStep(1)
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
    if (step === 1) setStep(2)
  }

  const goTo = (target: Step) => {
    if (target === step || target > maxStep) return
    setStep(target)
  }

  const goBack = () => {
    if (step === 1) return
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
    const screenshot = captureRef.current?.()
    if (!screenshot) return
    const img = new Image()
    img.onload = () => {
      const out = document.createElement('canvas')
      out.width = 1200
      out.height = 800
      const ctx = out.getContext('2d')
      if (!ctx) return

      ctx.fillStyle = '#0b1512'
      ctx.fillRect(0, 0, out.width, out.height)
      drawCover(ctx, img)

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

      setArtwork(out.toDataURL('image/png'))
      setFinishedAt(dateLabel)
      setMaxStep(5)
      setStep(5)
    }
    img.src = screenshot
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
                    参考洮河峡谷不同坑口的真实石料特征绘制（示意图片）。点选一块，观察它的颜色、石膘与水纹。
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
                    下面是对应的真实洮砚照片，选一个纹样作为参考。选好后，这道纹样会用朱砂（或墨）描在你的砚堂上——那是匠人开工前在石头上画的稿，也是你接下来要刻掉的线。
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
                          <img
                            src={item.image}
                            alt={`${item.name} · ${item.shape}`}
                            loading="lazy"
                          />
                        </span>
                        <span className="pattern-text">
                          <strong>{item.name}</strong>
                          <span>{item.shape}</span>
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
                  <div className="preview-switch" aria-label="预览方式">
                    <button
                      type="button"
                      className={previewMode === 'stone' ? 'active' : ''}
                      onClick={() => setPreviewMode('stone')}
                    >
                      石面纹样
                    </button>
                    <button
                      type="button"
                      className={previewMode === 'inkstone' ? 'active' : ''}
                      onClick={() => setPreviewMode('inkstone')}
                    >
                      3D 砚台
                    </button>
                  </div>

                  {previewMode === 'stone' ? (
                    <div className="preview-frame">
                      <div
                        className="pattern-overlay"
                        style={{
                          transform: `scale(${patternScale})`,
                        }}
                      >
                        <PatternRelief id={pattern.id} stone={stone.id} />
                      </div>
                      <span className="preview-tag">纹样浮雕效果</span>
                      <span className="preview-name">
                        {pattern.name} · {Math.round(patternScale * 100)}%
                      </span>
                    </div>
                  ) : (
                    <div className="preview-frame preview-frame-3d">
                      <InkstoneViewer
                        shape="随形"
                        pattern={pattern.id}
                      />
                      <span className="preview-tag">3D 器型预览</span>
                      <span className="preview-live">LIVE 3D</span>
                      <span className="preview-hint">拖拽旋转 · 滚轮缩放</span>
                      <span className="preview-name">
                        {pattern.name} · 3D 刻槽
                      </span>
                    </div>
                  )}

                  <p className="preview-note">
                    {previewMode === 'stone'
                      ? '这就是该纹样刻到石面上的实际浮雕效果——3D 雕刻台里用的是同一张高度图，看到什么就能刻出什么。'
                      : '3D 预览为器型与纹样示意；正式器型与纹样需由传承人/馆方审校。'}
                  </p>
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="carve-layout">
                <div className="carve-main">
                  {/* 工序条：打开就知道现在该干什么，而不是面对一块石头发呆 */}
                  <div className="carve-brief">
                    <ol className="carve-brief-steps">
                      {['粗雕 · 顺朱砂线走刀', '细刻 · 修内部细节', '打磨 · 收光去毛刺'].map(
                        (label, index) => (
                          <li
                            key={label}
                            className={
                              index === carveStage
                                ? 'active'
                                : index < carveStage
                                  ? 'done'
                                  : ''
                            }
                          >
                            <span className="brief-num">
                              {index < carveStage ? '✓' : index + 1}
                            </span>
                            {label}
                          </li>
                        ),
                      )}
                    </ol>
                    <div className="carve-progress">
                      <span className="carve-progress-bar">
                        <i
                          style={{
                            width: `${Math.round(carveProgress * 100)}%`,
                          }}
                        />
                      </span>
                      <b>{Math.round(carveProgress * 100)}%</b>
                    </div>
                  </div>

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
                        min="4"
                        max="44"
                        value={brushSize}
                        onChange={(event) =>
                          setBrushSize(Number(event.target.value))
                        }
                      />
                      <span>{knifeMm.toFixed(1)}mm</span>
                    </div>

                    <div className="tool-actions">
                      <button
                        type="button"
                        className={soundOn ? 'on' : ''}
                        onClick={() => {
                          const next = !soundOn
                          setSoundOn(next)
                          carveSound.setMuted(!next)
                        }}
                      >
                        {soundOn ? '声音 · 开' : '声音 · 关'}
                      </button>
                      <button
                        type="button"
                        onClick={() => undoRef.current?.()}
                      >
                        撤销
                      </button>
                      <button
                        type="button"
                        onClick={() => setCarve3DKey((key) => key + 1)}
                      >
                        重置 3D 刻面
                      </button>
                    </div>
                  </div>

                  <div
                    className="carve-3d-stage"
                    key={carve3DKey}
                    onPointerMove={(event) => {
                      if (carve3DMode !== 'carve') return
                      const rect = event.currentTarget.getBoundingClientRect()
                      setCursorPos({
                        x: event.clientX - rect.left,
                        y: event.clientY - rect.top,
                      })
                    }}
                    onPointerLeave={() => setCursorPos(null)}
                  >
                      <Carve3D
                        tool={tool}
                        brushSize={brushSize}
                        pattern={pattern.id}
                        orbit={carve3DMode === 'orbit'}
                        patternScale={patternScale}
                        showGuide={showGuide}
                        stone={stone.id}
                        onCaptureReady={(capture) => {
                          captureRef.current = capture
                        }}
                        onUndoReady={(undo) => {
                          undoRef.current = undo
                        }}
                        onProgress={(ratio) => setCarveProgress(ratio)}
                      />
                      <div className="carve-3d-modes" aria-label="3D 视角">
                        <button
                          type="button"
                          className={carve3DMode === 'carve' ? 'active' : ''}
                          onClick={() => setCarve3DMode('carve')}
                        >
                          雕刻
                        </button>
                        <button
                          type="button"
                          className={carve3DMode === 'orbit' ? 'active' : ''}
                          onClick={() => setCarve3DMode('orbit')}
                        >
                          旋转
                        </button>
                      </div>
                      <span className="carve-hint">
                        {carve3DMode === 'orbit'
                          ? '拖动旋转 · 滚轮缩放'
                          : tool === 'polish'
                            ? '按住拖动收光压平 · 滚轮推近看细节'
                            : '按住鼠标沿朱砂描稿拖过去 · 滚轮推近看细节'}
                      </span>
                      {briefOpen && carve3DMode === 'carve' && (
                        <div className="carve-tip" role="dialog" aria-label="雕刻指引">
                          <strong>石面上已经替你描好稿了</strong>
                          <ol>
                            <li>
                              砚堂上那些<b>朱砂（或墨）线条</b>，就是匠人开工前
                              在石头上画的稿 —— 你的任务只有一个：
                              <b>沿着这些线把石头刻掉</b>。
                            </li>
                            <li>
                              按住鼠标拖动下刀。线在哪，刀就往哪走；
                              线外的地方是石面，不用管。
                            </li>
                            <li>
                              先大后小：<b>粗凿</b>定轮廓 → <b>细刀</b>修内部 →
                              <b>打磨</b>收光。
                            </li>
                            <li>刻过的线会自己消失 —— 剩下没消失的，就是还没刻的。</li>
                          </ol>
                          <button
                            type="button"
                            onClick={() => setBriefOpen(false)}
                          >
                            知道了，开始刻
                          </button>
                        </div>
                      )}
                      {carve3DMode === 'carve' && cursorPos && (
                        <span
                          className="carve-cursor"
                          aria-hidden="true"
                          style={{
                            left: cursorPos.x,
                            top: cursorPos.y,
                            // 光标圈要贴着真实刀宽走：之前直接拿滑块值当直径，
                            // 14 档画出一个 14px 的圈，比实际刀口大三四倍，
                            // 一眼就先觉得「刀太粗」
                            width: Math.max(6, Math.round(brushSize * 0.55)),
                            height: Math.max(6, Math.round(brushSize * 0.55)),
                          }}
                        />
                      )}
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
                    <span>当前工序</span>
                    <strong>{stageNames[carveStage]}</strong>
                    <p>
                      {carveStage === 0
                        ? '用粗凿顺着朱砂线定出纹样轮廓，不必刻深。'
                        : carveStage === 1
                          ? '换细刀修内部细节，线条之间要留出石面。'
                          : '打磨收光，把毛刺和凿出的唇边压平。'}
                    </p>
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
                    {showGuide ? '描稿：开（朱砂线=要刻的地方）' : '描稿：关（自由创作）'}
                  </button>
                  <div className="side-card side-note">
                    <span>关于虚拟雕刻</span>
                    <p>
                      3D 刻面通过高度位移生成真实凹槽；真实洮砚雕刻需要匠人根据石料纹理手工完成。
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
          <span className="build-tag">
            版本 {__BUILD_COMMIT__} · 构建于 {__BUILD_TIME__}（UTC）
          </span>
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
