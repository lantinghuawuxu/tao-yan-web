// 凿石的声音，用 Web Audio 现场合成，不加载任何音频文件。
//
// 真实凿刻是三层声音叠在一起：
//   1) 摩擦层：刀尖在石面上走，石屑被刮开 —— 宽带噪声过带通，连续、颗粒细
//   2) 拖曳层：刀身压着石头拖，低频的「嗡」—— 只有高频噪声会像砂纸，没有重量
//   3) 冲击层：每一刀的瞬时崩裂 —— 极短的高频脉冲，外加一声石体的低频共鸣
// 只有摩擦声像砂纸，只有冲击声像敲瓷器，三层都要有才像凿石头。
//
// 上一版的毛病是「单调」：滤波频率、Q 值、衰减时间全是写死的常量，
// 每一刀都是同一段噪声原样播一遍 —— 那不是凿石头，那是一个 50ms 的循环音效。
// 所以下面每一刀都重新掷一次骰子（音高、带宽、衰减、共鸣频率、力度），
// 并且按概率漏掉几刀：手工凿刻本来就是忽轻忽重、有一下没一下的。
//
// 注意：AudioContext 必须在用户手势里创建/恢复，否则浏览器会挂起它，
// 表现为「点了没声音但也不报错」。

const NOISE_SECONDS = 3
// 同时存在的冲击声道数量。轮着用，保证上一刀还在响的时候下一刀能叠上去
const STRIKE_VOICES = 5

type StrikeVoice = {
  filter: BiquadFilterNode
  gain: GainNode
  body: OscillatorNode
  bodyGain: GainNode
}

class CarveSound {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private frictionGain: GainNode | null = null
  private dragGain: GainNode | null = null
  private filter: BiquadFilterNode | null = null
  private voices: StrikeVoice[] = []
  private voiceIndex = 0
  private started = false
  private muted = false
  private lastStrike = 0
  private toneBase = 2600

  /** 在用户手势里调用：创建或恢复 AudioContext */
  ensure() {
    if (typeof window === 'undefined') return
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext
    if (!Ctor) return

    const ctx = new Ctor()

    // 压缩器：凿石是一连串尖峰，直接送到喇叭会削波成「咔咔」的爆音
    const compressor = ctx.createDynamicsCompressor()
    compressor.threshold.value = -18
    compressor.knee.value = 16
    compressor.ratio.value = 3.5
    compressor.attack.value = 0.004
    compressor.release.value = 0.18
    compressor.connect(ctx.destination)

    const master = ctx.createGain()
    master.gain.value = this.muted ? 0 : 0.55
    master.connect(compressor)

    // 一段循环噪声，三层声音共用
    const length = Math.floor(ctx.sampleRate * NOISE_SECONDS)
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    // 稍微「染」一下噪声：纯白噪太刺，真实石屑是略带颗粒的沙沙声。
    // 一阶低通把高频压掉一部分，接近粉噪声的听感
    let previous = 0
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1
      previous = previous * 0.62 + white * 0.38
      data[i] = previous
    }

    const makeSource = () => {
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.loop = true
      return source
    }

    // —— 摩擦层 ——
    const frictionSource = makeSource()
    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = 2600
    band.Q.value = 0.85
    const high = ctx.createBiquadFilter()
    high.type = 'highpass'
    high.frequency.value = 420
    const friction = ctx.createGain()
    friction.gain.value = 0.0001
    frictionSource.connect(band)
    band.connect(high)
    high.connect(friction)
    friction.connect(master)

    // —— 拖曳层：刀身压着石头拖出来的低频，给摩擦声增加「重量」 ——
    const dragSource = makeSource()
    const dragLow = ctx.createBiquadFilter()
    dragLow.type = 'lowpass'
    dragLow.frequency.value = 520
    dragLow.Q.value = 1.1
    const drag = ctx.createGain()
    drag.gain.value = 0.0001
    dragSource.connect(dragLow)
    dragLow.connect(drag)
    drag.connect(master)

    // —— 冲击层：一组可复用的声道，每刀挑一个 ——
    for (let i = 0; i < STRIKE_VOICES; i += 1) {
      const hitSource = makeSource()
      const hitBand = ctx.createBiquadFilter()
      hitBand.type = 'bandpass'
      hitBand.frequency.value = 5200
      hitBand.Q.value = 3
      const hitGain = ctx.createGain()
      hitGain.gain.value = 0.0001
      hitSource.connect(hitBand)
      hitBand.connect(hitGain)
      hitGain.connect(master)
      hitSource.start()

      // 石体共鸣：一块石头被凿一下，除了「嚓」还有一声很闷的木头似的「咚」。
      // 缺这一层，冲击声就只剩指甲刮玻璃
      const body = ctx.createOscillator()
      body.type = 'triangle'
      body.frequency.value = 220
      const bodyGain = ctx.createGain()
      bodyGain.gain.value = 0.0001
      body.connect(bodyGain)
      bodyGain.connect(master)
      body.start()

      this.voices.push({ filter: hitBand, gain: hitGain, body, bodyGain })
    }

    frictionSource.start()
    dragSource.start()

    this.ctx = ctx
    this.master = master
    this.frictionGain = friction
    this.dragGain = drag
    this.filter = band
    this.started = true
  }

  /** 是否在刻：控制摩擦层与拖曳层的起停 */
  setEngaged(engaged: boolean) {
    if (!this.ctx || !this.frictionGain || !this.dragGain) return
    const now = this.ctx.currentTime
    const friction = this.frictionGain.gain
    friction.cancelScheduledValues(now)
    friction.setTargetAtTime(engaged ? 0.12 : 0.0001, now, engaged ? 0.03 : 0.05)
    const drag = this.dragGain.gain
    drag.cancelScheduledValues(now)
    drag.setTargetAtTime(engaged ? 0.04 : 0.0001, now, engaged ? 0.04 : 0.06)
  }

  /** 随笔刷大小与走刀速度改变音色：细刀更高更尖，重刀更闷更沉 */
  setTone(brushSize: number, speed: number) {
    if (!this.ctx || !this.filter || !this.frictionGain || !this.dragGain) return
    const now = this.ctx.currentTime
    const base =
      3600 - Math.min(2000, brushSize * 26) + Math.min(900, speed * 3)
    // 每次调用做一次 ±90Hz 的随机走动。否则摩擦层是一段完全稳定的噪声，
    // 听起来像「开了个吹风机」—— 这是单调感的另一半来源
    this.toneBase = Math.max(700, base + (Math.random() - 0.5) * 180)
    this.filter.frequency.setTargetAtTime(this.toneBase, now, 0.05)
    this.filter.Q.setTargetAtTime(0.7 + Math.random() * 0.5, now, 0.08)

    // 速度越快摩擦越响，但有上限，否则像电钻
    const level = 0.08 + Math.min(0.09, speed / 300)
    this.frictionGain.gain.setTargetAtTime(level, now, 0.05)
    // 音色越低（刀越重），拖曳层越厚
    const dragLevel =
      0.025 + Math.min(0.045, Math.max(0, (1800 - this.toneBase) / 14000))
    this.dragGain.gain.setTargetAtTime(dragLevel, now, 0.08)
  }

  /** 落一刀的崩裂声。pressure 0.8~1.1 */
  strike(pressure = 1) {
    if (!this.ctx || !this.voices.length) return
    const now = this.ctx.currentTime
    // 28ms 内不重复：鼠标事件比真实落刀密得多，全放过会糊成一片白噪声
    if (now - this.lastStrike < 0.028) return
    // 随机漏掉两成：机械等间隔的「哒哒哒」一听就是循环音效
    if (Math.random() < 0.2) return
    this.lastStrike = now

    const voice = this.voices[this.voiceIndex % this.voices.length]
    this.voiceIndex += 1

    // 每一刀都是新的一刀：音高、带宽、衰减、力度全部重掷
    const freq = 3100 + Math.random() * 3700
    const q = 1.6 + Math.random() * 2.8
    const amp = Math.min(0.3, (0.09 + Math.random() * 0.13) * pressure)
    const decay = 0.04 + Math.random() * 0.055

    voice.filter.frequency.cancelScheduledValues(now)
    voice.filter.frequency.setValueAtTime(freq, now)
    voice.filter.Q.cancelScheduledValues(now)
    voice.filter.Q.setValueAtTime(q, now)

    const gain = voice.gain.gain
    gain.cancelScheduledValues(now)
    gain.setValueAtTime(0.0001, now)
    gain.exponentialRampToValueAtTime(amp, now + 0.002)
    gain.exponentialRampToValueAtTime(0.0001, now + decay)

    // 石体共鸣：厚石头低、薄石头高，这里让它在 130~330Hz 之间随机
    voice.body.frequency.cancelScheduledValues(now)
    voice.body.frequency.setValueAtTime(130 + Math.random() * 200, now)
    const bodyGain = voice.bodyGain.gain
    bodyGain.cancelScheduledValues(now)
    bodyGain.setValueAtTime(0.0001, now)
    bodyGain.exponentialRampToValueAtTime(
      amp * (0.3 + Math.random() * 0.25),
      now + 0.004,
    )
    bodyGain.exponentialRampToValueAtTime(0.0001, now + decay * 1.7)
  }

  setMuted(muted: boolean) {
    this.muted = muted
    if (!this.ctx || !this.master) return
    const now = this.ctx.currentTime
    this.master.gain.setTargetAtTime(muted ? 0 : 0.55, now, 0.05)
  }

  dispose() {
    this.setEngaged(false)
    if (this.ctx && this.started) {
      void this.ctx.close()
    }
    this.ctx = null
    this.voices = []
    this.started = false
  }
}

export const carveSound = new CarveSound()
