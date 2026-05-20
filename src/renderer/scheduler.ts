import { Effect, Ref } from "effect"
import type { RenderSchedule, CameraState, VisibilityResult, BudgetTracker, ChunkId } from "./types.js"

export interface RenderScheduler {
  readonly scheduleFrame: (
    camera: CameraState,
    visibleChunks: VisibilityResult[],
    budget: BudgetTracker,
    frameNumber: number
  ) => Effect.Effect<RenderSchedule>
  readonly allocateFrameBudget: (
    schedule: RenderSchedule,
    availableMs: number
  ) => Effect.Effect<RenderSchedule>
  readonly getTimeSlice: (
    schedule: RenderSchedule,
    task: string,
    weight: number
  ) => Effect.Effect<number>
  readonly isFrameComplete: (schedule: RenderSchedule) => boolean
  readonly getNextFrameTask: (schedule: RenderSchedule) => Effect.Effect<{ type: string; data: unknown } | null>
}

export function makeRenderScheduler(config: {
  frameBudgetMs: number
  maxVisibleChunksPerFrame: number
  maxLoadOpsPerFrame: number
  maxUnloadOpsPerFrame: number
}): RenderScheduler {
  return {
    scheduleFrame: (camera, visibleChunks, budget, frameNumber) =>
      Effect.gen(function* () {
        const sorted = [...visibleChunks].sort((a, b) => {
          const distDiff = a.distance - b.distance
          if (distDiff !== 0) return distDiff
          return b.screenCoverage - a.screenCoverage
        })

        const limited = sorted.slice(0, config.maxVisibleChunksPerFrame)

        const loadQueue: ChunkId[] = []
        const unloadQueue: ChunkId[] = []

        for (const chunk of limited) {
          if (chunk.lod <= 1 && chunk.distance < 200) {
            loadQueue.push(chunk.chunkId)
          }
        }

        return {
          frameNumber,
          camera,
          visibleChunks: limited,
          loadQueue,
          unloadQueue,
          budget,
          frameBudgetMs: config.frameBudgetMs,
          elapsedMs: 0,
        }
      }),

    allocateFrameBudget: (schedule, availableMs) =>
      Effect.gen(function* () {
        const cullingBudget = Math.floor(availableMs * 0.15)
        const lodBudget = Math.floor(availableMs * 0.1)
        const streamingBudget = Math.floor(availableMs * 0.2)
        const renderingBudget = Math.floor(availableMs * 0.5)
        const miscBudget = availableMs - cullingBudget - lodBudget - streamingBudget - renderingBudget

        return {
          ...schedule,
          frameBudgetMs: availableMs,
        }
      }),

    getTimeSlice: (schedule, task, weight) =>
      Effect.succeed(schedule.frameBudgetMs * weight),

    isFrameComplete: (schedule) =>
      schedule.elapsedMs >= schedule.frameBudgetMs,

    getNextFrameTask: (schedule) =>
      Effect.gen(function* () {
        if (schedule.loadQueue.length > 0) {
          return { type: "load", data: { chunkId: schedule.loadQueue.shift() } }
        }
        if (schedule.unloadQueue.length > 0) {
          return { type: "unload", data: { chunkId: schedule.unloadQueue.shift() } }
        }
        return null
      }),
  }
}
