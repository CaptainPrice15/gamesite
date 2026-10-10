import type { AudioLike, SfxName } from './types'

interface ToneOpts {
  freq: number
  dur: number
  type?: OscillatorType
  gain?: number
  sweepTo?: number
  delay?: number
}

interface SfxDef {
  tones: ToneOpts[]
}

const SFX: Record<SfxName, SfxDef> = {
  click: { tones: [{ freq: 660, dur: 0.05, type: 'square', gain: 0.25 }] },
  move: { tones: [{ freq: 320, dur: 0.03, type: 'square', gain: 0.14 }] },
  eat: {
    tones: [
      { freq: 440, dur: 0.1, type: 'sine', gain: 0.4, sweepTo: 880 },
      { freq: 880, dur: 0.08, type: 'sine', gain: 0.25, delay: 0.06 },
    ],
  },
  die: { tones: [{ freq: 320, dur: 0.45, type: 'sawtooth', gain: 0.3, sweepTo: 70 }] },
  bounce: { tones: [{ freq: 300, dur: 0.06, type: 'square', gain: 0.3, sweepTo: 360 }] },
  wall: { tones: [{ freq: 150, dur: 0.09, type: 'triangle', gain: 0.35, sweepTo: 90 }] },
  clear: {
    tones: [
      { freq: 520, dur: 0.1, type: 'triangle', gain: 0.3, sweepTo: 1040 },
      { freq: 1040, dur: 0.14, type: 'sine', gain: 0.25, delay: 0.08 },
    ],
  },
  line: {
    tones: [
      { freq: 392, dur: 0.08, type: 'square', gain: 0.3 },
      { freq: 523, dur: 0.08, type: 'square', gain: 0.3, delay: 0.07 },
      { freq: 659, dur: 0.12, type: 'square', gain: 0.3, delay: 0.14 },
    ],
  },
  merge: { tones: [{ freq: 500, dur: 0.1, type: 'sine', gain: 0.3, sweepTo: 700 }] },
  win: {
    tones: [
      { freq: 523, dur: 0.1, type: 'triangle', gain: 0.35 },
      { freq: 659, dur: 0.1, type: 'triangle', gain: 0.35, delay: 0.1 },
      { freq: 784, dur: 0.18, type: 'triangle', gain: 0.35, delay: 0.2 },
    ],
  },
  lose: {
    tones: [
      { freq: 392, dur: 0.14, type: 'sawtooth', gain: 0.3 },
      { freq: 330, dur: 0.14, type: 'sawtooth', gain: 0.3, delay: 0.12 },
      { freq: 262, dur: 0.3, type: 'sawtooth', gain: 0.3, delay: 0.24 },
    ],
  },
  start: {
    tones: [
      { freq: 440, dur: 0.09, type: 'square', gain: 0.3 },
      { freq: 880, dur: 0.14, type: 'square', gain: 0.3, delay: 0.09 },
    ],
  },
  countdown: { tones: [{ freq: 700, dur: 0.07, type: 'square', gain: 0.3 }] },
}

const MUSIC_SCALE = [261.63, 293.66, 349.23, 392.0, 440.0, 523.25, 587.33]
const MUSIC_STEP_MS = 420

/** Procedurally generated audio — zero assets, zero licensing. */
export class AudioEngine implements AudioLike {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private sfxBus: GainNode | null = null
  private musicBus: GainNode | null = null
  private musicTimer: ReturnType<typeof setInterval> | null = null
  private musicNote = 0
  private failed = false

  private volumes = { master: 0.8, music: 0.4, sfx: 0.8 }
  private muted = false

  private ensure(): boolean {
    if (this.failed) return false
    if (this.ctx) return true
    try {
      const Ctor: typeof AudioContext =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!Ctor) {
        this.failed = true
        return false
      }
      this.ctx = new Ctor()
      this.master = this.ctx.createGain()
      this.sfxBus = this.ctx.createGain()
      this.musicBus = this.ctx.createGain()
      this.sfxBus.connect(this.master)
      this.musicBus.connect(this.master)
      this.master.connect(this.ctx.destination)
      this.applyVolumes()
    } catch {
      this.failed = true
      return false
    }
    return true
  }

  private applyVolumes(): void {
    if (!this.master || !this.sfxBus || !this.musicBus) return
    const m = this.muted ? 0 : this.volumes.master
    this.master.gain.value = m
    this.sfxBus.gain.value = this.volumes.sfx
    this.musicBus.gain.value = this.volumes.music * 0.5
  }

  setVolumes(v: { master?: number; music?: number; sfx?: number }): void {
    if (v.master !== undefined) this.volumes.master = clamp01(v.master)
    if (v.music !== undefined) this.volumes.music = clamp01(v.music)
    if (v.sfx !== undefined) this.volumes.sfx = clamp01(v.sfx)
    this.applyVolumes()
  }

  getVolumes(): { master: number; music: number; sfx: number } {
    return { ...this.volumes }
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    this.applyVolumes()
  }

  isMuted(): boolean {
    return this.muted
  }

  resume(): void {
    if (!this.ensure()) return
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume()
  }

  play(name: SfxName, opts?: { pitch?: number }): void {
    if (this.muted || !this.ensure() || !this.ctx || !this.sfxBus) return
    const def = SFX[name]
    if (!def) return
    const pitch = opts?.pitch ?? 1
    for (const tone of def.tones) {
      this.tone(tone, this.sfxBus, pitch)
    }
  }

  private tone(tone: ToneOpts, bus: GainNode, pitch = 1): void {
    const ctx = this.ctx
    if (!ctx) return
    const t0 = ctx.currentTime + (tone.delay ?? 0)
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = tone.type ?? 'sine'
    osc.frequency.setValueAtTime(tone.freq * pitch, t0)
    if (tone.sweepTo)
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, tone.sweepTo * pitch), t0 + tone.dur)
    const peak = tone.gain ?? 0.3
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + tone.dur)
    osc.connect(gain)
    gain.connect(bus)
    osc.start(t0)
    osc.stop(t0 + tone.dur + 0.02)
  }

  /** Generative ambient loop — a soft pentatonic arpeggio. */
  startMusic(): void {
    if (this.musicTimer || !this.ensure()) return
    this.musicTimer = setInterval(() => {
      if (!this.ctx || !this.musicBus || this.muted) return
      const note = MUSIC_SCALE[this.musicNote % MUSIC_SCALE.length]
      this.musicNote += Math.random() < 0.3 ? 2 : 1
      this.tone(
        { freq: note, dur: MUSIC_STEP_MS / 1000, type: 'triangle', gain: 0.12 },
        this.musicBus,
      )
      if (this.musicNote % 4 === 0) {
        this.tone(
          { freq: note / 2, dur: (MUSIC_STEP_MS / 1000) * 1.5, type: 'sine', gain: 0.1 },
          this.musicBus,
        )
      }
    }, MUSIC_STEP_MS)
  }

  stopMusic(): void {
    if (this.musicTimer) {
      clearInterval(this.musicTimer)
      this.musicTimer = null
    }
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend()
  }

  destroy(): void {
    this.stopMusic()
    try {
      void this.ctx?.close()
    } catch {
      /* ignore */
    }
    this.ctx = null
    this.master = null
    this.sfxBus = null
    this.musicBus = null
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

let singleton: AudioEngine | null = null
export function getAudio(): AudioEngine {
  if (!singleton) singleton = new AudioEngine()
  return singleton
}
