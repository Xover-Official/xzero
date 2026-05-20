import { Effect, Context, Layer, Ref, Queue, Stream, Fiber } from "effect"
import type {
  PipelineConfig,
  PipelineMetrics,
  PipelineState,
  PipelineEvent,
  AudioChunk,
  TranscriptionChunk,
  TTSSegment,
  VoiceProfile,
} from "../types.js"
import { VAD, makeVAD } from "../vad/silero-vad.js"
import { STTEngine, makeSTTEngine } from "../stt/streaming-stt.js"
import { TTSEngine, makeTTSEngine } from "../tts/streaming-tts.js"
import { AudioIO, makeAudioIO } from "../io/audio-io.js"

export class AudioPipeline extends Context.Tag("xzero/audio/Pipeline")<
  AudioPipeline,
  {
    readonly start: () => Effect.Effect<void>
    readonly stop: () => Effect.Effect<void>
    readonly interrupt: () => Effect.Effect<void>
    readonly setState: (state: PipelineState) => Effect.Effect<void>
    readonly getState: () => Effect.Effect<PipelineState>
    readonly getMetrics: () => Effect.Effect<PipelineMetrics>
    readonly setVoice: (profile: VoiceProfile) => Effect.Effect<void>
    readonly onEvent: Effect.Effect<Stream.Stream<PipelineEvent>>
  }
>() {}

interface PipelineInternals {
  state: PipelineState
  metrics: PipelineMetrics
  currentTranscription: string
  currentTTSText: string
  speechStartTime: number
  eventQueue: Queue.Queue<PipelineEvent>
  activeFibers: Fiber.Fiber<unknown, unknown>[]
}

export const makeAudioPipeline = (config: PipelineConfig) =>
  Effect.gen(function* () {
    const vad = yield* VAD
    const stt = yield* STTEngine
    const tts = yield* TTSEngine
    const audioIO = yield* AudioIO

    const internalsRef = yield* Ref.make<PipelineInternals>({
      state: "idle",
      metrics: {
        totalAudioProcessed: 0,
        totalTranscriptions: 0,
        totalSynthesized: 0,
        avgSTTLatency: 0,
        avgTTSLatency: 0,
        avgEndToEndLatency: 0,
        interruptions: 0,
        droppedChunks: 0,
      },
      currentTranscription: "",
      currentTTSText: "",
      speechStartTime: 0,
      eventQueue: yield* Queue.unbounded<PipelineEvent>(),
      activeFibers: [],
    })

    const eventStream = yield* Queue.unbounded<PipelineEvent>()

    function emitEvent(type: PipelineEvent["type"], data: unknown): Effect.Effect<void> {
      return Effect.gen(function* () {
        const event: PipelineEvent = {
          type,
          timestamp: Date.now(),
          data,
        }
        yield* Queue.offer(eventStream, event)
        yield* Queue.offer((internalsRef as any).eventQueue, event)
      })
    }

    function updateMetrics(
      updates: Partial<PipelineMetrics>
    ): Effect.Effect<void> {
      return Ref.update(internalsRef, (internals) => ({
        ...internals,
        metrics: {
          ...internals.metrics,
          ...updates,
        },
      }))
    }

    function setState(state: PipelineState): Effect.Effect<void> {
      return Ref.update(internalsRef, (s) => ({ ...s, state }))
    }

    const pipelineLoop = Effect.gen(function* () {
      yield* emitEvent("listening" as any, { config })

      const captureStream = yield* audioIO.startCapture()

      const vadStream = captureStream.pipe(
        Stream.mapEffect((chunk) =>
          Effect.gen(function* () {
            const vadResult = yield* vad.processChunk(chunk)

            yield* updateMetrics({
              totalAudioProcessed: (yield* Ref.get(internalsRef)).metrics.totalAudioProcessed + 1,
            })

            return { chunk, vadResult }
          })
        )
      )

      const speechStartStream = yield* vad.onSpeechStart
      const speechEndStream = yield* vad.onSpeechEnd

      yield* speechStartStream.pipe(
        Stream.tap(() =>
          Effect.gen(function* () {
            yield* setState("processing")
            yield* emitEvent("speech_start", { timestamp: Date.now() })
            yield* Ref.update(internalsRef, (s) => ({
              ...s,
              speechStartTime: Date.now(),
            }))
          })
        ),
        Stream.runDrain,
        Effect.forkDaemon
      )

      yield* speechEndStream.pipe(
        Stream.tap((speechChunks) =>
          Effect.gen(function* () {
            const speechStart = yield* Ref.get(internalsRef).pipe(
              Effect.map((s) => s.speechStartTime)
            )

            yield* stt.reset()

            for (const chunk of speechChunks) {
              const result = yield* stt.transcribeChunk(chunk)

              if (result.text) {
                yield* emitEvent("transcription_partial", {
                  text: result.text,
                  isFinal: false,
                })

                yield* Ref.update(internalsRef, (s) => ({
                  ...s,
                  currentTranscription: result.text,
                }))

                if (config.enableSpeculativeTTS && result.text.length > 10) {
                  yield* setState("speaking")
                  yield* emitEvent("tts_start", { text: result.text })

                  const segments = yield* tts.synthesize(result.text)

                  for (const segment of segments) {
                    yield* emitEvent("tts_chunk", {
                      text: segment.text,
                      isFinal: segment.isFinal,
                    })

                    yield* audioIO.playSegment(segment).pipe(
                      Effect.tap(() =>
                        emitEvent("audio_playback_start", {
                          text: segment.text,
                        })
                      )
                    )
                  }

                  const endTime = Date.now()
                  const e2eLatency = endTime - speechStart

                  yield* Effect.all([
                    emitEvent("tts_complete", { latency: e2eLatency }),
                    updateMetrics({
                      totalSynthesized: ((internalsRef as any).metrics.totalSynthesized || 0) + 1,
                      totalTranscriptions: ((internalsRef as any).metrics.totalTranscriptions || 0) + 1,
                      avgEndToEndLatency:
                        ((internalsRef as any).metrics.totalSynthesized || 0) === 0
                          ? e2eLatency
                          : (((internalsRef as any).metrics.avgEndToEndLatency || 0) *
                              ((internalsRef as any).metrics.totalSynthesized || 0) +
                              e2eLatency) /
                            (((internalsRef as any).metrics.totalSynthesized || 0) + 1),
                    }),
                    setState("listening"),
                  ])
                }
              }
            }
          })
        ),
        Stream.runDrain,
        Effect.forkDaemon
      )

      yield* Effect.never
    })

    return {
      start: () =>
        Effect.gen(function* () {
          yield* setState("listening")
          yield* tts.preloadVoice(config.voiceProfile)

          const fiber = yield* pipelineLoop.pipe(
            Effect.catchAllCause((cause) =>
              Effect.gen(function* () {
                yield* emitEvent("error", { cause: String(cause) })
                yield* setState("error")
              })
            ),
            Effect.forkDaemon
          )

          yield* Ref.update(internalsRef, (s) => ({
            ...s,
            activeFibers: [...s.activeFibers, fiber],
          }))
        }),

      stop: () =>
        Effect.gen(function* () {
          const internals = yield* Ref.get(internalsRef)
          for (const fiber of internals.activeFibers) {
            yield* Fiber.interrupt(fiber as Fiber.Fiber<void, unknown>)
          }

          yield* audioIO.stopCapture()
          yield* audioIO.stopPlayback()
          yield* setState("idle")
        }),

      interrupt: () =>
        Effect.gen(function* () {
          const internals = yield* Ref.get(internalsRef)
          if (internals.state === "speaking") {
            yield* audioIO.stopPlayback()
            yield* stt.reset()

            yield* updateMetrics({
              interruptions: internals.metrics.interruptions + 1,
            })

            yield* emitEvent("interrupt", {
              previousState: internals.state,
              timestamp: Date.now(),
            })

            yield* setState("listening")
          }
        }),

      setState,

      getState: () =>
        Ref.get(internalsRef).pipe(
          Effect.map((s) => s.state)
        ),

      getMetrics: () =>
        Ref.get(internalsRef).pipe(
          Effect.map((s) => s.metrics)
        ),

      setVoice: (profile: VoiceProfile) =>
        Effect.gen(function* () {
          yield* tts.setVoice(profile)
          yield* tts.preloadVoice(profile)
        }),

      onEvent: Effect.succeed(Stream.fromQueue(eventStream)),
    }
  })

export const AudioPipelineLive = (config: PipelineConfig) =>
  Layer.effect(AudioPipeline, makeAudioPipeline(config)).pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.effect(VAD, Effect.gen(function* () {
          const vad = yield* makeVAD(config.vadThreshold, config.vadSilenceDuration)
          return vad
        })),
        Layer.effect(STTEngine, Effect.gen(function* () {
          const stt = yield* makeSTTEngine(config.sttModel, config.sampleRate)
          return stt
        })),
        Layer.effect(TTSEngine, Effect.gen(function* () {
          const tts = yield* makeTTSEngine(config.ttsModel, config.voiceProfile)
          return tts
        })),
        Layer.effect(AudioIO, makeAudioIO(config.sampleRate, config.channels, config.chunkDuration) as Effect.Effect<AudioIO["Type"], never, never>)
      )
    )
  )
