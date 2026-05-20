import { Effect, Ref, Schedule, Stream, PubSub } from "effect"
import { makeEmotionalDisplayEngine, type EmotionalDisplayEngine, type EmotionalVisualState } from "./emotional-display.js"
import { makeDiscoveryLoopSystem, type DiscoveryLoopSystem, type DiscoveryEvent, type NPCInteraction } from "./discovery-loop.js"
import { makeRareTileEngine, type RareTileEngine, type RareTileInstance } from "./rare-tiles.js"
import { makeStressRhythmSystem, type StressRhythmSystem, type StressRhythmEvent, type PlayerStressState } from "./stress-rhythm.js"
import { makeNPCMemorySystem, type NPCMemorySystem, type GreetingVariant } from "./npc-memory.js"
import { makeSchoolIDSystem, type SchoolIDSystem, type SchoolID } from "./school-id.js"
import type { StudentProfile, PsychologicalState, StudentMood } from "../pcg/psychological-node.js"
import type { Tile } from "../pcg/types.js"

export interface GameWorldState {
  playerPosition: { x: number; y: number; z: number }
  currentChunkX: number
  currentChunkZ: number
  npcs: Map<string, StudentProfile>
  npcStates: Map<string, PsychologicalState>
  chunkTiles: Map<string, Map<string, Tile>>
  gameTime: { hour: number; dayIndex: number }
  playerStress: PlayerStressState
  visibleNPCs: EmotionalVisualState[]
  pendingEvents: DiscoveryEvent[]
  rareTilesInChunk: RareTileInstance[]
}

export interface GameEngine {
  readonly initialize: (seed: number, schoolName?: string) => Effect.Effect<void>
  readonly updatePlayerPosition: (x: number, y: number, z: number) => Effect.Effect<GameUpdateResult>
  readonly helpNPC: (npcId: string) => Effect.Effect<NPCInteraction | null>
  readonly interactWithNPC: (npcId: string) => Effect.Effect<string>
  readonly discoverRareTile: (tile: RareTileInstance) => Effect.Effect<void>
  readonly tick: (deltaTimeMs: number) => Effect.Effect<GameUpdateResult>
  readonly getWorldState: () => Effect.Effect<GameWorldState>
  readonly getSchool: () => Effect.Effect<SchoolID | null>
  readonly getShareCode: () => Effect.Effect<string>
  readonly getEventStream: () => Effect.Effect<Stream.Stream<GameEvent>>
}

export type GameEvent =
  | { type: "discovery"; data: DiscoveryEvent }
  | { type: "stress_rhythm"; data: StressRhythmEvent }
  | { type: "rare_discovered"; data: RareTileInstance }
  | { type: "npc_helped"; data: NPCInteraction }
  | { type: "chunk_transformed"; data: { chunkX: number; chunkZ: number; reason: string } }

export interface GameUpdateResult {
  visibleNPCs: EmotionalVisualState[]
  events: GameEvent[]
  playerStress: PlayerStressState
  schoolUpdated: boolean
}

export function makeGameEngine(): Effect.Effect<GameEngine> {
  return Effect.gen(function* () {
    const emotionalDisplay = yield* makeEmotionalDisplayEngine()
    const discoveryLoop = yield* makeDiscoveryLoopSystem()
    const rareTileEngine = yield* makeRareTileEngine()
    const stressRhythm = yield* makeStressRhythmSystem()
    const npcMemory = yield* makeNPCMemorySystem()
    const schoolID = yield* makeSchoolIDSystem()

    const worldState = yield* Ref.make<GameWorldState>({
      playerPosition: { x: 0, y: 0, z: 0 },
      currentChunkX: 0,
      currentChunkZ: 0,
      npcs: new Map(),
      npcStates: new Map(),
      chunkTiles: new Map(),
      gameTime: { hour: 8, dayIndex: 0 },
      playerStress: {
        currentStress: 0,
        maxStress: 100,
        stressRate: 0.02,
        reliefRate: 0.05,
        lastZoneChange: 0,
        consecutiveStressZones: 0,
        consecutiveReliefZones: 0,
        isOverwhelmed: false,
      },
      visibleNPCs: [],
      pendingEvents: [],
      rareTilesInChunk: [],
    })

    const eventPubSub = yield* PubSub.unbounded<GameEvent>()
    let seed = 42

    function worldToChunk(worldX: number, worldZ: number, chunkSize: number = 64): { x: number; z: number } {
      return {
        x: Math.floor(worldX / chunkSize),
        z: Math.floor(worldZ / chunkSize),
      }
    }

    return {
      initialize: (newSeed, schoolName) =>
        Effect.gen(function* () {
          seed = newSeed
          yield* schoolID.createSchool(newSeed, schoolName)
          console.log(`[game] World initialized — seed: ${newSeed}`)
          console.log(`[game] School: ${(yield* schoolID.getSchool())?.name}`)
          console.log(`[game] Share your world: ${(yield* schoolID.getShareCode())}`)
        }),

      updatePlayerPosition: (x, y, z) =>
        Effect.gen(function* () {
          const state = yield* Ref.get(worldState)
          const newChunk = worldToChunk(x, z)
          const chunkChanged = newChunk.x !== state.currentChunkX || newChunk.z !== state.currentChunkZ

          yield* Ref.update(worldState, (s) => ({
            ...s,
            playerPosition: { x, y, z },
            currentChunkX: newChunk.x,
            currentChunkZ: newChunk.z,
          }))

          const events: GameEvent[] = []
          let stressResult: { event: any; newState: PlayerStressState } | null = null

          if (chunkChanged) {
            const chunkId = `chunk_${newChunk.x}_${newChunk.z}`
            const tiles = state.chunkTiles.get(chunkId) ?? new Map()

            const zoneInfo = yield* stressRhythm.analyzeChunk(newChunk.x, newChunk.z, tiles)
            stressResult = yield* stressRhythm.enterZone(zoneInfo, state.playerStress)

            yield* Ref.update(worldState, (s) => ({
              ...s,
              playerStress: stressResult!.newState,
            }))

            events.push({ type: "stress_rhythm", data: stressResult!.event })

            const discoveries = yield* discoveryLoop.checkForDiscoveries(
              { x, y, z },
              [...state.npcs.values()],
              state.npcStates,
              newChunk.x,
              newChunk.z
            )

            for (const d of discoveries) {
              events.push({ type: "discovery", data: d })
              yield* PubSub.publish(eventPubSub, { type: "discovery", data: d })
            }

            const rareTile = yield* rareTileEngine.generateRareTileForChunk(newChunk.x, newChunk.z, seed)
            if (rareTile) {
              yield* Ref.update(worldState, (s) => ({
                ...s,
                rareTilesInChunk: [...s.rareTilesInChunk, rareTile],
              }))
              events.push({ type: "rare_discovered", data: rareTile })
              yield* PubSub.publish(eventPubSub, { type: "rare_discovered", data: rareTile })
            }

            yield* schoolID.updateStats({
              totalChunksExplored: 1,
              deepestChunkX: Math.max(state.currentChunkX, Math.abs(newChunk.x)),
              deepestChunkZ: Math.max(state.currentChunkZ, Math.abs(newChunk.z)),
            })
          }

          const visibleNPCs = yield* emotionalDisplay.getVisibleNPCs(
            [...state.npcs.values()],
            state.npcStates,
            { x, y, z }
          )

          yield* Ref.update(worldState, (s) => ({
            ...s,
            visibleNPCs,
            pendingEvents: [...state.pendingEvents, ...events.map(e => {
              if (e.type === "discovery") return e.data
              return null
            }).filter(Boolean) as DiscoveryEvent[]],
          }))

          return {
            visibleNPCs,
            events,
            playerStress: stressResult?.newState ?? state.playerStress,
            schoolUpdated: chunkChanged,
          }
        }),

      helpNPC: (npcId) =>
        Effect.gen(function* () {
          const state = yield* Ref.get(worldState)
          const npc = state.npcs.get(npcId)
          if (!npc) return null

          const interaction = yield* discoveryLoop.helpNPC(
            npcId,
            state.playerPosition,
            state.npcs,
            state.npcStates
          )

          if (interaction) {
            yield* npcMemory.recordInteraction(npcId, {
              type: "helped",
              timestamp: Date.now(),
              chunkX: state.currentChunkX,
              chunkZ: state.currentChunkZ,
              details: { previousMood: interaction.previousMood, newMood: interaction.newMood },
            })

            yield* schoolID.updateStats({ npcsHelped: 1 })

            yield* PubSub.publish(eventPubSub, { type: "npc_helped", data: interaction })

            if (interaction.chunkTransformTriggered) {
              yield* PubSub.publish(eventPubSub, {
                type: "chunk_transformed",
                data: {
                  chunkX: state.currentChunkX,
                  chunkZ: state.currentChunkZ,
                  reason: `Helped ${npc.name} — the environment shifts`,
                },
              })
            }
          }

          return interaction
        }),

      interactWithNPC: (npcId) =>
        Effect.gen(function* () {
          const state = yield* Ref.get(worldState)
          const npc = state.npcs.get(npcId)
          if (!npc) return "..."

          yield* npcMemory.recordInteraction(npcId, {
            type: "talked",
            timestamp: Date.now(),
            chunkX: state.currentChunkX,
            chunkZ: state.currentChunkZ,
            details: {},
          })

          const greeting = yield* npcMemory.getGreetingText(npcId, npc.name ?? "Student")
          return greeting
        }),

      discoverRareTile: (tile) =>
        Effect.gen(function* () {
          yield* rareTileEngine.discoverRareTile(tile)
          yield* schoolID.updateStats({ rareTilesDiscovered: 1 })

          yield* PubSub.publish(eventPubSub, { type: "rare_discovered", data: tile })
        }),

      tick: (deltaTimeMs) =>
        Effect.gen(function* () {
          const state = yield* Ref.get(worldState)

          const updatedStress = yield* stressRhythm.updatePlayerStress(
            state.playerStress,
            deltaTimeMs,
            state.playerStress.currentStress > 50
          )

          yield* Ref.update(worldState, (s) => ({
            ...s,
            playerStress: updatedStress,
            gameTime: {
              hour: (s.gameTime.hour + deltaTimeMs / 60000) % 24,
              dayIndex: s.gameTime.dayIndex,
            },
          }))

          const visibleNPCs = yield* emotionalDisplay.getVisibleNPCs(
            [...state.npcs.values()],
            state.npcStates,
            state.playerPosition
          )

          yield* Ref.update(worldState, (s) => ({ ...s, visibleNPCs }))

          yield* schoolID.updateStats({ totalPlayTimeMs: deltaTimeMs })

          return {
            visibleNPCs,
            events: [],
            playerStress: updatedStress,
            schoolUpdated: false,
          }
        }),

      getWorldState: () =>
        Ref.get(worldState),

      getSchool: () =>
        schoolID.getSchool(),

      getShareCode: () =>
        schoolID.getShareCode(),

      getEventStream: () =>
        Effect.succeed(Stream.fromPubSub(eventPubSub)),
    }
  })
}
