import { Effect, Ref, PubSub, Stream } from "effect"
import type { StudentProfile, PsychologicalState, StudentMood } from "../pcg/psychological-node.js"
import type { Tile } from "../pcg/types.js"

export interface DiscoveryEvent {
  type: "npc_discovered" | "npc_helped" | "chunk_transformed" | "rare_tile_found" | "stress_zone_entered" | "relief_zone_entered"
  npcId?: string
  chunkId: string
  chunkX: number
  chunkZ: number
  timestamp: number
  details: Record<string, unknown>
}

export interface NPCInteraction {
  npcId: string
  playerAction: "help" | "ignore" | "talk" | "give_item"
  previousMood: StudentMood
  newMood: StudentMood
  stressDelta: number
  chunkTransformTriggered: boolean
  timestamp: number
}

export interface ChunkTransformation {
  chunkId: string
  chunkX: number
  chunkZ: number
  triggerType: "npc_rescued" | "stress_released" | "rare_discovered"
  beforeTiles: Map<string, Tile>
  afterTiles: Map<string, Tile>
  transformationReason: string
}

export interface DiscoveryLoopConfig {
  readonly helpRadius: number
  readonly chunkTransformCooldown: number
  readonly maxTransformationsPerChunk: number
  readonly stressZoneDetectionRadius: number
  readonly reliefZoneDetectionRadius: number
}

const DEFAULT_DISCOVERY_CONFIG: DiscoveryLoopConfig = {
  helpRadius: 3.0,
  chunkTransformCooldown: 30000,
  maxTransformationsPerChunk: 3,
  stressZoneDetectionRadius: 5.0,
  reliefZoneDetectionRadius: 5.0,
}

export interface DiscoveryLoopSystem {
  readonly checkForDiscoveries: (
    playerPos: { x: number; y: number; z: number },
    npcs: StudentProfile[],
    npcStates: Map<string, PsychologicalState>,
    currentChunkX: number,
    currentChunkZ: number
  ) => Effect.Effect<DiscoveryEvent[]>
  readonly helpNPC: (
    npcId: string,
    playerPos: { x: number; y: number; z: number },
    npcs: Map<string, StudentProfile>,
    npcStates: Map<string, PsychologicalState>
  ) => Effect.Effect<NPCInteraction | null>
  readonly triggerChunkTransformation: (
    chunkX: number,
    chunkZ: number,
    triggerType: "npc_rescued" | "stress_released" | "rare_discovered",
    reason: string
  ) => Effect.Effect<ChunkTransformation | null>
  readonly subscribeEvents: () => Effect.Effect<Stream.Stream<DiscoveryEvent>>
  readonly getTransformationCount: (chunkId: string) => Effect.Effect<number>
  readonly getInteractionHistory: () => Effect.Effect<NPCInteraction[]>
}

export function makeDiscoveryLoopSystem(config: Partial<DiscoveryLoopConfig> = {}): Effect.Effect<DiscoveryLoopSystem> {
  return Effect.gen(function* () {
    const cfg = { ...DEFAULT_DISCOVERY_CONFIG, ...config }
    const eventPubSub = yield* PubSub.unbounded<DiscoveryEvent>()
    const transformationCounts = yield* Ref.make<Map<string, number>>(new Map())
    const lastTransformTime = yield* Ref.make<Map<string, number>>(new Map())
    const interactionHistory = yield* Ref.make<NPCInteraction[]>([])

    function distance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
      return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2)
    }

    function createChunkId(x: number, z: number): string {
      return `chunk_${x}_${z}`
    }

    function doTriggerChunkTransformation(chunkX: number, chunkZ: number, triggerType: "npc_rescued" | "stress_released" | "rare_discovered", reason: string) {
      return Effect.gen(function* () {
        const chunkId = createChunkId(chunkX, chunkZ)
        const now = Date.now()
        const counts = yield* Ref.get(transformationCounts)
        const times = yield* Ref.get(lastTransformTime)
        const currentCount = counts.get(chunkId) ?? 0
        const lastTime = times.get(chunkId) ?? 0
        if (currentCount >= cfg.maxTransformationsPerChunk) return null
        if (now - lastTime < cfg.chunkTransformCooldown) return null
        yield* Ref.update(transformationCounts, (m) => new Map(m).set(chunkId, currentCount + 1))
        yield* Ref.update(lastTransformTime, (m) => new Map(m).set(chunkId, now))
        yield* PubSub.publish(eventPubSub, {
          type: "chunk_transformed", chunkId, chunkX, chunkZ, timestamp: now,
          details: { triggerType, reason, transformationCount: currentCount + 1 },
        })
        return { chunkId, chunkX, chunkZ, triggerType, beforeTiles: new Map(), afterTiles: new Map(), transformationReason: reason }
      })
    }

    const result: DiscoveryLoopSystem = {
      checkForDiscoveries: (playerPos, npcs, npcStates, currentChunkX, currentChunkZ) =>
        Effect.gen(function* () {
          const events: DiscoveryEvent[] = []
          const chunkId = createChunkId(currentChunkX, currentChunkZ)
          const now = Date.now()

          for (const npc of npcs) {
            const state = npcStates.get(npc.id)
            if (!state) continue

            const npcPos = (npc as any).currentLocationPos ?? { x: 0, y: 0, z: 0 }
            const dist = distance(playerPos, npcPos)

            if (dist < cfg.helpRadius) {
              events.push({
                type: "npc_discovered",
                npcId: npc.id,
                chunkId,
                chunkX: currentChunkX,
                chunkZ: currentChunkZ,
                timestamp: now,
                details: {
                  mood: state.mood,
                  stressLevel: state.stressLevel,
                  distance: dist,
                  isInteractable: state.mood === "burnout" || state.mood === "anxious" || state.mood === "avoidant",
                },
              })
            }

            if (state.mood === "burnout" && state.stressLevel > 0.85) {
              const location = (npc as any).currentLocation ?? ""
              if (location.includes("stairwell") || location.includes("toilet") || location.includes("roof")) {
                events.push({
                  type: "npc_discovered",
                  npcId: npc.id,
                  chunkId,
                  chunkX: currentChunkX,
                  chunkZ: currentChunkZ,
                  timestamp: now,
                  details: {
                    mood: "burnout",
                    hidingLocation: location,
                    severity: "critical",
                    message: `Found ${npc.name} hiding in the ${location} — they're in burnout`,
                  },
                })
              }
            }
          }

          for (const event of events) {
            yield* PubSub.publish(eventPubSub, event)
          }

          return events
        }),

      helpNPC: (npcId, playerPos, npcs, npcStates) =>
        Effect.gen(function* () {
          const npc = npcs.get(npcId) as any
          const state = npcStates.get(npcId)
          if (!npc || !state) return null
          const npcPos = (npc as any).currentLocationPos ?? { x: 0, y: 0, z: 0 }
          const dist = distance(playerPos, npcPos)
          if (dist > cfg.helpRadius) return null
          const previousMood = state.mood
          let newMood: StudentMood = previousMood
          let stressDelta = 0
          switch (previousMood) {
            case "burnout": newMood = "relaxed"; stressDelta = -0.5; break
            case "anxious": newMood = "focused"; stressDelta = -0.3; break
            case "avoidant": newMood = "social"; stressDelta = -0.2; break
            default: return null
          }
          const interaction: NPCInteraction = {
            npcId, playerAction: "help", previousMood, newMood, stressDelta,
            chunkTransformTriggered: previousMood === "burnout", timestamp: Date.now(),
          }
          yield* Ref.update(interactionHistory, (h) => [...h.slice(-99), interaction])
          if (previousMood === "burnout") {
            const cx = Math.floor(npcPos.x / 64), cz = Math.floor(npcPos.z / 64)
            yield* doTriggerChunkTransformation(cx, cz, "npc_rescued", `Rescued ${(npc as any).name || npcId} from burnout`)
          }
          yield* PubSub.publish(eventPubSub, {
            type: "npc_helped", npcId,
            chunkId: createChunkId(Math.floor(npcPos.x / 64), Math.floor(npcPos.z / 64)),
            chunkX: Math.floor(npcPos.x / 64), chunkZ: Math.floor(npcPos.z / 64),
            timestamp: Date.now(),
            details: { previousMood, newMood, stressDelta, chunkTransformTriggered: interaction.chunkTransformTriggered },
          })
          return interaction
        }) as Effect.Effect<NPCInteraction | null, never, never>,

      triggerChunkTransformation: (chunkX, chunkZ, triggerType, reason) =>
        doTriggerChunkTransformation(chunkX, chunkZ, triggerType, reason) as Effect.Effect<ChunkTransformation | null, never, never>,

      subscribeEvents: () =>
        Effect.succeed(Stream.fromPubSub(eventPubSub)),

      getTransformationCount: (chunkId) =>
        Ref.get(transformationCounts).pipe(Effect.map((m) => m.get(chunkId) ?? 0)),

      getInteractionHistory: () => Ref.get(interactionHistory),
    }

    return result
  })
}
