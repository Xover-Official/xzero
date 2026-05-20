import { Effect, Context, Layer, Ref, Stream } from "effect"
import type { VoiceProfile } from "../types.js"

export class VoiceManager extends Context.Tag("xzero/audio/VoiceManager")<
  VoiceManager,
  {
    readonly registerVoice: (profile: VoiceProfile) => Effect.Effect<void>
    readonly getVoice: (id: string) => Effect.Effect<VoiceProfile | null>
    readonly getAllVoices: () => Effect.Effect<VoiceProfile[]>
    readonly setVoiceForNPC: (npcId: string, voiceId: string) => Effect.Effect<void>
    readonly getVoiceForNPC: (npcId: string) => Effect.Effect<VoiceProfile | null>
    readonly cloneVoice: (sourceId: string, newId: string, overrides: Partial<VoiceProfile>) => Effect.Effect<VoiceProfile>
    readonly randomVoice: () => Effect.Effect<VoiceProfile>
  }
>() {}

const defaultVoices: VoiceProfile[] = [
  {
    id: "elder-male",
    name: "Elder Male",
    speakerId: "speaker_0",
    pitch: 0.8,
    speed: 0.9,
    emotion: "wise",
    language: "en",
    sampleRate: 24000,
  },
  {
    id: "young-female",
    name: "Young Female",
    speakerId: "speaker_1",
    pitch: 1.2,
    speed: 1.1,
    emotion: "cheerful",
    language: "en",
    sampleRate: 24000,
  },
  {
    id: "guard-male",
    name: "Guard Male",
    speakerId: "speaker_2",
    pitch: 0.7,
    speed: 1.0,
    emotion: "stern",
    language: "en",
    sampleRate: 24000,
  },
  {
    id: "merchant-female",
    name: "Merchant Female",
    speakerId: "speaker_3",
    pitch: 1.1,
    speed: 1.2,
    emotion: "friendly",
    language: "en",
    sampleRate: 24000,
  },
  {
    id: "mysterious",
    name: "Mysterious",
    speakerId: "speaker_4",
    pitch: 0.9,
    speed: 0.8,
    emotion: "whisper",
    language: "en",
    sampleRate: 24000,
  },
  {
    id: "child",
    name: "Child",
    speakerId: "speaker_5",
    pitch: 1.5,
    speed: 1.3,
    emotion: "excited",
    language: "en",
    sampleRate: 24000,
  },
]

export const makeVoiceManager = Effect.gen(function* () {
  const voicesRef = yield* Ref.make<Map<string, VoiceProfile>>(
    new Map(defaultVoices.map((v) => [v.id, v]))
  )
  const npcMappingRef = yield* Ref.make<Map<string, string>>(new Map())

  return {
    registerVoice: (profile: VoiceProfile) =>
      Effect.gen(function* () {
        const voices = yield* Ref.get(voicesRef)
        const updated = new Map(voices)
        updated.set(profile.id, profile)
        yield* Ref.set(voicesRef, updated)
      }),

    getVoice: (id: string) =>
      Effect.gen(function* () {
        const voices = yield* Ref.get(voicesRef)
        return voices.get(id) ?? null
      }),

    getAllVoices: () =>
      Effect.gen(function* () {
        const voices = yield* Ref.get(voicesRef)
        return Array.from(voices.values())
      }),

    setVoiceForNPC: (npcId: string, voiceId: string) =>
      Effect.gen(function* () {
        const voices = yield* Ref.get(voicesRef)
        if (!voices.has(voiceId)) {
          return yield* Effect.fail(new Error(`Voice ${voiceId} not found`))
        }

        const mapping = yield* Ref.get(npcMappingRef)
        const updated = new Map(mapping)
        updated.set(npcId, voiceId)
        yield* Ref.set(npcMappingRef, updated)
      }) as Effect.Effect<void, never, never>,

    getVoiceForNPC: (npcId: string) =>
      Effect.gen(function* () {
        const mapping = yield* Ref.get(npcMappingRef)
        const voiceId = mapping.get(npcId)

        if (!voiceId) return null

        const voices = yield* Ref.get(voicesRef)
        return voices.get(voiceId) ?? null
      }),

    cloneVoice: (sourceId: string, newId: string, overrides: Partial<VoiceProfile>) =>
      Effect.gen(function* () {
        const voices = yield* Ref.get(voicesRef)
        const source = voices.get(sourceId)

        if (!source) {
          return yield* Effect.fail(new Error(`Source voice ${sourceId} not found`))
        }

        const cloned: VoiceProfile = {
          ...source,
          ...overrides,
          id: newId,
        }

        const updated = new Map(voices)
        updated.set(newId, cloned)
        yield* Ref.set(voicesRef, updated)

        return cloned
      }),

    randomVoice: () =>
      Effect.gen(function* () {
        const voices = yield* Ref.get(voicesRef)
        const arr = Array.from(voices.values())
        return arr[Math.floor(Math.random() * arr.length)]
      }),
  }
})

export const VoiceManagerLive = Layer.effect(VoiceManager, makeVoiceManager as Effect.Effect<VoiceManager["Type"], never, never>)
