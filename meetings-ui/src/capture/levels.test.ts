import { describe, expect, it, vi } from 'vitest'
import { createMixer, levelOf } from './mixer'
import { fakeAudioContext, micStream, tabStream } from '../test-support/fakeCapture'

// Spec A13: the mixer measures how loud the microphone ("in") and the shared tab ("out") are.

/** An analyser whose window is a constant signal of `amplitude`. */
const analyser = (amplitude: number) => ({
  fftSize: 0,
  getFloatTimeDomainData: vi.fn((buffer: Float32Array) => buffer.fill(amplitude)),
})

describe('levelOf', () => {
  it('is the scaled RMS of the window, clamped to 0..1', () => {
    const buffer = new Float32Array(new ArrayBuffer(16 * 4))
    expect(levelOf(analyser(0), buffer)).toBe(0)
    expect(levelOf(analyser(0.1), buffer)).toBeCloseTo(0.4)
    expect(levelOf(analyser(0.9), buffer)).toBe(1)
  })
})

describe('mixer levels', () => {
  it('measures the microphone and, while it is shared, the tab', async () => {
    const context = fakeAudioContext()
    const meters = [analyser(0.05), analyser(0.2)]
    Object.assign(context, { createAnalyser: vi.fn(() => meters.shift()) })
    const mixer = await createMixer({ context, microphone: micStream(), tab: tabStream(true) })
    const levels = mixer.levels()
    expect(levels.input).toBeCloseTo(0.2)
    expect(levels.output).toBeCloseTo(0.8)
    await mixer.close()
    expect(mixer.levels()).toEqual({ input: null, output: null })
  })

  it('no shared tab: the output is null', async () => {
    const context = fakeAudioContext()
    Object.assign(context, { createAnalyser: vi.fn(() => analyser(0.05)) })
    const mixer = await createMixer({ context, microphone: micStream() })
    expect(mixer.levels().output).toBeNull()
    expect(mixer.levels().input).not.toBeNull()
  })

  it('a context without analysers, or one that throws, still records: levels are null', async () => {
    const plain = await createMixer({ context: fakeAudioContext(), microphone: micStream() })
    expect(plain.levels()).toEqual({ input: null, output: null })
    const context = fakeAudioContext()
    Object.assign(context, {
      createAnalyser: vi.fn(() => {
        throw new Error('no analysers here')
      }),
    })
    const broken = await createMixer({ context, microphone: micStream() })
    expect(broken.levels()).toEqual({ input: null, output: null })
  })
})
