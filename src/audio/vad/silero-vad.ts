import { Effect, Context, Layer, Ref, Queue, Stream } from "effect"
import type { AudioChunk } from "../types.js"

export class VAD extends Context.Tag("xzero/audio/VAD")<
  VAD,
  {
    readonly processChunk: (chunk: AudioChunk) => Effect.Effect<VADResult>
    readonly onSpeechStart: Effect.Effect<Stream.Stream<void>>
    readonly onSpeechEnd: Effect.Effect<Stream.Stream<AudioChunk[]>>
    readonly reset: () => Effect.Effect<void>
  }
>() {}

export interface VADResult {
  isSpeech: boolean
  confidence: number
  energy: number
  zeroCrossingRate: number
}

interface VADState {
  isSpeaking: boolean
  speechBuffer: AudioChunk[]
  silenceFrames: number
  totalFrames: number
  speechFrames: number
  lastSpeechChunk: AudioChunk | null
}

export const makeVAD = (threshold: number, silenceDuration: number) =>
  Effect.gen(function* () {
    const stateRef = yield* Ref.make<VADState>({
      isSpeaking: false,
      speechBuffer: [],
      silenceFrames: 0,
      totalFrames: 0,
      speechFrames: 0,
      lastSpeechChunk: null,
    })

    const speechStartQueue = yield* Queue.unbounded<void>()
    const speechEndQueue = yield* Queue.unbounded<AudioChunk[]>()

    const framesPerChunk = 160
    const silenceFrameThreshold = Math.floor(silenceDuration / 20)

    function computeEnergy(data: Float32Array | Int16Array): number {
      let sum = 0
      const len = data.length
      for (let i = 0; i < len; i++) {
        const val = data[i]
        sum += val * val
      }
      return Math.sqrt(sum / len)
    }

    function computeZeroCrossingRate(data: Float32Array | Int16Array): number {
      let crossings = 0
      const len = data.length - 1
      for (let i = 0; i < len; i++) {
        if ((data[i] >= 0 && data[i + 1] < 0) ||
            (data[i] < 0 && data[i + 1] >= 0)) {
          crossings++
        }
      }
      return crossings / len
    }

    function isSpeechFrame(chunk: AudioChunk): boolean {
      const energy = computeEnergy(chunk.data)
      const zcr = computeZeroCrossingRate(chunk.data)

      const energyThreshold = threshold * 0.01
      const zcrThreshold = 0.1

      return energy > energyThreshold && zcr < zcrThreshold
    }

    return {
      processChunk: (chunk: AudioChunk) =>
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef)
          const isSpeech = isSpeechFrame(chunk)

          const newState: VADState = {
            ...state,
            totalFrames: state.totalFrames + 1,
            speechFrames: isSpeech ? state.speechFrames + 1 : state.speechFrames,
          }

          if (isSpeech) {
            newState.speechBuffer = [...state.speechBuffer, chunk]
            newState.silenceFrames = 0
            newState.lastSpeechChunk = chunk
          } else {
            newState.silenceFrames = state.silenceFrames + 1
          }

          if (!state.isSpeaking && isSpeech) {
            newState.isSpeaking = true
            yield* Queue.offer(speechStartQueue, void 0)
          }

          if (state.isSpeaking && newState.silenceFrames >= silenceFrameThreshold) {
            newState.isSpeaking = false
            const speechChunks = [...newState.speechBuffer]
            newState.speechBuffer = []
            yield* Queue.offer(speechEndQueue, speechChunks)
          }

          yield* Ref.set(stateRef, newState)

          const confidence = state.totalFrames > 0
            ? state.speechFrames / state.totalFrames
            : 0

          return {
            isSpeech,
            confidence,
            energy: computeEnergy(chunk.data),
            zeroCrossingRate: computeZeroCrossingRate(chunk.data),
          }
        }),

      onSpeechStart: Effect.succeed(Stream.fromQueue(speechStartQueue)),

      onSpeechEnd: Effect.succeed(Stream.fromQueue(speechEndQueue)),

      reset: () =>
        Ref.set(stateRef, {
          isSpeaking: false,
          speechBuffer: [],
          silenceFrames: 0,
          totalFrames: 0,
          speechFrames: 0,
          lastSpeechChunk: null,
        }),
    }
  })

export const VADLive = (threshold: number, silenceDuration: number) =>
  Layer.effect(VAD, makeVAD(threshold, silenceDuration))
