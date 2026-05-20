import { Effect, Ref, PubSub, Stream } from "effect"
import type { StressLevel } from "../pcg/types.js"
import type { Tile } from "../pcg/types.js"

export interface StressZoneInfo {
  chunkX: number
  chunkZ: number
  dominantStress: StressLevel
  stressScore: number
  tiles: Map<string, Tile>
  isSanctuary: boolean
  isHighStress: boolean
}

export interface StressRhythmEvent {
  type: "stress_zone_entered" | "relief_zone_entered" | "tension_peak" | "release" | "overwhelmed"
  timestamp: number
  chunkX: number
  chunkZ: number
  stressScore: number
  playerStressLevel: number
  message: string
}

export interface PlayerStressState {
  currentStress: number
  maxStress: number
  stressRate: number
  reliefRate: number
  lastZoneChange: number
  consecutiveStressZones: number
  consecutiveReliefZones: number
  isOverwhelmed: boolean
}

export interface StressRhythmSystem {
  readonly analyzeChunk: (chunkX: number, chunkZ: number, tiles: Map<string, Tile>) => Effect.Effect<StressZoneInfo>
  readonly enterZone: (zoneInfo: StressZoneInfo, playerState: PlayerStressState) => Effect.Effect<{ event: StressRhythmEvent; newState: PlayerStressState }>
  readonly updatePlayerStress: (playerState: PlayerStressState, deltaTimeMs: number, inHighStress: boolean) => Effect.Effect<PlayerStressState>
  readonly subscribeEvents: () => Effect.Effect<Stream.Stream<StressRhythmEvent>>
  readonly getPlayerState: () => Effect.Effect<PlayerStressState>
  readonly resetPlayerState: () => Effect.Effect<void>
}

const STRESS_VALUES: Record<StressLevel, number> = {
  high: 0.9,
  medium: 0.5,
  low: 0.2,
}

const DEFAULT_PLAYER_STATE: PlayerStressState = {
  currentStress: 0,
  maxStress: 100,
  stressRate: 0.02,
  reliefRate: 0.05,
  lastZoneChange: 0,
  consecutiveStressZones: 0,
  consecutiveReliefZones: 0,
  isOverwhelmed: false,
}

export function makeStressRhythmSystem(): Effect.Effect<StressRhythmSystem> {
  return Effect.gen(function* () {
    const eventPubSub = yield* PubSub.unbounded<StressRhythmEvent>()
    const playerStateRef = yield* Ref.make<PlayerStressState>({ ...DEFAULT_PLAYER_STATE })

    return {
      analyzeChunk: (chunkX, chunkZ, tiles) =>
        Effect.gen(function* () {
          let totalStress = 0
          let tileCount = 0
          let sanctuaryCount = 0
          let highStressCount = 0

          for (const [, tile] of tiles) {
            const typeId = tile.typeId
            let stress: StressLevel = "medium"

            if (typeId.includes("exam") || typeId.includes("staff") || typeId.includes("gate")) {
              stress = "high"
              highStressCount++
            } else if (typeId.includes("courtyard") || typeId.includes("open_space") || typeId.includes("garden")) {
              stress = "low"
              sanctuaryCount++
            } else if (typeId.includes("stairwell") || typeId.includes("corridor")) {
              stress = "medium"
            } else if (typeId.includes("classroom")) {
              stress = "medium"
            }

            totalStress += STRESS_VALUES[stress] ?? 0.5
            tileCount++
          }

          const stressScore = tileCount > 0 ? totalStress / tileCount : 0.5
          const isSanctuary = sanctuaryCount > tileCount * 0.3
          const isHighStress = highStressCount > tileCount * 0.3

          return {
            chunkX,
            chunkZ,
            dominantStress: isHighStress ? "high" : isSanctuary ? "low" : "medium",
            stressScore,
            tiles,
            isSanctuary,
            isHighStress,
          }
        }),

      enterZone: (zoneInfo, playerState) =>
        Effect.gen(function* () {
          const now = Date.now()
          let newStress = playerState.currentStress
          let consecutiveStress = playerState.consecutiveStressZones
          let consecutiveRelief = playerState.consecutiveReliefZones
          let overwhelmed = playerState.isOverwhelmed

          let eventType: StressRhythmEvent["type"]
          let message: string

          if (zoneInfo.isHighStress) {
            consecutiveStress++
            consecutiveRelief = 0
            newStress += 15 * zoneInfo.stressScore

            if (consecutiveStress >= 3) {
              eventType = "overwhelmed"
              message = "The stress is building up... you need to find somewhere quiet"
              overwhelmed = true
            } else if (zoneInfo.stressScore > 0.7) {
              eventType = "tension_peak"
              message = "The atmosphere here is heavy — everyone seems on edge"
            } else {
              eventType = "stress_zone_entered"
              message = "You enter a high-stress area"
            }
          } else if (zoneInfo.isSanctuary) {
            consecutiveRelief++
            consecutiveStress = 0
            newStress = Math.max(0, newStress - 20 * (1 - zoneInfo.stressScore))
            overwhelmed = false

            if (consecutiveRelief >= 2) {
              eventType = "release"
              message = "The tension melts away — you can finally breathe"
            } else {
              eventType = "relief_zone_entered"
              message = "A quiet space — the air feels lighter here"
            }
          } else {
            consecutiveStress = 0
            consecutiveRelief = 0
            eventType = "stress_zone_entered"
            message = "You move through the corridor"
          }

          newStress = Math.min(playerState.maxStress, Math.max(0, newStress))

          const newState: PlayerStressState = {
            ...playerState,
            currentStress: newStress,
            consecutiveStressZones: consecutiveStress,
            consecutiveReliefZones: consecutiveRelief,
            isOverwhelmed: overwhelmed,
            lastZoneChange: now,
          }

          const event: StressRhythmEvent = {
            type: eventType,
            timestamp: now,
            chunkX: zoneInfo.chunkX,
            chunkZ: zoneInfo.chunkZ,
            stressScore: zoneInfo.stressScore,
            playerStressLevel: newStress / playerState.maxStress,
            message,
          }

          yield* PubSub.publish(eventPubSub, event)

          return { event, newState }
        }),

      updatePlayerStress: (playerState, deltaTimeMs, inHighStress) =>
        Effect.gen(function* () {
          const dt = deltaTimeMs / 1000
          let newStress = playerState.currentStress

          if (inHighStress) {
            newStress += playerState.stressRate * dt * 10
          } else {
            newStress -= playerState.reliefRate * dt * 10
          }

          newStress = Math.min(playerState.maxStress, Math.max(0, newStress))

          return {
            ...playerState,
            currentStress: newStress,
            isOverwhelmed: newStress > playerState.maxStress * 0.8,
          }
        }),

      subscribeEvents: () =>
        Effect.succeed(Stream.fromPubSub(eventPubSub)),

      getPlayerState: () =>
        Ref.get(playerStateRef),

      resetPlayerState: () =>
        Ref.set(playerStateRef, { ...DEFAULT_PLAYER_STATE }),
    }
  })
}
