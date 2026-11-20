// 凿石的声音，用 Web Audio 现场合成，不加载任何音频文件。
//
// 真实凿刻是两层声音叠加：
//   1) 摩擦层：刀尖在石面上走，石屑被刮开 —— 宽带噪声过带通，频率偏高、连续
//   2) 冲击层：每一刀的瞬时崩裂 —— 极短的高频脉冲，指数衰减
// 只有摩擦声会像「砂纸」，只有冲击声会像「敲瓷器」，两层都要有才像凿石头。
//
// 注意：AudioContext 必须在用户手势里创建/恢复，否则浏览器会挂起它，
// 表现为「点了没声音但也不报错」。

const NOISE_SECONDS = 2

class CarveSound {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private frictionGain: GainNode | null = null
  private strikeGain: GainNode | null = null
  private filter: BiquadFilterNode | null = null
  private started = false
  private muted = false
  private lastStrike = 0

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
    const master = ctx.createGain()
    master.gain.value = this.muted ? 0 : 0.5
    master.connect(ctx.destination)

    // 一段循环白噪声，两层声音共用
    const length = Math.floor(ctx.sampleRate * NOISE_SECONDS)
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    // 稍微「染」一下噪声：纯白噪太刺，真实石屑是略带颗粒的沙沙声
    let previous = 0
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1
      previous = previous * 0.55 + white * 0.45
      data[i] = previous
    }

    // —— 摩擦层 ——
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.loop = true
    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = 2400
    band.Q.value = 0.75
    const high = ctx.createBiquadFilter()
    high.type = 'highpass'
    high.frequency.value = 520
    const friction = ctx.createGain()
    friction.gain.value = 0.0001
    source.connect(band)
    band.connect(high)
    high.connect(friction)
    friction.connect(master)

    // —— 冲击层（共用一条链，靠包络触发）——
    const hitSource = ctx.createBufferSource()
    hitSource.buffer = buffer
    hitSource.loop = true
    const hitBand = ctx.createBiquadFilter()
    hitBand.type = 'bandpass'
    hitBand.frequency.value = 5200
    hitBand.Q.value = 3.2
    const strike = ctx.createGain()
    strike.gain.value = 0.0001
    hitSource.connect(hitBand)
    hitBand.connect(strike)
    strike.connect(master)

    source.start()
    hitSource.start()

    this.ctx = ctx
    this.master = master
    this.frictionGain = friction
    this.strikeGain = strike
    this.filter = band
    this.started = true
  }

  /** 是否在刻：控制摩擦层起停 */
  setEngaged(engaged: boolean) {
    if (!this.ctx || !this.frictionGain) return
    const now = this.ctx.currentTime
    const gain = this.frictionGain.gain
    gain.cancelScheduledValues(now)
    gain.setTargetAtTime(engaged ? 0.13 : 0.0001, now, engaged ? 0.03 : 0.05)
  }

  /** 随笔刷大小与速度改变音色：细刀更高更尖，重刀更闷更响 */
  setTone(brushSize: number, speed: number) {
    if (!this.ctx || !this.filter || !this.frictionGain) return
    const now = this.ctx.currentTime
    const freq = 3400 - Math.min(1600, brushSize * 28) + Math.min(700, speed * 2.5)
    this.filter.frequency.setTargetAtTime(Math.max(900, freq), now, 0.08)
    // 速度越快摩擦越响，但有上限，否则像电钻
    const level = 0.1 + Math.min(0.1, speed / 260)
    this.frictionGain.gain.setTargetAtTime(level, now, 0.06)
  }

  /** 落一刀的崩裂声。pressure 0~1.2 */
  strike(pressure = 1) {
    if (!this.ctx || !this.strikeGain) return
    const now = this.ctx.currentTime
    // 40ms 内不重复触发：鼠标每帧都来一发会变成白噪声墙
    if (now - this.lastStrike < 0.04) return
    this.lastStrike = now
    const gain = this.strikeGain.gain
    gain.cancelScheduledValues(now)
    gain.setValueAtTime(Math.min(0.34, 0.16 * pressure), now)
    gain.exponentialRampToValueAtTime(0.0001, now + 0.055)
  }

  setMuted(muted: boolean) {
    this.muted = muted
    if (!this.ctx || !this.master) return
    const now = this.ctx.currentTime
    this.master.gain.setTargetAtTime(muted ? 0 : 0.5, now, 0.05)
  }

  dispose() {
    this.setEngaged(false)
    if (this.ctx && this.started) {
      void this.ctx.close()
    }
    this.ctx = null
    this.started = false
  }
}

export const carveSound = new CarveSound()
