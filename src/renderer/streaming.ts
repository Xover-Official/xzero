import { Effect, Ref, Queue } from "effect"
import type { ChunkId, GeometryChunk, StreamingPriority, BudgetTracker, Vec3, ChunkCoordinate } from "./types.js"
import { createChunkId, vec3Distance, worldToChunkCoord, visibleChunksInRadius } from "./types.js"

export interface AssetStreamRequest {
  chunkId: ChunkId
  priority: number
  reason: "distance" | "visibility" | "importance" | "prediction" | "lod_transition"
  distance: number
  estimatedSize: number
}

export interface StreamingEngine {
  readonly computeStreamingPriorities: (
    chunks: Map<ChunkId, GeometryChunk>,
    cameraPos: Vec3,
    viewDistance: number
  ) => Effect.Effect<StreamingPriority[]>
  readonly scheduleLoad: (
    request: AssetStreamRequest,
    budget: BudgetTracker
  ) => Effect.Effect<boolean>
  readonly scheduleUnload: (
    chunkId: ChunkId,
    budget: BudgetTracker
  ) => Effect.Effect<boolean>
  readonly processStreamingQueue: (
    budget: BudgetTracker,
    maxOperationsPerFrame: number
  ) => Effect.Effect<{ loaded: ChunkId[]; unloaded: ChunkId[] }>
  readonly addLoadRequest: (request: AssetStreamRequest) => void
  readonly addUnloadRequest: (chunkId: ChunkId) => void
  readonly getQueueSize: () => { pendingLoads: number; pendingUnloads: number }
}

export function makeStreamingEngine(config: {
  preloadRadius: number
  unloadDelayFrames: number
  maxConcurrentLoads: number
  streamingBandwidth: number
}): StreamingEngine {
  const loadQueue: AssetStreamRequest[] = []
  const unloadQueue: ChunkId[] = []
  const pendingLoads = new Set<ChunkId>()
  const pendingUnloads = new Set<ChunkId>()

  function computePriorityScore(
    chunk: GeometryChunk,
    cameraPos: Vec3,
    viewDistance: number
  ): StreamingPriority {
    const distance = vec3Distance(chunk.bounds.center, cameraPos)
    const normalizedDist = Math.min(distance / viewDistance, 1)
    const distanceScore = 1 - normalizedDist
    const visibilityScore = chunk.state === "visible" ? 1 : chunk.state === "occluded" ? 0.5 : 0.2
    const importanceScore = chunk.loadPriority / 100
    const predictionScore = chunk.lastVisibleFrame > 0 ? 0.3 : 0

    const score =
      distanceScore * 0.5 +
      visibilityScore * 0.25 +
      importanceScore * 0.15 +
      predictionScore * 0.1

    const reason: StreamingPriority["reason"] =
      distanceScore > 0.7 ? "distance" :
      visibilityScore > 0.8 ? "visibility" :
      importanceScore > 0.5 ? "importance" :
      predictionScore > 0.2 ? "prediction" :
      "lod_transition"

    return { chunkId: chunk.id, score, reason }
  }

  return {
    computeStreamingPriorities: (chunks, cameraPos, viewDistance) =>
      Effect.gen(function* () {
        const priorities: StreamingPriority[] = []

        for (const [, chunk] of chunks) {
          if (chunk.state === "loaded" || chunk.state === "visible") continue
          if (pendingLoads.has(chunk.id)) continue

          const priority = computePriorityScore(chunk, cameraPos, viewDistance)
          priorities.push(priority)
        }

        priorities.sort((a, b) => b.score - a.score)
        return priorities.slice(0, config.maxConcurrentLoads)
      }),

    scheduleLoad: (request, budget) =>
      Effect.gen(function* () {
        if (pendingLoads.size >= config.maxConcurrentLoads) return false
        if (budget.currentTriangles + 100_000 > budget.maxTriangles) return false
        if (budget.currentTextureMemory + request.estimatedSize > budget.maxTextureMemory) return false

        pendingLoads.add(request.chunkId)
        loadQueue.push(request)
        return true
      }),

    scheduleUnload: (chunkId, budget) =>
      Effect.gen(function* () {
        pendingUnloads.add(chunkId)
        unloadQueue.push(chunkId)
        return true
      }),

    processStreamingQueue: (budget, maxOperationsPerFrame) =>
      Effect.gen(function* () {
        const loaded: ChunkId[] = []
        const unloaded: ChunkId[] = []
        let opsThisFrame = 0

        while (unloadQueue.length > 0 && opsThisFrame < maxOperationsPerFrame) {
          const chunkId = unloadQueue.shift()!
          pendingUnloads.delete(chunkId)
          unloaded.push(chunkId)
          budget.currentDrawCalls = Math.max(0, budget.currentDrawCalls - 1)
          budget.currentLoadedChunks--
          opsThisFrame++
        }

        loadQueue.sort((a, b) => b.priority - a.priority)

        while (loadQueue.length > 0 && opsThisFrame < maxOperationsPerFrame) {
          const request = loadQueue.shift()!
          pendingLoads.delete(request.chunkId)
          loaded.push(request.chunkId)
          budget.currentDrawCalls++
          budget.currentLoadedChunks++
          opsThisFrame++
        }

        return { loaded, unloaded }
      }),

    addLoadRequest: (request) => {
      if (!pendingLoads.has(request.chunkId)) {
        pendingLoads.add(request.chunkId)
        loadQueue.push(request)
      }
    },

    addUnloadRequest: (chunkId) => {
      if (!pendingUnloads.has(chunkId)) {
        pendingUnloads.add(chunkId)
        unloadQueue.push(chunkId)
      }
    },

    getQueueSize: () => ({
      pendingLoads: pendingLoads.size,
      pendingUnloads: pendingUnloads.size,
    }),
  }
}
