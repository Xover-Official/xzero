import { Effect, Ref } from "effect"
import type { Tile } from "../pcg/types.js"
import type { GridCell } from "../pcg/types.js"

function mulberry32(a: number): () => number {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0
    let t = Math.imul(a ^ a >>> 15, 1 | a)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

export interface RareTileDefinition {
  id: string
  name: string
  description: string
  rarity: number
  category: "locked_room" | "hidden_courtyard" | "teacher_free_zone" | "secret_passage" | "rooftop_garden" | "abandoned_clubroom"
  stressLevel: "high" | "medium" | "low" | "sanctuary"
  discoveryMessage: string
  requiresTrigger: boolean
  triggerCondition?: string
}

export interface RareTileInstance extends RareTileDefinition {
  worldX: number
  worldZ: number
  chunkX: number
  chunkZ: number
  discovered: boolean
  discoveredAt?: number
  seed: number
}

export const RARE_TILE_DEFINITIONS: RareTileDefinition[] = [
  {
    id: "rare_locked_music_room",
    name: "Locked Music Room",
    description: "An old music room with a broken lock. Faint piano music echoes from inside.",
    rarity: 0.003,
    category: "locked_room",
    stressLevel: "sanctuary",
    discoveryMessage: "You found a hidden music room — the door creaks open to reveal a dusty piano",
    requiresTrigger: false,
  },
  {
    id: "rare_hidden_courtyard",
    name: "Hidden Courtyard",
    description: "A courtyard hidden behind overgrown bushes. Nobody comes here.",
    rarity: 0.005,
    category: "hidden_courtyard",
    stressLevel: "sanctuary",
    discoveryMessage: "Behind the bushes lies a forgotten courtyard — the air feels lighter here",
    requiresTrigger: false,
  },
  {
    id: "rare_teacher_free_zone",
    name: "Teacher-Free Zone",
    description: "A corridor where teachers never patrol. Students gather here to breathe.",
    rarity: 0.008,
    category: "teacher_free_zone",
    stressLevel: "low",
    discoveryMessage: "You've entered a teacher-free zone — the tension drops instantly",
    requiresTrigger: false,
  },
  {
    id: "rare_secret_passage",
    name: "Secret Passage",
    description: "A narrow passage behind a bookshelf. Where does it lead?",
    rarity: 0.002,
    category: "secret_passage",
    stressLevel: "medium",
    discoveryMessage: "A hidden passage behind a loose bookshelf — it leads somewhere unexpected",
    requiresTrigger: true,
    triggerCondition: "nearby_students > 0",
  },
  {
    id: "rare_rooftop_garden",
    name: "Rooftop Garden",
    description: "Someone has been growing flowers on the roof. A quiet place above it all.",
    rarity: 0.004,
    category: "rooftop_garden",
    stressLevel: "sanctuary",
    discoveryMessage: "The rooftop has a secret garden — someone tends to these flowers carefully",
    requiresTrigger: false,
  },
  {
    id: "rare_abandoned_clubroom",
    name: "Abandoned Clubroom",
    description: "An old clubroom frozen in time. Posters from years past still hang on the walls.",
    rarity: 0.006,
    category: "abandoned_clubroom",
    stressLevel: "low",
    discoveryMessage: "An abandoned clubroom — the ghosts of old club activities linger here",
    requiresTrigger: false,
  },
]

export interface RareTileEngine {
  readonly checkForRareTile: (
    chunkX: number,
    chunkZ: number,
    chunkSeed: number,
    cell: GridCell
  ) => Effect.Effect<RareTileInstance | null>
  readonly discoverRareTile: (tile: RareTileInstance) => Effect.Effect<void>
  readonly getDiscoveredTiles: () => Effect.Effect<RareTileInstance[]>
  readonly getDiscoveryCount: () => Effect.Effect<number>
  readonly generateRareTileForChunk: (
    chunkX: number,
    chunkZ: number,
    chunkSeed: number
  ) => Effect.Effect<RareTileInstance | null>
}

export function makeRareTileEngine(): Effect.Effect<RareTileEngine> {
  return Effect.gen(function* () {
    const discoveredTiles = yield* Ref.make<RareTileInstance[]>([])

    function hashForRarity(chunkX: number, chunkZ: number, cellX: number, cellZ: number, seed: number): number {
      let h = seed
      h = Math.imul(h ^ chunkX, 0x5bd1e995)
      h = Math.imul(h ^ chunkZ, 0x5bd1e995)
      h = Math.imul(h ^ cellX, 0x5bd1e995)
      h = Math.imul(h ^ cellZ, 0x5bd1e995)
      h = h ^ (h >>> 13)
      h = Math.imul(h, 0x5bd1e995)
      h = h ^ (h >>> 15)
      return (Math.abs(h) % 10000) / 10000
    }

    return {
      checkForRareTile: (chunkX, chunkZ, chunkSeed, cell) =>
        Effect.gen(function* () {
          if (cell.collapsed && cell.tile) {
            const rarity = hashForRarity(chunkX, chunkZ, cell.coord.x, cell.coord.y, chunkSeed)

            for (const def of RARE_TILE_DEFINITIONS) {
              if (rarity < def.rarity) {
                const worldX = chunkX * 64 + cell.coord.x
                const worldZ = chunkZ * 64 + cell.coord.y

                return {
                  ...def,
                  worldX,
                  worldZ,
                  chunkX,
                  chunkZ,
                  discovered: false,
                  seed: chunkSeed,
                }
              }
            }
          }
          return null
        }),

      discoverRareTile: (tile) =>
        Effect.gen(function* () {
          const discovered = { ...tile, discovered: true, discoveredAt: Date.now() }
          yield* Ref.update(discoveredTiles, (tiles) => [...tiles, discovered])
          console.log(`[rare] DISCOVERED: ${tile.name} at (${tile.worldX}, ${tile.worldZ})`)
          console.log(`[rare] ${tile.discoveryMessage}`)
        }),

      getDiscoveredTiles: () =>
        Ref.get(discoveredTiles),

      getDiscoveryCount: () =>
        Ref.get(discoveredTiles).pipe(
          Effect.map((tiles) => tiles.length)
        ),

      generateRareTileForChunk: (chunkX, chunkZ, chunkSeed) =>
        Effect.sync(() => {
          const random = mulberry32(chunkSeed)
          const roll = random()
          for (const def of RARE_TILE_DEFINITIONS) {
            if (roll < def.rarity) {
              const cellX = Math.floor(random() * 64)
              const cellZ = Math.floor(random() * 64)
              return {
                ...def, worldX: chunkX * 64 + cellX, worldZ: chunkZ * 64 + cellZ,
                chunkX, chunkZ, discovered: false, seed: chunkSeed,
              }
            }
          }
          return null
        }),
    }
  })
}
