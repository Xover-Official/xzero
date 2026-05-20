import { Effect, Ref, Layer, Stream, Queue } from "effect"
import type { Vec3 } from "../../renderer/types.js"
import type { TileCategory } from "../../pcg/types.js"
import type { VoiceProfile, AudioChunk, TTSSegment, PipelineConfig } from "../types.js"
import type { AcousticProfile } from "./acoustic-environment.js"
import { getAcousticProfile, DEFAULT_ACOUSTIC_PROFILE, lerpAcousticProfiles } from "./acoustic-environment.js"
import type { SpatialReverbEngine } from "./spatial-reverb.js"
import { makeSpatialReverbEngine, makeConvolutionReverbEngine } from "./spatial-reverb.js"
import type { VoiceConsistencyEngine } from "./voice-seed.js"
import { makeVoiceConsistencyEngine } from "./voice-seed.js"
import type { NPCTriggerEngine, DialogueMixer, NPCState, DialogueTrigger } from "./npc-triggers.js"
import { makeNPCTriggerEngine, makeDialogueMixer } from "./npc-triggers.js"

export interface AcousticOcclusionBridge {
  readonly updatePlayerPosition: (position: Vec3, forward: Vec3) => Effect.Effect<void>
  readonly updateCurrentTile: (category: TileCategory) => Effect.Effect<void>
  readonly updateNearbyTiles: (
    tiles: { category: TileCategory; position: Vec3; distance: number }[]
  ) => Effect.Effect<void>
  readonly getCurrentAcousticProfile: () => Effect.Effect<AcousticProfile>
  readonly processAudioThroughEnvironment: (audio: Float32Array) => Effect.Effect<Float32Array>
  readonly addNPC: (npc: NPCState) => Effect.Effect<void>
  readonly removeNPC: (npcId: string) => Effect.Effect<void>
  readonly tick: (elapsedMs: number) => Effect.Effect<{
    triggers: DialogueTrigger[]
    acousticProfile: AcousticProfile
  }>
  readonly getVoiceForNPC: (npcId: string, chunkX: number, chunkZ: number) => Effect.Effect<VoiceProfile>
  readonly onEnvironmentalChange: Effect.Effect<Stream.Stream<AcousticProfile>>
  readonly onDialogueTrigger: Effect.Effect<Stream.Stream<DialogueTrigger>>
  readonly reset: () => Effect.Effect<void>
}

export interface AcousticBridgeConfig {
  sampleRate: number
  triggerRadius: number
  maxSimultaneousSpeakers: number
  reverbSmoothing: number
  voiceCount: number
}

export const defaultAcousticBridgeConfig: AcousticBridgeConfig = {
  sampleRate: 44100,
  triggerRadius: 10,
  maxSimultaneousSpeakers: 2,
  reverbSmoothing: 0.1,
  voiceCount: 6,
}

export function makeAcousticOcclusionBridge(
  config: Partial<AcousticBridgeConfig> = {},
  baseVoices: VoiceProfile[] = []
): AcousticOcclusionBridge {
  const cfg = { ...defaultAcousticBridgeConfig, ...config }

  const reverbEngine = makeSpatialReverbEngine(cfg.sampleRate)
  const convolutionEngine = makeConvolutionReverbEngine()
  const voiceConsistencyEngine = makeVoiceConsistencyEngine()
  const npcTriggerEngine = makeNPCTriggerEngine(cfg.sampleRate, cfg.triggerRadius, cfg.maxSimultaneousSpeakers)
  const dialogueMixer = makeDialogueMixer(cfg.sampleRate)

  const playerPosRef = { current: { x: 0, y: 0, z: 0 } }
  const playerForwardRef = { current: { x: 0, y: 0, z: -1 } }
  const currentTileRef = { current: "hallway" as TileCategory }
  const currentProfileRef = { current: getAcousticProfile("hallway") }
  const targetProfileRef = { current: getAcousticProfile("hallway") }
  const nearbyTilesRef = { current: [] as { category: TileCategory; position: Vec3; distance: number }[] }

  const envChangeQueue = { current: null as Queue.Queue<AcousticProfile> | null }
  const dialogueTriggerQueue = { current: null as Queue.Queue<DialogueTrigger> | null }

  function getOrCreateEnvQueue(): Effect.Effect<Queue.Queue<AcousticProfile>> {
    return Effect.sync(() => {
      if (!envChangeQueue.current) {
        envChangeQueue.current = Queue.unbounded<AcousticProfile>().pipe(Effect.runSync)
      }
      return envChangeQueue.current!
    })
  }

  function getOrCreateDialogueQueue(): Effect.Effect<Queue.Queue<DialogueTrigger>> {
    return Effect.sync(() => {
      if (!dialogueTriggerQueue.current) {
        dialogueTriggerQueue.current = Queue.unbounded<DialogueTrigger>().pipe(Effect.runSync)
      }
      return dialogueTriggerQueue.current!
    })
  }

  function smoothAcousticTransition(current: AcousticProfile, target: AcousticProfile, smoothing: number): AcousticProfile {
    return lerpAcousticProfiles(current, target, smoothing)
  }

  return {
    updatePlayerPosition: (position, forward) =>
      Effect.sync(() => {
        playerPosRef.current = position
        playerForwardRef.current = forward
      }),

    updateCurrentTile: (category) =>
      Effect.gen(function* () {
        currentTileRef.current = category
        const newProfile = getAcousticProfile(category)
        currentProfileRef.current = newProfile
        targetProfileRef.current = newProfile

        const queue = yield* getOrCreateEnvQueue()
        yield* Queue.offer(queue, newProfile)
      }),

    updateNearbyTiles: (tiles) =>
      Effect.sync(() => {
        nearbyTilesRef.current = tiles

        if (tiles.length > 0) {
          const closest = tiles.reduce((a, b) => a.distance < b.distance ? a : b)
          const closestProfile = getAcousticProfile(closest.category)
          const currentProfile = getAcousticProfile(currentTileRef.current)

          const blendFactor = Math.max(0, 1 - closest.distance / 5)
          targetProfileRef.current = lerpAcousticProfiles(currentProfile, closestProfile, blendFactor)
        }
      }),

    getCurrentAcousticProfile: () =>
      Effect.sync(() => currentProfileRef.current),

    processAudioThroughEnvironment: (audio) =>
      Effect.gen(function* () {
        const profile = currentProfileRef.current

        const reverbProcessed = yield* reverbEngine.processBuffer(audio, 0)

        const distance = 1
        const filtered = yield* dialogueMixer.applyDistanceFilter(reverbProcessed, distance, profile)

        return filtered
      }),

    addNPC: (npc) =>
      npcTriggerEngine.addNPC(npc),

    removeNPC: (npcId) =>
      npcTriggerEngine.removeNPC(npcId),

    tick: (elapsedMs) =>
      Effect.gen(function* () {
        currentProfileRef.current = smoothAcousticTransition(
          currentProfileRef.current,
          targetProfileRef.current,
          cfg.reverbSmoothing
        )

        yield* reverbEngine.setProfile(currentProfileRef.current)

        yield* npcTriggerEngine.updatePlayerPosition(playerPosRef.current)

        const triggers = yield* npcTriggerEngine.tick(elapsedMs)

        if (triggers.length > 0) {
          const queue = yield* getOrCreateDialogueQueue()
          for (const trigger of triggers) {
            yield* Queue.offer(queue, trigger)
          }
        }

        return {
          triggers,
          acousticProfile: currentProfileRef.current,
        }
      }),

    getVoiceForNPC: (npcId, chunkX, chunkZ) =>
      voiceConsistencyEngine.assignVoiceToNPC(npcId, chunkX, chunkZ, baseVoices),

    onEnvironmentalChange: Effect.gen(function* () {
      const queue = yield* getOrCreateEnvQueue()
      return Stream.fromQueue(queue)
    }),

    onDialogueTrigger: Effect.gen(function* () {
      const queue = yield* getOrCreateDialogueQueue()
      return Stream.fromQueue(queue)
    }),

    reset: () =>
      Effect.gen(function* () {
        currentTileRef.current = "hallway"
        currentProfileRef.current = getAcousticProfile("hallway")
        targetProfileRef.current = getAcousticProfile("hallway")
        nearbyTilesRef.current = []

        yield* reverbEngine.reset()
        yield* reverbEngine.setProfile(currentProfileRef.current)
      }),
  }
}

export const AcousticBridgeLive = (
  config?: Partial<AcousticBridgeConfig>,
  baseVoices?: VoiceProfile[]
) =>
  Layer.succeed(
    AcousticOcclusionBridgeTag,
    makeAcousticOcclusionBridge(config ?? {}, baseVoices ?? [])
  )

export class AcousticOcclusionBridgeTag extends Effect.Tag("xzero/audio/AcousticBridge")<
  AcousticOcclusionBridgeTag,
  AcousticOcclusionBridge
>() {}

export interface AcousticEvent {
  type: "tile_change" | "reverb_update" | "npc_dialogue" | "ambient_shift" | "occlusion_change"
  timestamp: number
  data: {
    tileCategory?: TileCategory
    acousticProfile?: AcousticProfile
    npcId?: string
    dialogue?: string
    distance?: number
    occlusionFactor?: number
  }
}

export function createTileChangeAcousticEvent(category: TileCategory): AcousticEvent {
  return {
    type: "tile_change",
    timestamp: Date.now(),
    data: {
      tileCategory: category,
      acousticProfile: getAcousticProfile(category),
    },
  }
}

export function createNPCDialogueAcousticEvent(
  npcId: string,
  dialogue: string,
  distance: number,
  occlusionFactor: number
): AcousticEvent {
  return {
    type: "npc_dialogue",
    timestamp: Date.now(),
    data: {
      npcId,
      dialogue,
      distance,
      occlusionFactor,
    },
  }
}

export function createAmbientShiftAcousticEvent(profile: AcousticProfile): AcousticEvent {
  return {
    type: "ambient_shift",
    timestamp: Date.now(),
    data: {
      acousticProfile: profile,
    },
  }
}
