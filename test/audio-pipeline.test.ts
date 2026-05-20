import { Effect, Layer, Ref, Stream, Fiber, Queue } from "effect"
import { VAD, makeVAD } from "../src/audio/vad/silero-vad.js"
import { STTEngine, makeSTTEngine } from "../src/audio/stt/streaming-stt.js"
import { TTSEngine, makeTTSEngine } from "../src/audio/tts/streaming-tts.js"
import { AudioIO, makeAudioIO } from "../src/audio/io/audio-io.js"
import { VoiceManager, VoiceManagerLive } from "../src/audio/pipeline/voice-manager.js"
import type { AudioChunk, VoiceProfile } from "../src/audio/types.js"

console.log("=== XZero Audio Pipeline Test Suite ===\n")

async function test(name: string, fn: () => Promise<boolean>) {
  try {
    const result = await fn()
    if (result) {
      console.log(`  PASS: ${name}`)
    } else {
      console.log(`  FAIL: ${name}`)
      process.exitCode = 1
    }
  } catch (err) {
    console.log(`  FAIL: ${name} - ${err}`)
    process.exitCode = 1
  }
}

function createTestChunk(data: Float32Array, isFinal = false): AudioChunk {
  return {
    data,
    sampleRate: 16000,
    channels: 1,
    format: "pcm32f",
    timestamp: Date.now(),
    sequenceId: Date.now(),
    isFinal,
  }
}

async function runTests() {
  console.log("1. VAD Tests")

  await test("detects silence", async () => {
    const result = await Effect.gen(function* () {
      const vad = yield* VAD
      const silence = new Float32Array(320)
      const chunk = createTestChunk(silence)

      const result = yield* vad.processChunk(chunk)
      return !result.isSpeech
    }).pipe(
      Effect.provide(Layer.effect(VAD, makeVAD(0.5, 500))),
      Effect.runPromise
    )

    return result
  })

  await test("detects speech", async () => {
    const result = await Effect.gen(function* () {
      const vad = yield* VAD

      const speechData = new Float32Array(320)
      for (let i = 0; i < 320; i++) {
        speechData[i] = Math.sin(2 * Math.PI * 440 * (i / 16000)) * 0.5
      }

      const chunk = createTestChunk(speechData)
      const result = yield* vad.processChunk(chunk)
      return result.isSpeech
    }).pipe(
      Effect.provide(Layer.effect(VAD, makeVAD(0.3, 500))),
      Effect.runPromise
    )

    return result
  })

  console.log("\n2. STT Tests")

  await test("transcribes audio chunks", async () => {
    const result = await Effect.gen(function* () {
      const stt = yield* STTEngine

      const speechData = new Float32Array(8000)
      for (let i = 0; i < 8000; i++) {
        speechData[i] = Math.sin(2 * Math.PI * 440 * (i / 16000)) * 0.3
      }

      const chunk = createTestChunk(speechData)
      const result = yield* stt.transcribeChunk(chunk)

      return result.text.length > 0
    }).pipe(
      Effect.provide(Layer.effect(STTEngine, makeSTTEngine("whisper-tiny", 16000))),
      Effect.runPromise
    )

    return result
  })

  await test("resets transcription buffer", async () => {
    const result = await Effect.gen(function* () {
      const stt = yield* STTEngine

      yield* stt.reset()
      const partial = yield* stt.getPartialTranscription()

      return partial === ""
    }).pipe(
      Effect.provide(Layer.effect(STTEngine, makeSTTEngine("whisper-tiny", 16000))),
      Effect.runPromise
    )

    return result
  })

  console.log("\n3. TTS Tests")

  await test("synthesizes text to audio", async () => {
    const result = await Effect.gen(function* () {
      const tts = yield* TTSEngine

      const voice: VoiceProfile = {
        id: "test",
        name: "Test",
        speakerId: "speaker_0",
        pitch: 1.0,
        speed: 1.0,
        emotion: "neutral",
        language: "en",
        sampleRate: 24000,
      }

      yield* tts.setVoice(voice)
      const segments = yield* tts.synthesize("Hello world")

      return segments.length > 0 && segments[0].audio.length > 0
    }).pipe(
      Effect.provide(Layer.effect(TTSEngine, makeTTSEngine("kokoro-base", {
        id: "default",
        name: "Default",
        speakerId: "speaker_0",
        pitch: 1.0,
        speed: 1.0,
        emotion: "neutral",
        language: "en",
        sampleRate: 24000,
      }))),
      Effect.runPromise
    )

    return result
  })

  console.log("\n4. Voice Manager Tests")

  await test("registers and retrieves voices", async () => {
    const result = await Effect.gen(function* () {
      const vm = yield* VoiceManager

      const voice = yield* vm.getVoice("elder-male")
      return voice !== null && voice.name === "Elder Male"
    }).pipe(
      Effect.provide(VoiceManagerLive),
      Effect.runPromise
    )

    return result
  })

  await test("maps voices to NPCs", async () => {
    const result = await Effect.gen(function* () {
      const vm = yield* VoiceManager

      yield* vm.setVoiceForNPC("guard_001", "guard-male")
      const voice = yield* vm.getVoiceForNPC("guard_001")

      return voice !== null && voice.id === "guard-male"
    }).pipe(
      Effect.provide(VoiceManagerLive),
      Effect.runPromise
    )

    return result
  })

  await test("clones voices with overrides", async () => {
    const result = await Effect.gen(function* () {
      const vm = yield* VoiceManager

      const cloned = yield* vm.cloneVoice("elder-male", "elder-male-deep", {
        pitch: 0.6,
        speed: 0.8,
      })

      return cloned.pitch === 0.6 && cloned.speed === 0.8
    }).pipe(
      Effect.provide(VoiceManagerLive),
      Effect.runPromise
    )

    return result
  })

  await test("returns random voice", async () => {
    const result = await Effect.gen(function* () {
      const vm = yield* VoiceManager
      const voice = yield* vm.randomVoice()
      return voice !== null && voice.id !== undefined
    }).pipe(
      Effect.provide(VoiceManagerLive),
      Effect.runPromise
    )

    return result
  })

  console.log("\n5. Audio I/O Tests")

  await test("starts and stops capture", async () => {
    const result = await Effect.gen(function* () {
      const io = yield* AudioIO

      yield* io.startCapture()
      const capturing = yield* io.isCapturing()

      yield* io.stopCapture()
      const stopped = yield* io.isCapturing()

      return capturing && !stopped
    }).pipe(
      Effect.provide(Layer.effect(AudioIO, makeAudioIO(16000, 1, 20))),
      Effect.runPromise
    )

    return result
  })

  await test("plays audio segments", async () => {
    const result = await Effect.gen(function* () {
      const io = yield* AudioIO

      const audio = new Float32Array(24000)
      for (let i = 0; i < 24000; i++) {
        audio[i] = Math.sin(2 * Math.PI * 440 * (i / 24000)) * 0.3
      }

      const segment = {
        audio,
        sampleRate: 24000,
        text: "test",
        timestamp: Date.now(),
        sequenceId: 0,
        isFinal: true,
      }

      yield* io.playSegment(segment)
      const playing = yield* io.isPlaying()

      return !playing
    }).pipe(
      Effect.provide(Layer.effect(AudioIO, makeAudioIO(16000, 1, 20))),
      Effect.runPromise
    )

    return result
  })

  console.log("\n=== All audio pipeline tests completed ===")
}

runTests().catch(console.error)
