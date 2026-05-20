import { Effect, Ref } from "effect"
import type { BudgetTracker, ChunkId, LodLevel } from "./types.js"

export interface BudgetEngine {
  readonly getBudget: () => BudgetTracker
  readonly canLoad: (
    triangleCount: number,
    textureMemory: number
  ) => Effect.Effect<boolean>
  readonly canUpgradeLod: (
    currentLevel: LodLevel,
    targetLevel: LodLevel,
    additionalTriangles: number
  ) => Effect.Effect<boolean>
  readonly recordLoad: (
    chunkId: ChunkId,
    triangleCount: number,
    textureMemory: number
  ) => Effect.Effect<void>
  readonly recordUnload: (
    chunkId: ChunkId,
    triangleCount: number,
    textureMemory: number
  ) => Effect.Effect<void>
  readonly getUtilization: () => {
    trianglePct: number
    drawCallPct: number
    memoryPct: number
    chunkPct: number
  }
  readonly getPressure: () => "low" | "medium" | "high" | "critical"
  readonly shouldForceUnload: () => boolean
  readonly getChunksToUnload: (
    loadedChunks: Map<ChunkId, { triangleCount: number; textureMemory: number; lastVisibleFrame: number }>,
    currentFrame: number
  ) => ChunkId[]
}

export function makeBudgetEngine(config: {
  maxTriangles: number
  maxDrawCalls: number
  maxTextureMemory: number
  targetLoadedChunks: number
  unloadThresholdPct: number
}): BudgetEngine {
  const budget: BudgetTracker = {
    maxTriangles: config.maxTriangles,
    maxDrawCalls: config.maxDrawCalls,
    maxTextureMemory: config.maxTextureMemory,
    currentTriangles: 0,
    currentDrawCalls: 0,
    currentTextureMemory: 0,
    currentLoadedChunks: 0,
    targetLoadedChunks: config.targetLoadedChunks,
  }

  return {
    getBudget: () => ({ ...budget }),

    canLoad: (triangleCount, textureMemory) =>
      Effect.succeed(
        budget.currentTriangles + triangleCount <= budget.maxTriangles &&
        budget.currentTextureMemory + textureMemory <= budget.maxTextureMemory &&
        budget.currentDrawCalls + 1 <= budget.maxDrawCalls
      ),

    canUpgradeLod: (currentLevel, targetLevel, additionalTriangles) =>
      Effect.succeed(
        targetLevel < currentLevel &&
        budget.currentTriangles + additionalTriangles <= budget.maxTriangles
      ),

    recordLoad: (chunkId, triangleCount, textureMemory) =>
      Effect.sync(() => {
        budget.currentTriangles += triangleCount
        budget.currentTextureMemory += textureMemory
        budget.currentDrawCalls++
        budget.currentLoadedChunks++
      }),

    recordUnload: (chunkId, triangleCount, textureMemory) =>
      Effect.sync(() => {
        budget.currentTriangles = Math.max(0, budget.currentTriangles - triangleCount)
        budget.currentTextureMemory = Math.max(0, budget.currentTextureMemory - textureMemory)
        budget.currentDrawCalls = Math.max(0, budget.currentDrawCalls - 1)
        budget.currentLoadedChunks = Math.max(0, budget.currentLoadedChunks - 1)
      }),

    getUtilization: () => ({
      trianglePct: budget.currentTriangles / budget.maxTriangles,
      drawCallPct: budget.currentDrawCalls / budget.maxDrawCalls,
      memoryPct: budget.currentTextureMemory / budget.maxTextureMemory,
      chunkPct: budget.currentLoadedChunks / budget.targetLoadedChunks,
    }),

    getPressure: () => {
      const utilization = {
        trianglePct: budget.currentTriangles / budget.maxTriangles,
        drawCallPct: budget.currentDrawCalls / budget.maxDrawCalls,
        memoryPct: budget.currentTextureMemory / budget.maxTextureMemory,
      }

      const maxPct = Math.max(utilization.trianglePct, utilization.drawCallPct, utilization.memoryPct)

      if (maxPct > 0.95) return "critical"
      if (maxPct > 0.8) return "high"
      if (maxPct > 0.6) return "medium"
      return "low"
    },

    shouldForceUnload: () => {
      const pressure = {
        trianglePct: budget.currentTriangles / budget.maxTriangles,
        drawCallPct: budget.currentDrawCalls / budget.maxDrawCalls,
        memoryPct: budget.currentTextureMemory / budget.maxTextureMemory,
      }

      return (
        pressure.trianglePct > config.unloadThresholdPct ||
        pressure.drawCallPct > config.unloadThresholdPct ||
        pressure.memoryPct > config.unloadThresholdPct
      )
    },

    getChunksToUnload: (loadedChunks, currentFrame) => {
      const sorted = [...loadedChunks.entries()].sort((a, b) => {
        return a[1].lastVisibleFrame - b[1].lastVisibleFrame
      })

      const toUnload: ChunkId[] = []
      let freedTriangles = 0
      let freedMemory = 0

      for (const [id, data] of sorted) {
        if (
          budget.currentTriangles - freedTriangles <= budget.maxTriangles * config.unloadThresholdPct &&
          budget.currentTextureMemory - freedMemory <= budget.maxTextureMemory * config.unloadThresholdPct
        ) {
          break
        }

        toUnload.push(id)
        freedTriangles += data.triangleCount
        freedMemory += data.textureMemory
      }

      return toUnload
    },
  }
}
