import { useEffect, useState } from 'react'
import '../Gallery.css'

type Shape = '随形' | '长方' | '椭圆' | '圆形' | '双池'

type Inkstone = {
  id: string
  image: string
  title: string
  note: string
  shape: Shape
  detail: string
}

const inkstones: Inkstone[] = [
  {
    id: 'heyu',
    image: 'images/inkstones/heyu-tuoyuan.jpg',
    title: '荷鱼纹椭圆砚',
    note: '莲叶、游鱼与天然双色石膘',
    shape: '椭圆',
    detail:
      '椭圆砚面，左侧浮雕莲叶、莲花与莲蓬，右侧游鱼顺着石料天然色带展开。砚堂开阔，图案与石色互相借景。',
  },
  {
    id: 'jinbiao',
    image: 'images/inkstones/jinbiao-renwu.jpg',
    title: '金膘人物长方砚',
    note: '金黄石膘与人物雕刻',
    shape: '长方',
    detail:
      '长方形砚式，保留大面积金黄石膘，人物与器物雕刻沿砚边展开，石皮与砚堂形成明显对比。',
  },
  {
    id: 'shanshui',
    image: 'images/inkstones/shanshui-suixing.jpg',
    title: '山水随形砚',
    note: '砚池随形，边缘雕山水人物',
    shape: '随形',
    detail:
      '砚池依石形开出，边缘以山水、人物与云气纹收边。器型不求规整，重点在顺势与留白。',
  },
  {
    id: 'shuangchi',
    image: 'images/inkstones/shuangchi-suxian.jpg',
    title: '双池素面砚',
    note: '一大一小双砚池，保留天然水纹',
    shape: '双池',
    detail:
      '素面双池砚，一大一小两个砚池，砚面保留细密水波纹，少见繁复雕饰。适合观察石料本身的纹理。',
  },
  {
    id: 'huaye',
    image: 'images/inkstones/huaye-suixing.jpg',
    title: '花叶随形砚',
    note: '花叶与云气纹环绕砚边',
    shape: '随形',
    detail:
      '随形砚，砚边以花叶与云气纹环绕，砚堂开阔。外轮廓顺势而作，是“因石施艺”的典型。',
  },
  {
    id: 'huaye-changfang',
    image: 'images/inkstones/huaye-changfang.jpg',
    title: '花叶长方砚',
    note: '满工花叶，砚池居中',
    shape: '长方',
    detail:
      '长方砚，左侧满工花叶，砚池居中，繁简对比明显。花叶的层次与刀口深浅值得细看。',
  },
  {
    id: 'zhushi',
    image: 'images/inkstones/zhushi-changfang.jpg',
    title: '竹石长方砚',
    note: '竹枝与山石沿砚边展开',
    shape: '长方',
    detail:
      '长方砚，竹枝、竹叶与山石沿砚边展开，留出大面积砚堂。竹叶的线刻与石面水纹相呼应。',
  },
  {
    id: 'zhezhi',
    image: 'images/inkstones/zhezhi-changfang.jpg',
    title: '折枝花长方砚',
    note: '浅浮雕折枝花，配木座',
    shape: '长方',
    detail:
      '长方砚，浅浮雕折枝花铺满砚面，配木座展示。花纹起伏较浅，适合观察浮雕与砚堂的过渡。',
  },
  {
    id: 'shinv',
    image: 'images/inkstones/shinv-xianke.jpg',
    title: '仕女线刻长方砚',
    note: '线刻仕女、梧桐与竹',
    shape: '长方',
    detail:
      '长方砚，线刻仕女、梧桐与竹，刀线细密，画面清雅。人物衣纹与树叶的线条是观察重点。',
  },
  {
    id: 'lianwen',
    image: 'images/inkstones/lianwen-yuan.jpg',
    title: '莲纹圆砚',
    note: '圆形砚面，浮雕莲花',
    shape: '圆形',
    detail:
      '圆形砚，砚面浮雕莲花与水波，构图饱满。圆形器型对纹样的对称与连续要求更高。',
  },
  {
    id: 'renwu',
    image: 'images/inkstones/renwu-shanshui.jpg',
    title: '人物山水椭圆砚',
    note: '人物与山水同构',
    shape: '椭圆',
    detail:
      '椭圆砚，人物与山水同构，砚池与画面融为一体。远山、近树与人物层次分明。',
  },
  {
    id: 'chanzhi',
    image: 'images/inkstones/chanzhi-yuan.jpg',
    title: '缠枝纹圆砚',
    note: '满工缠枝纹，线条连续',
    shape: '圆形',
    detail:
      '圆形砚，满工缠枝纹，线条连续，适合看边饰与刀法。缠枝纹的节奏与留白是这类器型的难点。',
  },
]

const filters: ('全部' | Shape)[] = [
  '全部',
  '随形',
  '长方',
  '椭圆',
  '圆形',
  '双池',
]

function Gallery() {
  const [filter, setFilter] = useState<(typeof filters)[number]>('全部')
  const [active, setActive] = useState<Inkstone | null>(null)

  const visible =
    filter === '全部'
      ? inkstones
      : inkstones.filter((item) => item.shape === filter)

  useEffect(() => {
    if (!active) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActive(null)
    }
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [active])

  return (
    <div className="gallery-page">
      <header className="gallery-top">
        <div className="wrap gallery-header">
          <a className="brand" href="#top" aria-label="返回首页">
            <span className="seal">砚</span>
            <span>
              <span className="brand-name">陇上砚语</span>
              <span className="brand-sub">TAO INKSTONE · 非遗数字化</span>
            </span>
          </a>
          <div className="gallery-header-right">
            <span className="gallery-count">砚式图谱 · 12 方</span>
            <a className="gallery-back" href="#top">
              返回首页
            </a>
          </div>
        </div>
      </header>

      <main className="gallery-main">
        <div className="wrap">
          <div className="gallery-heading">
            <div className="section-label">洮砚器型与纹样</div>
            <h1>一方一世界</h1>
            <p>
              从随形、长方到椭圆、圆形，洮砚的器型顺着石料生长，纹样又顺着器型展开。这里收录了 12
              方来自项目素材的砚式，供观察器型、构图与刀法。
            </p>
            <div className="gallery-notice">
              <strong>资料待补</strong>
              图片名称、石料、尺寸、作者与授权信息尚未完整；当前为项目 Demo，正式使用前需补全来源与授权。
            </div>
          </div>

          <div className="gallery-filters" aria-label="按器型筛选">
            {filters.map((item) => (
              <button
                key={item}
                type="button"
                className={`gallery-filter ${filter === item ? 'active' : ''}`}
                onClick={() => setFilter(item)}
              >
                {item}
              </button>
            ))}
          </div>

          <div className="inkstone-grid">
            {visible.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={`inkstone-card ${index === 0 ? 'featured' : ''}`}
                onClick={() => setActive(item)}
              >
                <img src={item.image} alt={item.title} loading="lazy" />
                <span className="inkstone-shape">{item.shape}</span>
                <span className="inkstone-info">
                  <strong>{item.title}</strong>
                  <span>{item.note}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="gallery-cta">
            <div>
              <div className="section-label">从看见到动手</div>
              <h2>想亲手刻一方？</h2>
              <p>不用原石和刻刀，在浏览器里完成你的第一方数字洮砚。</p>
            </div>
            <a className="btn btn-ghost" href="#studio">
              进入虚拟雕刻
            </a>
          </div>

          <p className="gallery-footnote">
            注：以上名称为根据画面内容的暂定描述，不代表馆方或传承人的正式定名。如涉及版权或史实问题，请联系团队修正；正式版本需由非遗顾问审校。
          </p>
        </div>
      </main>

      <footer className="gallery-footer">
        <div className="wrap">
          <span>陇上砚语 · 技术为非遗服务</span>
          <a href="#top">返回首页</a>
        </div>
      </footer>

      {active && (
        <div
          className="inkstone-modal"
          role="dialog"
          aria-modal="true"
          aria-label={active.title}
          onClick={() => setActive(null)}
        >
          <div
            className="inkstone-modal-body"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="modal-close"
              onClick={() => setActive(null)}
              aria-label="关闭"
            >
              ×
            </button>
            <div className="modal-image">
              <img src={active.image} alt={active.title} />
            </div>
            <div className="modal-info">
              <span className="modal-shape">{active.shape}</span>
              <h2>{active.title}</h2>
              <p>{active.detail}</p>
              <div className="modal-meta">
                <div>
                  <span>石料</span>
                  <strong>待补充</strong>
                </div>
                <div>
                  <span>尺寸</span>
                  <strong>待补充</strong>
                </div>
                <div>
                  <span>来源 / 授权</span>
                  <strong>待确认</strong>
                </div>
              </div>
              <p className="modal-note">
                名称与说明为图像观察描述，正式版本需由传承人或馆方审校。
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Gallery
