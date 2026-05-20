import { Effect, Stream, Layer } from "effect"
import {
  AudioPipeline,
  AudioPipelineLive,
} from "./pipeline/orchestrator.js"
import { VoiceManager, VoiceManagerLive } from "./pipeline/voice-manager.js"
import {
  defaultPipelineConfig,
  type PipelineConfig,
  type VoiceProfile,
} from "./types.js"

const config: PipelineConfig = {
  ...defaultPipelineConfig,
  sampleRate: parseInt(process.env.AUDIO_SAMPLE_RATE ?? "16000"),
  chunkDuration: parseInt(process.env.AUDIO_CHUNK_DURATION ?? "20"),
  vadThreshold: parseFloat(process.env.VAD_THRESHOLD ?? "0.5"),
  vadSilenceDuration: parseInt(process.env.VAD_SILENCE_DURATION ?? "500"),
  sttModel: process.env.STT_MODEL ?? "whisper-tiny",
  ttsModel: process.env.TTS_MODEL ?? "kokoro-base",
  maxLatency: parseInt(process.env.MAX_LATENCY ?? "200"),
  enableSpeculativeTTS: process.env.SPECULATIVE_TTS !== "false",
  enableInterrupt: process.env.ENABLE_INTERRUPT !== "false",
  voiceProfile: {
    ...defaultPipelineConfig.voiceProfile,
    id: process.env.VOICE_ID ?? "elder-male",
    pitch: parseFloat(process.env.VOICE_PITCH ?? "1.0"),
    speed: parseFloat(process.env.VOICE_SPEED ?? "1.0"),
  },
}

const main = Effect.gen(function* () {
  const pipeline = yield* AudioPipeline
  const voiceManager = yield* VoiceManager

  console.log("[xzero-audio] Starting audio-to-audio pipeline...")
  console.log(`[xzero-audio] Sample rate: ${config.sampleRate}Hz`)
  console.log(`[xzero-audio] Chunk duration: ${config.chunkDuration}ms`)
  console.log(`[xzero-audio] VAD threshold: ${config.vadThreshold}`)
  console.log(`[xzero-audio] Speculative TTS: ${config.enableSpeculativeTTS}`)
  console.log(`[xzero-audio] Interrupt handling: ${config.enableInterrupt}`)

  yield* pipeline.start()

  const eventStream = yield* pipeline.onEvent
  yield* eventStream.pipe(
    Stream.tap((event: any) =>
      Effect.sync(() => {
        const data = typeof event.data === "string" ? event.data : JSON.stringify(event.data)
        console.log(`[xzero-audio] Event: ${event.type} - ${data}`)
      })
    ),
    Stream.runDrain,
    Effect.forkDaemon
  )

  yield* voiceManager.setVoiceForNPC("guard_001", "guard-male")
  yield* voiceManager.setVoiceForNPC("merchant_001", "merchant-female")

  console.log("[xzero-audio] Pipeline running. Listening for player input...")

  yield* Effect.never
})

const runnable = main.pipe(
  Effect.provide(AudioPipelineLive(config)),
  Effect.provide(VoiceManagerLive),
  Effect.catchAllCause((cause) =>
    Effect.sync(() => {
      console.error("[xzero-audio] Fatal error:", cause)
      process.exit(1)
    })
  )
) as Effect.Effect<void, never, never>

Effect.runFork(runnable)

process.on("SIGINT", () => {
  console.log("\n[xzero-audio] Shutting down audio pipeline...")
  process.exit(0)
})

process.on("SIGTERM", () => {
  console.log("\n[xzero-audio] Shutting down audio pipeline...")
  process.exit(0)
})
