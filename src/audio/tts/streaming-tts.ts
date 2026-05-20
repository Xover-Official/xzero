import { Effect, Context, Layer, Ref, Queue, Stream } from "effect"
import type { TTSSegment, VoiceProfile } from "../types.js"

export class TTSEngine extends Context.Tag("xzero/audio/TTS")<
  TTSEngine,
  {
    readonly synthesize: (text: string) => Effect.Effect<TTSSegment[]>
    readonly synthesizeStream: (
      textStream: Stream.Stream<string>
    ) => Effect.Effect<Stream.Stream<TTSSegment>>
    readonly preloadVoice: (profile: VoiceProfile) => Effect.Effect<void>
    readonly setVoice: (profile: VoiceProfile) => Effect.Effect<void>
    readonly getCurrentVoice: () => Effect.Effect<VoiceProfile>
  }
>() {}

interface TTSState {
  currentVoice: VoiceProfile
  isProcessing: boolean
}

export const makeTTSEngine = (model: string, defaultVoice: VoiceProfile) =>
  Effect.gen(function* () {
    const stateRef = yield* Ref.make<TTSState>({
      currentVoice: defaultVoice,
      isProcessing: false,
    })

    function generateAudioFromText(
      text: string,
      voice: VoiceProfile,
      sequenceId: number
    ): Float32Array {
      const words = text.split(/\s+/).filter(Boolean)
      const durationPerWord = 0.3 / voice.speed
      const totalDuration = words.length * durationPerWord

      const sampleRate = voice.sampleRate
      const totalSamples = Math.floor(totalDuration * sampleRate)
      const audio = new Float32Array(totalSamples)

      let sampleIdx = 0
      for (const word of words) {
        const wordSamples = Math.floor(durationPerWord * sampleRate)
        const baseFreq = 150 * voice.pitch + (word.length * 5)

        for (let i = 0; i < wordSamples && sampleIdx < totalSamples; i++) {
          const t = i / sampleRate
          const envelope = Math.sin((Math.PI * i) / wordSamples)

          const fundamental = Math.sin(2 * Math.PI * baseFreq * t)
          const harmonic1 = 0.5 * Math.sin(2 * Math.PI * baseFreq * 2 * t)
          const harmonic2 = 0.25 * Math.sin(2 * Math.PI * baseFreq * 3 * t)

          const pitchMod = 1 + 0.02 * Math.sin(2 * Math.PI * 5 * t)
          const voiced = fundamental * pitchMod + harmonic1 + harmonic2

          const noise = (Math.random() * 2 - 1) * 0.02
          const isConsonant = "ptksfth".includes(word[0]?.toLowerCase() ?? "")
          const consonantNoise = isConsonant ? noise * 3 : noise

          audio[sampleIdx] = (voiced * 0.3 + consonantNoise) * envelope * 0.5
          sampleIdx++
        }

        if (sampleIdx < totalSamples) {
          const pauseSamples = Math.floor(0.05 * sampleRate)
          sampleIdx = Math.min(sampleIdx + pauseSamples, totalSamples)
        }
      }

      return audio
    }

    function splitIntoSegments(
      text: string,
      voice: VoiceProfile
    ): string[] {
      const sentences = text.split(/(?<=[.!?])\s+/)
      const segments: string[] = []
      let currentSegment = ""

      for (const sentence of sentences) {
        if ((currentSegment + sentence).length > 150 && currentSegment) {
          segments.push(currentSegment.trim())
          currentSegment = sentence
        } else {
          currentSegment += (currentSegment ? " " : "") + sentence
        }
      }

      if (currentSegment.trim()) {
        segments.push(currentSegment.trim())
      }

      return segments.length > 0 ? segments : [text]
    }

    return {
      synthesize: (text: string) =>
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef)
          const segmentTexts = splitIntoSegments(text, state.currentVoice)

          const segments: TTSSegment[] = segmentTexts.map((segmentText, i) => {
            const audio = generateAudioFromText(
              segmentText,
              state.currentVoice,
              i
            )

            return {
              audio,
              sampleRate: state.currentVoice.sampleRate,
              text: segmentText,
              timestamp: Date.now(),
              sequenceId: i,
              isFinal: i === segmentTexts.length - 1,
            }
          })

          return segments
        }),

      synthesizeStream: (textStream: Stream.Stream<string>) =>
        Effect.succeed(
          textStream.pipe(
            Stream.mapEffect((text) =>
              Effect.gen(function* () {
                const state = yield* Ref.get(stateRef)
                const audio = generateAudioFromText(
                  text,
                  state.currentVoice,
                  Date.now()
                )

                return {
                  audio,
                  sampleRate: state.currentVoice.sampleRate,
                  text,
                  timestamp: Date.now(),
                  sequenceId: Date.now(),
                  isFinal: true,
                }
              })
            )
          )
        ),

      preloadVoice: (profile: VoiceProfile) =>
        Effect.sync(() => {
          generateAudioFromText("a", profile, 0)
        }),

      setVoice: (profile: VoiceProfile) =>
        Ref.update(stateRef, (s) => ({
          ...s,
          currentVoice: profile,
        })),

      getCurrentVoice: () =>
        Ref.get(stateRef).pipe(
          Effect.map((s) => s.currentVoice)
        ),
    }
  })

export const TTSEngineLive = (model: string, defaultVoice: VoiceProfile) =>
  Layer.effect(TTSEngine, makeTTSEngine(model, defaultVoice))
