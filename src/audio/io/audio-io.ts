import { Effect, Context, Layer, Queue, Stream, Ref, Schedule, Fiber } from "effect"
import type { AudioChunk, TTSSegment } from "../types.js"

export class AudioIO extends Context.Tag("xzero/audio/IO")<
  AudioIO,
  {
    readonly startCapture: () => Effect.Effect<Stream.Stream<AudioChunk>>
    readonly stopCapture: () => Effect.Effect<void>
    readonly playSegment: (segment: TTSSegment) => Effect.Effect<void>
    readonly playStream: (segments: Stream.Stream<TTSSegment>) => Effect.Effect<void>
    readonly stopPlayback: () => Effect.Effect<void>
    readonly isCapturing: () => Effect.Effect<boolean>
    readonly isPlaying: () => Effect.Effect<boolean>
    readonly getLatency: () => Effect.Effect<number>
  }
>() {}

interface IOState {
  isCapturing: boolean
  isPlaying: boolean
  captureSequenceId: number
  playbackQueue: TTSSegment[]
  lastCaptureTime: number
  lastPlaybackTime: number
}

export const makeAudioIO = (sampleRate: number, channels: number, chunkDuration: number) =>
  Effect.gen(function* () {
    const stateRef = yield* Ref.make<IOState>({
      isCapturing: false,
      isPlaying: false,
      captureSequenceId: 0,
      playbackQueue: [],
      lastCaptureTime: 0,
      lastPlaybackTime: 0,
    })

    const captureQueue = yield* Queue.unbounded<AudioChunk>()
    const playbackFiberRef = yield* Ref.make<any>(null)

    const samplesPerChunk = Math.floor((sampleRate * chunkDuration) / 1000)

    function generateSilence(samples: number): Float32Array {
      return new Float32Array(samples)
    }

    function simulateAudioCapture(): Float32Array {
      const samples = samplesPerChunk
      const data = new Float32Array(samples)

      for (let i = 0; i < samples; i++) {
        const t = i / sampleRate
        const ambientNoise = (Math.random() * 2 - 1) * 0.001
        const hum = Math.sin(2 * Math.PI * 60 * t) * 0.0005
        data[i] = ambientNoise + hum
      }

      return data
    }

    return {
      startCapture: () =>
        Effect.gen(function* () {
          yield* Ref.update(stateRef, (s) => ({
            ...s,
            isCapturing: true,
          }))

          const captureStream = Stream.fromSchedule(Schedule.spaced(chunkDuration)).pipe(
            Stream.mapEffect(() =>
              Effect.gen(function* () {
                const state = yield* Ref.get(stateRef)
                if (!state.isCapturing) {
                  return yield* Effect.fail(new Error("Capture stopped"))
                }

                const data = simulateAudioCapture()
                const chunk: AudioChunk = {
                  data,
                  sampleRate,
                  channels,
                  format: "pcm32f",
                  timestamp: Date.now(),
                  sequenceId: state.captureSequenceId,
                  isFinal: false,
                }

                yield* Ref.update(stateRef, (s) => ({
                  ...s,
                  captureSequenceId: s.captureSequenceId + 1,
                  lastCaptureTime: Date.now(),
                }))

                return chunk
              })
            )
          )

          return captureStream
        }),

      stopCapture: () =>
        Ref.update(stateRef, (s) => ({
          ...s,
          isCapturing: false,
        })),

      playSegment: (segment: TTSSegment) =>
        Effect.gen(function* () {
          const duration = segment.audio.length / segment.sampleRate
          const durationMs = Math.floor(duration * 1000)

          yield* Ref.update(stateRef, (s) => ({
            ...s,
            isPlaying: true,
            lastPlaybackTime: Date.now(),
          }))

          yield* Effect.sleep(durationMs)

          yield* Ref.update(stateRef, (s) => ({
            ...s,
            isPlaying: false,
          }))
        }),

      playStream: (segments: Stream.Stream<TTSSegment>) =>
        Effect.gen(function* () {
          yield* Ref.update(stateRef, (s) => ({
            ...s,
            isPlaying: true,
          }))

          const fiber = yield* segments.pipe(
            Stream.mapEffect((segment) =>
              Effect.gen(function* () {
                const duration = segment.audio.length / segment.sampleRate
                const durationMs = Math.floor(duration * 1000)

                yield* Effect.sleep(durationMs)

                yield* Ref.update(stateRef, (s) => ({
                  ...s,
                  lastPlaybackTime: Date.now(),
                }))

                if (segment.isFinal) {
                  yield* Ref.update(stateRef, (s) => ({
                    ...s,
                    isPlaying: false,
                  }))
                }
              })
            ),
            Stream.runDrain,
            Effect.forkDaemon
          )

          yield* Ref.set(playbackFiberRef, fiber)
        }),

      stopPlayback: () =>
        Effect.gen(function* () {
          const fiber = yield* Ref.get(playbackFiberRef)
          if (fiber) {
            yield* (Fiber as any).interrupt(fiber)
          }

          yield* Ref.update(stateRef, (s) => ({
            ...s,
            isPlaying: false,
            playbackQueue: [],
          }))
        }),

      isCapturing: () =>
        Ref.get(stateRef).pipe(
          Effect.map((s) => s.isCapturing)
        ),

      isPlaying: () =>
        Ref.get(stateRef).pipe(
          Effect.map((s) => s.isPlaying)
        ),

      getLatency: () =>
        Ref.get(stateRef).pipe(
          Effect.map((s) => {
            if (s.lastCaptureTime === 0 || s.lastPlaybackTime === 0) return 0
            return s.lastPlaybackTime - s.lastCaptureTime
          })
        ),
    }
  })

export const AudioIOLive = (sampleRate: number, channels: number, chunkDuration: number) =>
  Layer.effect(AudioIO, makeAudioIO(sampleRate, channels, chunkDuration) as Effect.Effect<AudioIO["Type"], never, never>)
