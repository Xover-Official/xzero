import { Effect, Context, Layer, Stream, PubSub, Queue } from "effect"
import type { Message, NodeInfo, NodeId } from "../core/types.js"
import { createMessage, createNodeInfo } from "../core/types.js"
import { makeEventBus, EventBus, EventBusLive, type EventBus as EventBusType } from "../core/events.js"
import type { CameraState, VisibilityResult, BudgetTracker, ChunkId, GeometryChunk, RendererConfig } from "./types.js"
import { defaultRendererConfig } from "./types.js"
import { makeFrustumCullingEngine, type FrustumCullingEngine } from "./culling.js"
import { makeOcclusionEngine, type OcclusionEngine } from "./occlusion.js"
import { makeLodManager, type LodManager } from "./lod.js"
import { makeStreamingEngine, type StreamingEngine } from "./streaming.js"
import { makeRenderScheduler, type RenderScheduler } from "./scheduler.js"
import { makeBudgetEngine, type BudgetEngine } from "./budget.js"

export type RendererEvent =
  | { type: "renderer:camera_moved"; camera: CameraState; timestamp: number }
  | { type: "renderer:chunks_visible"; chunks: VisibilityResult[]; timestamp: number }
  | { type: "renderer:chunks_loaded"; chunkIds: ChunkId[]; timestamp: number }
  | { type: "renderer:chunks_unloaded"; chunkIds: ChunkId[]; timestamp: number }
  | { type: "renderer:budget_pressure"; pressure: "low" | "medium" | "high" | "critical"; timestamp: number }
  | { type: "renderer:frame_complete"; frameNumber: number; elapsedMs: number; timestamp: number }

export class Renderer extends Context.Tag("xzero/Renderer")<
  Renderer,
  {
    readonly updateCamera: (camera: CameraState) => Effect.Effect<void>
    readonly processFrame: (frameNumber: number) => Effect.Effect<VisibilityResult[]>
    readonly getBudget: () => Effect.Effect<BudgetTracker>
    readonly getLoadedChunks: () => ChunkId[]
    readonly getConfig: () => RendererConfig
    readonly getStats: () => Effect.Effect<RendererStats>
  }
>() {}

export interface RendererStats {
  cullingTimeMs: number
  occlusionTimeMs: number
  lodTimeMs: number
  streamingTimeMs: number
  totalFrameTimeMs: number
  visibleChunks: number
  loadedChunks: number
  budgetPressure: "low" | "medium" | "high" | "critical"
}

export const makeRenderer = (config: Partial<RendererConfig> = {}) =>
  Effect.gen(function* () {
    const eventBus = yield* EventBus
    const cfg = { ...defaultRendererConfig, ...config }

    const cullingEngine = makeFrustumCullingEngine({
      chunkSize: cfg.chunkSize,
      viewDistance: cfg.viewDistance,
    })

    const occlusionEngine = makeOcclusionEngine({
      resolution: 256,
      depthBias: 0.001,
      cacheFrames: 3,
    })

    const lodManager = makeLodManager()
    const streamingEngine = makeStreamingEngine({
      preloadRadius: cfg.preloadRadius,
      unloadDelayFrames: cfg.unloadDelayFrames,
      maxConcurrentLoads: 4,
      streamingBandwidth: cfg.streamingBandwidth,
    })

    const scheduler = makeRenderScheduler({
      frameBudgetMs: cfg.frameBudgetMs,
      maxVisibleChunksPerFrame: 500,
      maxLoadOpsPerFrame: 4,
      maxUnloadOpsPerFrame: 8,
    })

    const budgetEngine = makeBudgetEngine({
      maxTriangles: cfg.maxTriangles,
      maxDrawCalls: cfg.maxDrawCalls,
      maxTextureMemory: cfg.maxTextureMemory,
      targetLoadedChunks: 100,
      unloadThresholdPct: 0.85,
    })

    const chunks = new Map<ChunkId, GeometryChunk>()
    let currentCamera: CameraState | null = null
    let frameNumber = 0
    const loadedChunkIds = new Set<ChunkId>()

    return {
      updateCamera: (camera: CameraState) =>
        Effect.gen(function* () {
          currentCamera = camera
          cullingEngine.rebuildSpatialIndex(chunks)

          yield* eventBus.publishEvent({
            type: "renderer:camera_moved",
            camera,
            timestamp: Date.now(),
          } as RendererEvent as any)
        }),

      processFrame: (frame: number) =>
        Effect.gen(function* () {
          frameNumber = frame
          const startTime = performance.now()

          if (!currentCamera) {
            return []
          }

          const cullResult = yield* cullingEngine.cullChunks(
            chunks,
            currentCamera,
            cfg.viewDistance
          )

          let visibleResults = cullResult.visible

          if (cfg.occlusionCulling) {
            const occlusionQueries = visibleResults.map((v) => ({
              id: v.chunkId,
              bounds: chunks.get(v.chunkId)?.bounds ?? { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 }, center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 0, y: 0, z: 0 } },
            }))

            const occlusionResults = yield* occlusionEngine.batchTestOcclusion(
              occlusionQueries,
              currentCamera,
              frame
            )

            visibleResults = visibleResults.filter((v) => {
              const occ = occlusionResults.get(v.chunkId)
              return !occ || occ.result !== "occluded"
            })
          }

          const budget = budgetEngine.getBudget()
          const schedule = yield* scheduler.scheduleFrame(
            currentCamera,
            visibleResults,
            budget,
            frame
          )

          const streamingResult = yield* streamingEngine.processStreamingQueue(
            budget,
            cfg.maxDrawCalls > 0 ? Math.min(4, cfg.maxDrawCalls / 100) : 4
          )

          for (const id of streamingResult.loaded) {
            loadedChunkIds.add(id)
          }
          for (const id of streamingResult.unloaded) {
            loadedChunkIds.delete(id)
          }

          const pressure = budgetEngine.getPressure()
          if (pressure === "high" || pressure === "critical") {
            yield* eventBus.publishEvent({
              type: "renderer:budget_pressure",
              pressure,
              timestamp: Date.now(),
            } as RendererEvent as any)
          }

          yield* eventBus.publishEvent({
            type: "renderer:chunks_visible",
            chunks: visibleResults,
            timestamp: Date.now(),
          } as RendererEvent as any)

          const elapsedMs = performance.now() - startTime

          yield* eventBus.publishEvent({
            type: "renderer:frame_complete",
            frameNumber: frame,
            elapsedMs,
            timestamp: Date.now(),
          } as RendererEvent as any)

          return visibleResults
        }),

      getBudget: () => Effect.succeed(budgetEngine.getBudget()),

      getLoadedChunks: () => [...loadedChunkIds],

      getConfig: () => cfg,

      getStats: () =>
        Effect.succeed({
          cullingTimeMs: 0,
          occlusionTimeMs: 0,
          lodTimeMs: 0,
          streamingTimeMs: 0,
          totalFrameTimeMs: 0,
          visibleChunks: 0,
          loadedChunks: loadedChunkIds.size,
          budgetPressure: budgetEngine.getPressure(),
        }),
    }
  })

export const RendererLive = (config?: Partial<RendererConfig>) =>
  Layer.effect(Renderer, makeRenderer(config)).pipe(
    Layer.provide(EventBusLive)
  )

export const makeRendererNodeInfo = (): Omit<NodeInfo, "id"> => ({
  ...createNodeInfo("rendering-ai", [
    "frustum_culling",
    "occlusion_culling",
    "lod_management",
    "asset_streaming",
    "budget_tracking",
    "lazy_rendering",
  ]),
})
