import { lazy, Suspense, useEffect, useState } from 'react'
import ErrorBoundary from './components/ErrorBoundary'
import LazyStage from './components/LazyStage'
import { asset } from './lib/asset'
import './App.css'

// 3D 画布与图鉴 / 工作室都是按需代码：
// 主包只留首页 DOM 与样式，three.js / drei 全部进独立 chunk，
// 手机首屏不必先下完 1.4MB 才能看到文字和图片。
const StoneStage = lazy(() => import('./components/StoneStage'))
const Gallery = lazy(() => import('./pages/Gallery'))
const Studio = lazy(() => import('./pages/Studio'))

const navItems = [
  { label: '项目缘起', href: '#culture' },
  { label: '行业痛点', href: '#pain' },
  { label: '石料图谱', href: '#stones' },
  { label: '砚式图谱', href: '#inkstones' },
  { label: '数字旅程', href: '#journey' },
  { label: '3D 展厅', href: '#showcase' },
]

const painPoints = [
  {
    num: '01',
    title: '原料之困',
    text: '喇嘛崖老坑生态限采，优质原石价格高涨；原石形态不规则、裂纹与石膘并存，匠人“相石”耗时良久。',
  },
  {
    num: '02',
    title: '传承之困',
    text: '选石、设计、粗雕、细修、抛光十余道工序，三年入门、十年独立，青年学徒断层，匠人队伍老龄化。',
  },
  {
    num: '03',
    title: '传播之困',
    text: '展馆以静态陈列为主，传播多为图文与短视频的单向科普，年轻人听过名字，却很难真正走近洮砚。',
  },
  {
    num: '04',
    title: '体验之困',
    text: '普通人没有原石、刻刀与工坊，无法亲手体验雕刻；中小工坊也缺少数字化辅助设计与展示工具。',
  },
]

const stones = [
  {
    image: asset('images/stone-snow.jpg'),
    name: '鹦哥绿 · 水泉湾',
    note: '细密水纹，温润如脂',
  },
  {
    image: asset('images/stone-yellow.jpg'),
    name: '黄膘 · 喇嘛崖',
    note: '金黄石膘，洮砚标志',
  },
  {
    image: asset('images/stone-color.jpg'),
    name: '五彩云纹膘',
    note: '五彩交织，纹理如云',
  },
  {
    image: asset('images/stone-green.jpg'),
    name: '细水纹 · 老坑',
    note: '天然纹理，一石一面',
  },
  {
    image: asset('images/stone-purple.jpg'),
    name: '紫石 · 喇嘛崖',
    note: '上紫下绿，石质珍罕',
  },
]

const steps = [
  {
    glyph: '石',
    en: 'STEP 01',
    title: '选石',
    text: '浏览数字原石库，选一块属于你的洮河石，观察它的形状、石膘与纹理。',
  },
  {
    glyph: '识',
    en: 'STEP 02',
    title: 'AI 识石',
    text: '上传石料图像，AI 辅助识别轮廓、裂纹与可雕刻区域，生成石料分析。',
  },
  {
    glyph: '纹',
    en: 'STEP 03',
    title: '纹样生成',
    text: '从洮砚传统纹样库中智能匹配方案，也可以自由调整构图与线条。',
  },
  {
    glyph: '刻',
    en: 'STEP 04',
    title: '虚拟雕刻',
    text: '模拟打磨、修边与雕刻，在屏幕上实时看到石料被一点点雕琢。',
  },
  {
    glyph: '藏',
    en: 'STEP 05',
    title: '保存分享',
    text: '生成你的数字砚台作品，分享给朋友；优秀设计有机会交由工坊落地。',
  },
]

const timeline = [
  {
    year: '唐宋',
    title: '洮河石出',
    text: '洮砚采制技艺发端于洮河流域，以石质温润、发墨快而不损毫闻名。',
  },
  {
    year: '明清',
    title: '四大名砚',
    text: '洮砚跻身中国四大名砚，成为文人案头珍品，汉藏纹样在此交汇。',
  },
  {
    year: '2008',
    title: '国家级非遗',
    text: '洮砚制作技艺列入国家级非物质文化遗产名录，技艺保护进入新阶段。',
  },
  {
    year: '2026',
    title: '数字新生',
    text: '「匠心砚」团队走进卓尼，用 3D 与 AI 记录原石、器型与纹样。',
  },
]

function Home() {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const elements = document.querySelectorAll('[data-reveal]')
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible')
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.12 },
    )

    elements.forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [])

  return (
    <>
      <header
        className={`site-header${scrolled ? ' scrolled' : ''}${menuOpen ? ' open' : ''}`}
      >
        <div className="wrap">
          <div className="header-inner">
            <a className="brand" href="#top" aria-label="陇上砚语首页">
              <span className="seal">砚</span>
              <span>
                <span className="brand-name">陇上砚语</span>
                <span className="brand-sub">TAO INKSTONE · 非遗数字化</span>
              </span>
            </a>

            <nav className="nav" aria-label="主导航">
              {navItems.map((item) => (
                <a key={item.href} href={item.href}>
                  {item.label}
                </a>
              ))}
            </nav>

            <a className="header-cta" href="#studio">
              开始体验
            </a>

            <button
              className="menu-btn"
              type="button"
              aria-label={menuOpen ? '关闭菜单' : '打开菜单'}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span />
            </button>
          </div>

          <nav className="mobile-nav" aria-label="移动端导航">
            {navItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
              >
                {item.label}
              </a>
            ))}
            <a href="#studio" onClick={() => setMenuOpen(false)}>
              开始体验
            </a>
          </nav>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <img
            className="hero-mountains"
            src={asset('images/mountains.png')}
            width={902}
            height={298}
            alt=""
            aria-hidden="true"
            fetchPriority="high"
            decoding="async"
          />
          <img
            className="hero-lotus"
            src={asset('images/lotus.png')}
            width={502}
            height={680}
            alt=""
            aria-hidden="true"
            fetchPriority="high"
            decoding="async"
          />

          <div className="wrap">
            <div className="hero-content">
              <div className="eyebrow">
                国家级非物质文化遗产 · 洮砚
              </div>
              <h1>
                陇上<span>砚语</span>
              </h1>
              <p className="hero-sub">让千年洮砚，被看见，也被触摸</p>
              <p className="hero-desc">
                从卓尼洮河峡谷的一块原石出发，用 3D 与 AI
                记录石料、器型与纹样，把非遗从静态展柜带进可交互的数字世界。
              </p>

              <div className="hero-tags">
                <span>3D 数字展厅</span>
                <span>AI 石料识别</span>
                <span>虚拟雕刻交互</span>
              </div>

              <div className="hero-actions">
                <a className="btn btn-primary" href="#studio">
                  开始虚拟雕刻
                </a>
                <a className="btn btn-ghost" href="#culture">
                  了解洮砚
                </a>
              </div>

              <div className="hero-stats">
                <div className="stat">
                  <strong>四大</strong>
                  <span>中国名砚之一</span>
                </div>
                <div className="stat">
                  <strong>2008</strong>
                  <span>国家级非遗</span>
                </div>
                <div className="stat">
                  <strong>12</strong>
                  <span>名青年队员田野调研</span>
                </div>
                <div className="stat">
                  <strong>1</strong>
                  <span>个数字非遗体验平台</span>
                </div>
              </div>
            </div>
          </div>

          <div className="hero-scroll">SCROLL</div>
        </section>

        <section id="culture" className="section intro">
          <div className="wrap intro-grid">
            <div className="intro-visual" data-reveal>
              <div className="intro-frame">
                <img
                  src={asset('images/stone-veined.jpg')}
                  width={440}
                  height={368}
                  decoding="async"
                  alt="洮砚原石上的白色石花与水波纹理"
                />
              </div>
              <div className="intro-badge">
                <strong>洮河绿石</strong>
                <span>卓尼 · 喇嘛崖老坑</span>
              </div>
            </div>

            <div className="intro-text" data-reveal>
              <div className="section-label">项目缘起</div>
              <h2>
                一块洮河石
                <br />
                半部汉藏交流史
              </h2>
              <p className="intro-lead">
                洮砚是中国四大名砚之一，也是其中唯一产自西北的砚台。石出甘肃甘南卓尼洮河峡谷，温润如玉，发墨如油。
              </p>
              <p>
                2026
                年夏天，兰州大学「匠心砚」实践团走进卓尼，走访洮砚博物馆与非遗工坊，访谈传承人、青年学徒与砚商。我们看见石料稀缺、技艺断层、传播受限，也看见年轻人对这门古老手艺的好奇。
              </p>
              <p>
                于是我们决定用自己擅长的方式，为洮砚做一份数字档案：把原石、砚台与纹样留下来，把雕刻的乐趣交给每一个没有刻刀的人。
              </p>

              <blockquote className="quote">
                “不必人人传承，但人人皆可保护。”
                <span>—— 兰州大学「匠心砚」实践创新团队</span>
              </blockquote>

              <div className="intro-facts">
                <div className="fact">
                  <strong>甘肃 · 卓尼</strong>
                  <span>洮砚原产地</span>
                </div>
                <div className="fact">
                  <strong>汉藏交融</strong>
                  <span>纹样与器型</span>
                </div>
                <div className="fact">
                  <strong>国家级非遗</strong>
                  <span>2008 年入选</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="pain" className="section pain">
          <div className="wrap">
            <div className="section-head" data-reveal>
              <div className="section-label">我们看见的问题</div>
              <h2>一块好石头，如何走到今天？</h2>
              <p className="section-desc">
                在卓尼的田野调研中，我们记录下洮砚正在面对的四重困境。它们不是抽象的数据，而是一位位匠人、一间间工坊的真实日常。
              </p>
            </div>

            <div className="pain-grid">
              {painPoints.map((point) => (
                <article className="pain-card" key={point.num} data-reveal>
                  <div className="pain-num">{point.num}</div>
                  <h3>{point.title}</h3>
                  <p>{point.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="stones" className="section stones">
          <div className="wrap">
            <div className="section-head" data-reveal>
              <div className="section-label">石料图谱</div>
              <h2>石有语，纹有脉</h2>
              <p className="section-desc">
                洮砚的美，先从石头本身开始。水波纹、云气纹、鱼卵膘、凝霜膘——每一块原石都带着独一无二的时间痕迹。
              </p>
            </div>

            <div className="stone-grid">
              {stones.map((stone) => (
                <figure className="stone-card" key={stone.name} data-reveal>
                  <img
                    className="stone-img"
                    src={stone.image}
                    alt={stone.name}
                    loading="lazy"
                    decoding="async"
                  />
                  <figcaption className="stone-info">
                    <strong>{stone.name}</strong>
                    <span>{stone.note}</span>
                  </figcaption>
                </figure>
              ))}
            </div>

            <div className="stones-cta" data-reveal>
              <p>
                除了原石，我们还用参数化 3D 还原了随形、长方、椭圆、圆形、双池五种砚式，可切换莲纹、云纹、水波、回纹。
              </p>
              <a className="btn btn-ghost" href="#inkstones">
                查看 3D 砚式图谱
              </a>
            </div>
          </div>
        </section>

        <section id="journey" className="section journey">
          <div className="wrap">
            <div className="section-head" data-reveal>
              <div className="section-label">数字旅程</div>
              <h2>从一块石，到一方砚</h2>
              <p className="section-desc">
                我们把真实制砚的关键步骤，转译成一条可以在浏览器里走完的数字体验流程。无需原石与刻刀，也能理解一方洮砚如何诞生。
              </p>
            </div>

            <div className="journey-grid">
              {steps.map((step) => (
                <article className="step" key={step.title} data-reveal>
                  <div className="step-dot">{step.glyph}</div>
                  <small>{step.en}</small>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="showcase" className="section showcase">
          <div className="wrap showcase-grid">
            <div data-reveal>
              <div className="section-label">3D DIGITAL SHOWROOM</div>
              <h2>
                把一方砚台，
                <br />
                转到掌心
              </h2>
              <p className="section-desc">
                当前用 Poly Haven CC0 岩石模型做原石交互原型；真实洮砚原石与器型模型，需要后续用授权照片做摄影测量或实物扫描。拖拽、旋转、缩放，先从一块数字原石开始。
              </p>

              <ul className="check-list">
                <li>原石交互原型与参数化砚台器型</li>
                <li>可旋转、可缩放、可点击热点的线上展厅</li>
                <li>正式模型与纹样需由非遗传承人参与校验</li>
              </ul>

              <a className="btn btn-ghost" href="#journey">
                查看数字旅程
              </a>
            </div>

            <div className="stage" data-reveal>
              <div className="stage-top">
                <span className="stage-tag">数字原石 · 交互预览</span>
                <span className="stage-live">LIVE 3D</span>
              </div>
              <LazyStage
                placeholder={
                  <div className="stage-placeholder">
                    <span className="stage-placeholder-title">
                      数字原石 · 加载中
                    </span>
                    <span className="stage-placeholder-note">
                      滚动到这里时加载 3D 预览，避免和首屏图片抢网速
                    </span>
                  </div>
                }
              >
              {/*
                两道保险：
                Suspense —— 3D chunk 还在下载时显示占位
                ErrorBoundary —— 模型 / HDR 拉取失败时只废掉这一块，
                                 不让异常冒到根节点把整页卸成白屏
              */}
              {(inView) => (
                <ErrorBoundary
                  fallback={
                    <div className="stage-placeholder">
                      <span className="stage-placeholder-title">
                        3D 预览加载失败
                      </span>
                      <span className="stage-placeholder-note">
                        刷新页面可重试；图片与文字不受影响
                      </span>
                    </div>
                  }
                >
                  <Suspense
                    fallback={
                      <div className="stage-placeholder">
                        <span className="stage-placeholder-title">
                          正在加载 3D 预览…
                        </span>
                        <span className="stage-placeholder-note">
                          首次加载约 5MB 模型资源，请稍候
                        </span>
                      </div>
                    }
                  >
                    <StoneStage inView={inView} />
                  </Suspense>
                </ErrorBoundary>
              )}
              </LazyStage>
              <span className="stage-hint">
                拖拽旋转 · 滚轮缩放
              </span>
            </div>
          </div>
        </section>

        <section id="science" className="section science">
          <div className="wrap">
            <div className="section-head" data-reveal>
              <div className="section-label">洮砚简史</div>
              <h2>千年石语，仍在继续</h2>
              <p className="section-desc">
                从唐宋文人的案头，到今天的数字屏幕，洮砚的故事从未中断。
              </p>
            </div>

            <div className="timeline">
              {timeline.map((item) => (
                <article className="tl-item" key={item.year} data-reveal>
                  <div className="tl-year">{item.year}</div>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="cta">
          <div className="wrap cta-inner">
            <div data-reveal>
              <h2>不必人人成为匠人，<br />但人人皆可保护。</h2>
              <p>从你的第一方数字洮砚开始。</p>
            </div>
            <a className="btn btn-light" href="#studio" data-reveal>
              开始体验
            </a>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="wrap">
          <div className="footer-grid">
            <div className="footer-brand">
              <a className="brand" href="#top">
                <span className="seal">砚</span>
                <span>
                  <span className="brand-name">陇上砚语</span>
                  <span className="brand-sub">TAO INKSTONE · 非遗数字化</span>
                </span>
              </a>
              <p>
                兰州大学「匠心砚」实践创新团队，以 3D、AI
                与网页交互技术，记录并传播国家级非物质文化遗产洮砚。
              </p>
            </div>

            <div className="footer-col">
              <h4>快速导航</h4>
              {navItems.map((item) => (
                <a key={item.href} href={item.href}>
                  {item.label}
                </a>
              ))}
            </div>

            <div className="footer-col">
              <h4>合作与支持</h4>
              <span>共青团卓尼县委员会</span>
              <span>卓尼县洮砚博物馆</span>
              <span>洮砚非遗传承人</span>
              <span>兰州大学</span>
            </div>
          </div>

          <div className="footer-bottom">
            <span>© 2026 兰州大学「匠心砚」实践创新团队</span>
            <span>本项目为非遗数字化公益 Demo · 技术为非遗服务</span>
          </div>
        </div>
      </footer>
    </>
  )
}

function PageLoading() {
  return (
    <div className="page-loading" role="status" aria-live="polite">
      <span className="page-loading-seal" aria-hidden="true">
        砚
      </span>
      <span>正在加载…</span>
    </div>
  )
}

function PageFailed() {
  return (
    <div className="page-loading" role="alert">
      <span className="page-loading-seal" aria-hidden="true">
        砚
      </span>
      <span>页面加载失败，请刷新重试</span>
      <a href="#top">返回首页</a>
    </div>
  )
}

function App() {
  const [hash, setHash] = useState(() => window.location.hash)

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    if (hash === '#top') {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [hash])

  if (hash === '#studio') {
    return (
      <ErrorBoundary fallback={<PageFailed />}>
        <Suspense fallback={<PageLoading />}>
          <Studio />
        </Suspense>
      </ErrorBoundary>
    )
  }
  if (hash === '#inkstones') {
    return (
      <ErrorBoundary fallback={<PageFailed />}>
        <Suspense fallback={<PageLoading />}>
          <Gallery />
        </Suspense>
      </ErrorBoundary>
    )
  }

  return <Home />
}

export default App
