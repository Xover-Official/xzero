import { Effect, Ref } from "effect"
import type { VoiceProfile } from "../types.js"

export interface VoiceSeed {
  npcId: string
  seedValue: number
  voiceProfile: VoiceProfile
  chunkCoord: { x: number; z: number }
  isPersistent: boolean
}

export interface VoiceSeedDatabase {
  readonly getVoiceSeed: (npcId: string) => Effect.Effect<VoiceSeed | null>
  readonly getOrCreateVoiceSeed: (
    npcId: string,
    chunkX: number,
    chunkZ: number,
    baseVoices: VoiceProfile[]
  ) => Effect.Effect<VoiceSeed>
  readonly removeVoiceSeed: (npcId: string) => Effect.Effect<void>
  readonly getAllSeeds: () => Effect.Effect<VoiceSeed[]>
  readonly getSeedValue: (npcId: string, chunkX: number, chunkZ: number) => Effect.Effect<number>
}

export function makeVoiceSeedDatabase(): VoiceSeedDatabase {
  const seedsRef = { current: new Map<string, VoiceSeed>() }

  function hashToVoiceIndex(seed: number, voiceCount: number): number {
    let h = seed
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
    h = Math.imul(h ^ (h >>> 13), 0x45d9f3b)
    return Math.abs(h) % voiceCount
  }

  function computeVoiceSeed(npcId: string, chunkX: number, chunkZ: number): number {
    let h = 0
    for (let i = 0; i < npcId.length; i++) {
      h = Math.imul(h ^ npcId.charCodeAt(i), 0x5bd1e995)
    }
    h = Math.imul(h ^ chunkX, 0x5bd1e995)
    h = Math.imul(h ^ chunkZ, 0x5bd1e995)
    h = h ^ (h >>> 13)
    h = Math.imul(h, 0x5bd1e995)
    h = h ^ (h >>> 15)
    return Math.abs(h)
  }

  return {
    getVoiceSeed: (npcId) =>
      Effect.sync(() => seedsRef.current.get(npcId) ?? null),

    getOrCreateVoiceSeed: (npcId, chunkX, chunkZ, baseVoices) =>
      Effect.sync(() => {
        const existing = seedsRef.current.get(npcId)
        if (existing) return existing

        const seedValue = computeVoiceSeed(npcId, chunkX, chunkZ)
        const voiceIndex = hashToVoiceIndex(seedValue, baseVoices.length)
        const baseVoice = baseVoices[voiceIndex]

        const seed: VoiceSeed = {
          npcId,
          seedValue,
          voiceProfile: {
            ...baseVoice,
            id: `${npcId}_voice`,
            name: `${baseVoice.name} (${npcId})`,
            speakerId: `seed_${seedValue}`,
          },
          chunkCoord: { x: chunkX, z: chunkZ },
          isPersistent: true,
        }

        seedsRef.current.set(npcId, seed)
        return seed
      }),

    removeVoiceSeed: (npcId) =>
      Effect.sync(() => {
        seedsRef.current.delete(npcId)
      }),

    getAllSeeds: () =>
      Effect.sync(() => [...seedsRef.current.values()]),

    getSeedValue: (npcId, chunkX, chunkZ) =>
      Effect.sync(() => computeVoiceSeed(npcId, chunkX, chunkZ) as unknown as number),
  }
}

export interface VoiceConsistencyEngine {
  readonly assignVoiceToNPC: (
    npcId: string,
    chunkX: number,
    chunkZ: number,
    baseVoices: VoiceProfile[]
  ) => Effect.Effect<VoiceProfile>
  readonly getNPCVoice: (npcId: string) => Effect.Effect<VoiceProfile | null>
  readonly verifyVoiceConsistency: (
    npcId: string,
    chunkX: number,
    chunkZ: number,
    baseVoices: VoiceProfile[]
  ) => Effect.Effect<boolean>
  readonly migrateVoiceToChunk: (
    npcId: string,
    fromChunkX: number,
    fromChunkZ: number,
    toChunkX: number,
    toChunkZ: number,
    baseVoices: VoiceProfile[]
  ) => Effect.Effect<VoiceProfile>
}

export function makeVoiceConsistencyEngine(): VoiceConsistencyEngine {
  const database = makeVoiceSeedDatabase()
  const assignedVoicesRef = { current: new Map<string, VoiceProfile>() }

  return {
    assignVoiceToNPC: (npcId, chunkX, chunkZ, baseVoices) =>
      Effect.gen(function* () {
        const seed = yield* database.getOrCreateVoiceSeed(npcId, chunkX, chunkZ, baseVoices)

        assignedVoicesRef.current.set(npcId, seed.voiceProfile)
        return seed.voiceProfile
      }),

    getNPCVoice: (npcId) =>
      Effect.sync(() => assignedVoicesRef.current.get(npcId) ?? null),

    verifyVoiceConsistency: (npcId, chunkX, chunkZ, baseVoices) =>
      Effect.gen(function* () {
        const currentVoice = assignedVoicesRef.current.get(npcId)
        if (!currentVoice) return false

        const seed = yield* database.getOrCreateVoiceSeed(npcId, chunkX, chunkZ, baseVoices)
        return seed.voiceProfile.speakerId === currentVoice.speakerId
      }),

    migrateVoiceToChunk: (npcId, fromChunkX, fromChunkZ, toChunkX, toChunkZ, baseVoices) =>
      Effect.gen(function* () {
        const existingSeed = yield* database.getVoiceSeed(npcId)

        if (existingSeed && existingSeed.isPersistent) {
          return existingSeed.voiceProfile
        }

        return yield* database.getOrCreateVoiceSeed(npcId, toChunkX, toChunkZ, baseVoices).pipe(
          Effect.map((seed) => {
            assignedVoicesRef.current.set(npcId, seed.voiceProfile)
            return seed.voiceProfile
          })
        )
      }),
  }
}

export function generateVoiceSeedFromPosition(x: number, z: number, npcType: string): number {
  let h = 0
  for (let i = 0; i < npcType.length; i++) {
    h = Math.imul(h ^ npcType.charCodeAt(i), 0x5bd1e995)
  }
  h = Math.imul(h ^ Math.floor(x), 0x5bd1e995)
  h = Math.imul(h ^ Math.floor(z), 0x5bd1e995)
  h = h ^ (h >>> 13)
  h = Math.imul(h, 0x5bd1e995)
  h = h ^ (h >>> 15)
  return Math.abs(h)
}

export function selectVoiceFromSeed(seed: number, voices: VoiceProfile[]): VoiceProfile {
  let h = seed
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  h = Math.imul(h ^ (h >>> 13), 0x45d9f3b)
  const index = Math.abs(h) % voices.length
  return voices[index]
}
