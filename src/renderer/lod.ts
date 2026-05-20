import type { LodLevel, LodConfig, LodTransition, ChunkId, Vec3 } from "./types.js"
import { LOD_CONFIGS, clamp } from "./types.js"

export interface LodSelector {
  readonly selectLod: (distance: number, lodBias: number) => LodLevel
  readonly getTransition: (
    chunkId: ChunkId,
    currentLevel: LodLevel,
    targetLevel: LodLevel,
    elapsedMs: number
  ) => LodTransition
  readonly shouldUpgrade: (
    currentLevel: LodLevel,
    targetLevel: LodLevel,
    hysteresisFrames: number
  ) => boolean
  readonly getConfig: (level: LodLevel) => LodConfig
  readonly getMaxLodDistance: (level: LodLevel, lodBias: number) => number
}

export const DefaultLodSelector: LodSelector = {
  selectLod: (distance: number, lodBias: number): LodLevel => {
    const biasedDistance = distance / lodBias
    for (const config of LOD_CONFIGS) {
      if (biasedDistance <= config.maxDistance) return config.level
    }
    return 4
  },

  getTransition: (chunkId, currentLevel, targetLevel, elapsedMs): LodTransition => {
    const durationMs = Math.abs(targetLevel - currentLevel) * 200
    const progress = clamp(elapsedMs / durationMs, 0, 1)
    return { chunkId, fromLevel: currentLevel, toLevel: targetLevel, progress, durationMs }
  },

  shouldUpgrade: (currentLevel, targetLevel, hysteresisFrames): boolean => {
    if (targetLevel < currentLevel) return false
    if (targetLevel > currentLevel) return hysteresisFrames >= 5
    return false
  },

  getConfig: (level: LodLevel): LodConfig => LOD_CONFIGS[level],

  getMaxLodDistance: (level: LodLevel, lodBias: number): number => {
    return LOD_CONFIGS[level].maxDistance * lodBias
  },
}

export type LodUpgradePolicy = "immediate" | "hysteresis" | "predictive"

export interface LodManagerConfig {
  policy: LodUpgradePolicy
  downgradeDelayFrames: number
  upgradeDelayFrames: number
  maxConcurrentTransitions: number
}

export const defaultLodManagerConfig: LodManagerConfig = {
  policy: "hysteresis",
  downgradeDelayFrames: 3,
  upgradeDelayFrames: 5,
  maxConcurrentTransitions: 10,
}

export interface LodManager {
  readonly evaluateLod: (
    chunkId: ChunkId,
    currentLevel: LodLevel,
    distance: number,
    lodBias: number,
    frameNumber: number
  ) => { targetLevel: LodLevel; shouldTransition: boolean }
  readonly getActiveTransitions: () => Map<ChunkId, LodTransition>
  readonly updateTransitions: (deltaMs: number) => LodTransition[]
  readonly reset: () => void
}

export function makeLodManager(config?: Partial<LodManagerConfig>): LodManager {
  const cfg = { ...defaultLodManagerConfig, ...config }
  const activeTransitions = new Map<ChunkId, LodTransition>()
  const lodStableFrames = new Map<ChunkId, number>()

  return {
    evaluateLod: (chunkId, currentLevel, distance, lodBias, frameNumber) => {
      const targetLevel = DefaultLodSelector.selectLod(distance, lodBias)

      if (targetLevel === currentLevel) {
        const stable = (lodStableFrames.get(chunkId) ?? 0) + 1
        lodStableFrames.set(chunkId, stable)
        return { targetLevel, shouldTransition: false }
      }

      if (targetLevel > currentLevel) {
        const stable = (lodStableFrames.get(chunkId) ?? 0) + 1
        lodStableFrames.set(chunkId, stable)
        if (stable >= cfg.downgradeDelayFrames) {
          lodStableFrames.delete(chunkId)
          return { targetLevel, shouldTransition: true }
        }
        return { targetLevel, shouldTransition: false }
      }

      const stable = (lodStableFrames.get(chunkId) ?? 0) + 1
      lodStableFrames.set(chunkId, stable)
      if (stable >= cfg.upgradeDelayFrames && activeTransitions.size < cfg.maxConcurrentTransitions) {
        lodStableFrames.delete(chunkId)
        return { targetLevel, shouldTransition: true }
      }
      return { targetLevel, shouldTransition: false }
    },

    getActiveTransitions: () => activeTransitions,

    updateTransitions: (deltaMs) => {
      const completed: LodTransition[] = []
      for (const [id, transition] of activeTransitions) {
        transition.progress = clamp(transition.progress + deltaMs / transition.durationMs, 0, 1)
        if (transition.progress >= 1) {
          completed.push(transition)
          activeTransitions.delete(id)
        }
      }
      return completed
    },

    reset: () => {
      activeTransitions.clear()
      lodStableFrames.clear()
    },
  }
}
