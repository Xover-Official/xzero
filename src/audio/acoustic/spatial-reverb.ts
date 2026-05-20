import { Effect, Ref } from "effect"
import type { AcousticProfile } from "./acoustic-environment.js"
import { DEFAULT_ACOUSTIC_PROFILE } from "./acoustic-environment.js"

export interface ReverbState {
  profile: AcousticProfile
  wetDryMix: number
  preDelay: number
  decayTime: number
  damping: number
  earlyReflections: Float32Array[]
  lateReverbBuffer: Float32Array
  slapbackBuffer: Float32Array
  writeIndex: number
  sampleRate: number
}

export interface SpatialReverbEngine {
  readonly processSample: (sample: number, channel: number) => Effect.Effect<number>
  readonly processBuffer: (buffer: Float32Array, channel: number) => Effect.Effect<Float32Array>
  readonly setProfile: (profile: AcousticProfile) => Effect.Effect<void>
  readonly getProfile: () => Effect.Effect<AcousticProfile>
  readonly setWetDryMix: (mix: number) => Effect.Effect<void>
  readonly reset: () => Effect.Effect<void>
  readonly generateImpulseResponse: (profile: AcousticProfile, length: number) => Float32Array
}

export function makeSpatialReverbEngine(sampleRate: number = 44100): SpatialReverbEngine {
  function createReverbState(profile: AcousticProfile): ReverbState {
    const maxDelay = Math.ceil(profile.reverbTime * sampleRate)
    const earlyCount = 4
    const earlyDelays = [
      Math.floor(0.005 * sampleRate),
      Math.floor(0.011 * sampleRate),
      Math.floor(0.017 * sampleRate),
      Math.floor(0.023 * sampleRate),
    ]

    const earlyReflections: Float32Array[] = earlyDelays.map((delay) =>
      new Float32Array(delay + 1024)
    )

    const lateReverbBuffer = new Float32Array(maxDelay + 4096)
    const slapbackBuffer = new Float32Array(Math.ceil(profile.slapbackDelay * sampleRate) + 1024)

    return {
      profile,
      wetDryMix: 0.3,
      preDelay: profile.slapbackDelay,
      decayTime: profile.reverbTime,
      damping: 1 - profile.highCut / 20000,
      earlyReflections,
      lateReverbBuffer,
      slapbackBuffer,
      writeIndex: 0,
      sampleRate,
    }
  }

  const stateRef = { current: createReverbState(DEFAULT_ACOUSTIC_PROFILE) }

  function generateImpulseResponse(profile: AcousticProfile, length: number): Float32Array {
    const ir = new Float32Array(length)
    const reverbTime = profile.reverbTime
    const decayRate = Math.pow(0.001, 1 / (reverbTime * 44100))

    const earlyReflectionCount = Math.floor(profile.earlyReflections * 8)
    const earlyReflectionTimes = [
      0.005, 0.011, 0.017, 0.023, 0.029, 0.035, 0.041, 0.047,
    ]

    for (let i = 0; i < earlyReflectionCount && i < earlyReflectionTimes.length; i++) {
      const sampleIdx = Math.floor(earlyReflectionTimes[i] * 44100)
      if (sampleIdx < length) {
        const gain = profile.earlyReflections * Math.pow(0.7, i)
        ir[sampleIdx] = gain
      }
    }

    const lateStart = Math.floor(0.08 * 44100)
    for (let i = lateStart; i < length; i++) {
      const envelope = Math.pow(decayRate, i - lateStart)
      const noise = (Math.random() * 2 - 1) * profile.lateReverb
      const diffusion = Math.sin(i * 0.001 * profile.diffusion * Math.PI)
      ir[i] = noise * envelope * (0.5 + 0.5 * diffusion)
    }

    const highCutCoeff = 1 - profile.highCut / 22050
    let prev = 0
    for (let i = 1; i < length; i++) {
      ir[i] = ir[i] * (1 - highCutCoeff) + prev * highCutCoeff
      prev = ir[i]
    }

    const totalEnergy = ir.reduce((sum, v) => sum + v * v, 0)
    if (totalEnergy > 0) {
      const normalization = 1 / Math.sqrt(totalEnergy)
      for (let i = 0; i < length; i++) {
        ir[i] *= normalization
      }
    }

    return ir
  }

  function applyReverbToBuffer(buffer: Float32Array, channel: number): Float32Array {
    const state = stateRef.current
    const output = new Float32Array(buffer.length)
    const profile = state.profile

    for (let i = 0; i < buffer.length; i++) {
      const input = buffer[i]
      const writeIdx = state.writeIndex % state.lateReverbBuffer.length

      let earlySum = 0
      for (let j = 0; j < state.earlyReflections.length; j++) {
        const er = state.earlyReflections[j]
        const erIdx = (state.writeIndex - Math.floor([0.005, 0.011, 0.017, 0.023][j] * state.sampleRate) + er.length) % er.length
        earlySum += er[erIdx] * profile.earlyReflections * (1 - j * 0.15)
        er[erIdx] = 0
      }

      const slapbackIdx = (state.writeIndex - Math.floor(profile.slapbackDelay * state.sampleRate) + state.slapbackBuffer.length) % state.slapbackBuffer.length
      const slapback = state.slapbackBuffer[slapbackIdx] * profile.slapbackGain

      const lateIdx = (state.writeIndex - Math.floor(profile.reverbTime * 0.3 * state.sampleRate) + state.lateReverbBuffer.length) % state.lateReverbBuffer.length
      const lateReverb = state.lateReverbBuffer[lateIdx] * profile.lateReverb

      state.lateReverbBuffer[writeIdx] = input + lateReverb * (1 - (profile as any).damping * 0.5)
      state.slapbackBuffer[state.writeIndex % state.slapbackBuffer.length] = input

      for (let j = 0; j < state.earlyReflections.length; j++) {
        const er = state.earlyReflections[j]
        const erWriteIdx = (state.writeIndex + Math.floor([0.005, 0.011, 0.017, 0.023][j] * state.sampleRate)) % er.length
        er[erWriteIdx] = input * (1 - j * 0.15)
      }

      const wet = (earlySum + slapback + lateReverb) * state.wetDryMix
      const dry = input * (1 - state.wetDryMix)

      output[i] = dry + wet

      state.writeIndex++
    }

    return output
  }

  return {
    processSample: (sample, channel) =>
      Effect.sync(() => {
        const state = stateRef.current
        const profile = state.profile

        const writeIdx = state.writeIndex % state.lateReverbBuffer.length

        let earlySum = 0
        for (let j = 0; j < state.earlyReflections.length; j++) {
          const er = state.earlyReflections[j]
          const delays = [0.005, 0.011, 0.017, 0.023]
          const erIdx = (state.writeIndex - Math.floor(delays[j] * state.sampleRate) + er.length) % er.length
          earlySum += er[erIdx] * profile.earlyReflections * (1 - j * 0.15)
        }

        const slapbackDelay = Math.floor(profile.slapbackDelay * state.sampleRate)
        const slapbackIdx = (state.writeIndex - slapbackDelay + state.slapbackBuffer.length) % state.slapbackBuffer.length
        const slapback = state.slapbackBuffer[slapbackIdx] * profile.slapbackGain

        const lateDelay = Math.floor(profile.reverbTime * 0.3 * state.sampleRate)
        const lateIdx = (state.writeIndex - lateDelay + state.lateReverbBuffer.length) % state.lateReverbBuffer.length
        const lateReverb = state.lateReverbBuffer[lateIdx] * profile.lateReverb

        state.lateReverbBuffer[writeIdx] = sample + lateReverb * (1 - (profile as any).damping * 0.5)
        state.slapbackBuffer[state.writeIndex % state.slapbackBuffer.length] = sample

        for (let j = 0; j < state.earlyReflections.length; j++) {
          const er = state.earlyReflections[j]
          const delays = [0.005, 0.011, 0.017, 0.023]
          const erWriteIdx = (state.writeIndex + Math.floor(delays[j] * state.sampleRate)) % er.length
          er[erWriteIdx] = sample * (1 - j * 0.15)
        }

        const wet = (earlySum + slapback + lateReverb) * state.wetDryMix
        const dry = sample * (1 - state.wetDryMix)

        state.writeIndex++

        return dry + wet
      }),

    processBuffer: (buffer, channel) =>
      Effect.sync(() => applyReverbToBuffer(buffer, channel)),

    setProfile: (profile) =>
      Effect.sync(() => {
        stateRef.current.profile = profile
        stateRef.current.decayTime = profile.reverbTime
        stateRef.current.damping = 1 - profile.highCut / 20000
      }),

    getProfile: () =>
      Effect.sync(() => stateRef.current.profile),

    setWetDryMix: (mix) =>
      Effect.sync(() => {
        stateRef.current.wetDryMix = Math.max(0, Math.min(1, mix))
      }),

    reset: () =>
      Effect.sync(() => {
        stateRef.current = createReverbState(stateRef.current.profile)
      }),

    generateImpulseResponse,
  }
}

export interface ConvolutionReverbEngine {
  readonly convolve: (input: Float32Array, impulseResponse: Float32Array) => Float32Array
  readonly convolveStreaming: (input: Float32Array, impulseResponse: Float32Array) => Float32Array
  readonly generateRoomImpulseResponse: (profile: AcousticProfile, length: number) => Float32Array
  readonly generateOutdoorImpulseResponse: (profile: AcousticProfile, length: number) => Float32Array
  readonly generateCorridorImpulseResponse: (profile: AcousticProfile, length: number) => Float32Array
}

export function makeConvolutionReverbEngine(): ConvolutionReverbEngine {
  function convolve(input: Float32Array, impulseResponse: Float32Array): Float32Array {
    const inputLen = input.length
    const irLen = impulseResponse.length
    const outputLen = inputLen + irLen - 1
    const output = new Float32Array(outputLen)

    for (let i = 0; i < inputLen; i++) {
      for (let j = 0; j < irLen; j++) {
        output[i + j] += input[i] * impulseResponse[j]
      }
    }

    return output
  }

  function convolveStreaming(input: Float32Array, impulseResponse: Float32Array): Float32Array {
    const inputLen = input.length
    const irLen = impulseResponse.length
    const output = new Float32Array(inputLen)

    const blockSize = Math.min(256, irLen)

    for (let i = 0; i < inputLen; i += blockSize) {
      const blockEnd = Math.min(i + blockSize, inputLen)
      const blockLen = blockEnd - i

      for (let j = 0; j < blockLen; j++) {
        let sum = 0
        for (let k = 0; k < irLen && (i + j - k) >= 0; k++) {
          sum += input[i + j - k] * impulseResponse[k]
        }
        output[i + j] = sum
      }
    }

    return output
  }

  function generateRoomImpulseResponse(profile: AcousticProfile, length: number): Float32Array {
    const ir = new Float32Array(length)
    const reverbTime = profile.reverbTime
    const decayRate = Math.pow(0.001, 1 / (reverbTime * 44100))

    const earlyReflectionTimes = [0.005, 0.011, 0.017, 0.023, 0.029, 0.035]
    for (let i = 0; i < earlyReflectionTimes.length; i++) {
      const sampleIdx = Math.floor(earlyReflectionTimes[i] * 44100)
      if (sampleIdx < length) {
        ir[sampleIdx] = profile.earlyReflections * Math.pow(0.6, i)
      }
    }

    const lateStart = Math.floor(0.08 * 44100)
    for (let i = lateStart; i < length; i++) {
      const envelope = Math.pow(decayRate, i - lateStart)
      const noise = (Math.random() * 2 - 1) * profile.lateReverb
      const diffusion = Math.sin(i * 0.001 * profile.diffusion * Math.PI)
      ir[i] = noise * envelope * (0.5 + 0.5 * diffusion)
    }

    const highCutCoeff = 1 - profile.highCut / 22050
    let prev = 0
    for (let i = 1; i < length; i++) {
      ir[i] = ir[i] * (1 - highCutCoeff) + prev * highCutCoeff
      prev = ir[i]
    }

    return ir
  }

  function generateOutdoorImpulseResponse(profile: AcousticProfile, length: number): Float32Array {
    const ir = new Float32Array(length)

    const earlyReflectionTimes = [0.02, 0.05, 0.1, 0.2]
    for (let i = 0; i < earlyReflectionTimes.length; i++) {
      const sampleIdx = Math.floor(earlyReflectionTimes[i] * 44100)
      if (sampleIdx < length) {
        ir[sampleIdx] = profile.earlyReflections * Math.pow(0.3, i)
      }
    }

    const lateStart = Math.floor(0.15 * 44100)
    for (let i = lateStart; i < length; i++) {
      const envelope = Math.pow(0.999, i - lateStart)
      const noise = (Math.random() * 2 - 1) * profile.lateReverb * 0.3
      ir[i] = noise * envelope
    }

    return ir
  }

  function generateCorridorImpulseResponse(profile: AcousticProfile, length: number): Float32Array {
    const ir = new Float32Array(length)

    const earlyReflectionTimes = [0.008, 0.016, 0.024, 0.032, 0.04]
    for (let i = 0; i < earlyReflectionTimes.length; i++) {
      const sampleIdx = Math.floor(earlyReflectionTimes[i] * 44100)
      if (sampleIdx < length) {
        ir[sampleIdx] = profile.earlyReflections * Math.pow(0.5, i)
      }
    }

    const reverbTime = profile.reverbTime
    const decayRate = Math.pow(0.001, 1 / (reverbTime * 44100))
    const lateStart = Math.floor(0.05 * 44100)
    for (let i = lateStart; i < length; i++) {
      const envelope = Math.pow(decayRate, i - lateStart)
      const noise = (Math.random() * 2 - 1) * profile.lateReverb
      ir[i] = noise * envelope * profile.diffusion
    }

    const slapbackSample = Math.floor(profile.slapbackDelay * 44100)
    if (slapbackSample < length) {
      ir[slapbackSample] = profile.slapbackGain
    }

    return ir
  }

  return {
    convolve,
    convolveStreaming,
    generateRoomImpulseResponse,
    generateOutdoorImpulseResponse,
    generateCorridorImpulseResponse,
  }
}
