import { Effect, Ref, Schedule, Stream, PubSub } from "effect"
import { makeBoundaryTriggerSystem, type BoundaryTriggerSystem } from "./core/boundary-trigger.js"
import type { PlayerPosition, ChunkLifecycleEvent } from "./core/boundary-trigger.js"
import { makePCGAssembler, type PCGAssembler } from "./pcg/assembler.js"
import { makeFrustumCullingEngine } from "./renderer/culling.js"
import { makeOcclusionEngine } from "./renderer/occlusion.js"
import { makeStreamingEngine } from "./renderer/streaming.js"
import { makeRendererPCGBridge, type RendererPCGBridge } from "./pcg/renderer-pcg-bridge.js"
import { makeBatchInferenceScheduler, type BatchInferenceScheduler } from "./pcg/psychological-node.js"
import type { StudentProfile } from "./pcg/psychological-node.js"
import { defaultConfig, type CoordinatorConfig } from "./core/types.js"
import { makeGameEngine, type GameEngine, type GameEvent } from "./game/game-engine.js"
import type { RareTileInstance } from "./game/rare-tiles.js"

export interface XZeroApp {
  readonly start: () => Effect.Effect<void>
  readonly stop: () => Effect.Effect<void>
  readonly updatePlayerPosition: (pos: PlayerPosition) => Effect.Effect<void>
  readonly addNPC: (student: StudentProfile) => Effect.Effect<void>
  readonly helpNPC: (npcId: string) => Effect.Effect<void>
  readonly talkToNPC: (npcId: string) => Effect.Effect<string>
  readonly getStats: () => Effect.Effect<AppStats>
  readonly getShareCode: () => Effect.Effect<string>
  readonly getGameEvents: () => Effect.Effect<Stream.Stream<GameEvent>>
}

export interface AppStats {
  frameNumber: number
  fps: number
  loadedChunks: number
  generatedChunks: number
  visibleChunks: number
  npcCount: number
  avgInferenceMs: number
  budgetTriangles: number
  budgetDrawCalls: number
  playerStress: number
  npcsHelped: number
  rareDiscoveries: number
  chunksExplored: number
  currentSchool: string
}

export interface AppConfig {
  readonly chunkSize: number
  readonly viewDistance: number
  readonly inferenceIntervalMs: number
  readonly maxBatchSize: number
  readonly mazeMode: boolean
  readonly seed: number
  readonly schoolName?: string
  readonly coordinatorConfig: CoordinatorConfig
}

export const defaultAppConfig: AppConfig = {
  chunkSize: 64,
  viewDistance: 500,
  inferenceIntervalMs: 3000,
  maxBatchSize: 20,
  mazeMode: true,
  seed: 42,
  coordinatorConfig: defaultConfig,
}

export function makeXZeroApp(config: AppConfig = defaultAppConfig): Effect.Effect<XZeroApp> {
  return Effect.gen(function* () {
    const pcgAssembler = makePCGAssembler(config.seed)
    const cullingEngine = makeFrustumCullingEngine({ chunkSize: config.chunkSize, viewDistance: config.viewDistance })
    const occlusionEngine = makeOcclusionEngine({ resolution: 64, depthBias: 0.001, cacheFrames: 3 })
    const streamingEngine = makeStreamingEngine({
      preloadRadius: 1.5,
      unloadDelayFrames: 60,
      maxConcurrentLoads: 4,
      streamingBandwidth: 50 * 1024 * 1024,
    })
    const rendererBridge = makeRendererPCGBridge(
      cullingEngine,
      occlusionEngine,
      streamingEngine,
      pcgAssembler,
      config.viewDistance
    )
    const boundaryTrigger = yield* makeBoundaryTriggerSystem(config.chunkSize)
    const batchScheduler = makeBatchInferenceScheduler({
      inferenceIntervalMs: config.inferenceIntervalMs,
      maxBatchSize: config.maxBatchSize,
      staggerOffsetMs: 500,
    })
    const gameEngine = yield* makeGameEngine()

    const frameNumberRef = yield* Ref.make(0)
    const lastFrameTimeRef = yield* Ref.make(Date.now())
    const fpsRef = yield* Ref.make(60)
    const isRunningRef = yield* Ref.make(false)

    rendererBridge.onMazeComplexityChange((chunkId, complexity) => {
      console.log(`[xzero] Maze complexity spike in ${chunkId}: score=${complexity.complexityScore.toFixed(2)}`)
    })

    const handleBoundaryEvent = (event: ChunkLifecycleEvent) => Effect.gen(function* () {
      switch (event.type) {
        case "chunk_load":
          yield* pcgAssembler.generateInfiniteChunk(
            event.chunk.x,
            event.chunk.z,
            config.chunkSize,
            config.mazeMode
          )
          break

        case "chunk_unload":
          break

        case "chunk_collapse":
          yield* pcgAssembler.generateInfiniteChunk(
            event.chunk.x,
            event.chunk.z,
            config.chunkSize,
            config.mazeMode
          )
          break
      }
    })

    const gameLoop = Effect.gen(function* () {
      const now = Date.now()
      const lastFrameTime = yield* Ref.get(lastFrameTimeRef)
      const deltaTime = now - lastFrameTime

      yield* Ref.set(lastFrameTimeRef, now)

      const frameNumber = yield* Ref.get(frameNumberRef)
      yield* Ref.set(frameNumberRef, frameNumber + 1)

      if (deltaTime > 0) {
        const currentFps = 1000 / deltaTime
        const prevFps = yield* Ref.get(fpsRef)
        yield* Ref.set(fpsRef, prevFps * 0.9 + currentFps * 0.1)
      }

      const renderResult = yield* rendererBridge.processFrame(frameNumber + 1)

      const npcActions = yield* batchScheduler.tick(deltaTime)
      if (npcActions) {
        for (const [npcId, action] of npcActions) {
          console.log(`[xzero] NPC ${npcId}: ${action.type} (${action.duration}s)`)
        }
      }

      yield* gameEngine.tick(deltaTime)

      return {
        frameNumber: frameNumber + 1,
        renderResult,
        npcActions,
      }
    }).pipe(
      Effect.repeat(Schedule.spaced(16)),
      Effect.catchAll((err) => Effect.succeed(console.error("[xzero] Game loop error:", err)))
    )

    return {
      start: () =>
        Effect.gen(function* () {
          yield* Ref.set(isRunningRef, true)
          console.log("[xzero] Starting XZero application...")
          console.log(`[xzero] Config: chunkSize=${config.chunkSize}, viewDistance=${config.viewDistance}, mazeMode=${config.mazeMode}`)

          yield* gameEngine.initialize(config.seed, config.schoolName)

          const school = yield* gameEngine.getSchool()
          if (school) {
            console.log(`[xzero] School: ${school.name}`)
            console.log(`[xzero] Share code: ${school.shareCode}`)
          }

          const lifecycleStream = yield* boundaryTrigger.subscribeLifecycleEvents()
          yield* Stream.runForEach(lifecycleStream, handleBoundaryEvent).pipe(Effect.forkDaemon)

          yield* gameLoop.pipe(Effect.forkDaemon)

          console.log("[xzero] XZero application started successfully")
        }),

      stop: () =>
        Effect.gen(function* () {
          yield* Ref.set(isRunningRef, false)
          console.log("[xzero] XZero application stopped")
        }),

      updatePlayerPosition: (pos: PlayerPosition) =>
        Effect.gen(function* () {
          const event = yield* boundaryTrigger.updatePlayerPosition(pos)

          if (event) {
            yield* gameEngine.updatePlayerPosition(pos.x, pos.y, pos.z)

            const camera = {
              position: { x: pos.x, y: pos.y, z: pos.z },
              forward: { x: 0, y: 0, z: -1 },
              up: { x: 0, y: 1, z: 0 },
              right: { x: 1, y: 0, z: 0 },
              fov: Math.PI / 3,
              aspectRatio: 16 / 9,
              nearPlane: 0.1,
              farPlane: 1000,
              viewMatrix: { elements: new Float32Array(16) },
              projectionMatrix: { elements: new Float32Array(16) },
              frustum: {
                planes: [],
                corners: [],
                center: { x: pos.x, y: pos.y, z: pos.z },
                radius: config.viewDistance,
              },
            }

            yield* rendererBridge.updateCamera(camera)
          }
        }),

      addNPC: (student: StudentProfile) =>
        batchScheduler.addStudent(student),

      helpNPC: (npcId: string) =>
        Effect.gen(function* () {
          const result = yield* gameEngine.helpNPC(npcId)
          if (result) {
            console.log(`[xzero] Helped NPC ${npcId}: ${result.previousMood} → ${result.newMood}`)
            if (result.chunkTransformTriggered) {
              console.log(`[xzero] Chunk transformed! The environment shifts around you.`)
            }
          }
        }),

      talkToNPC: (npcId: string) =>
        gameEngine.interactWithNPC(npcId),

      getStats: () =>
        Effect.gen(function* () {
          const frameNumber = yield* Ref.get(frameNumberRef)
          const fps = yield* Ref.get(fpsRef)
          const loadedChunks = rendererBridge.getLoadedChunks().size
          const generatedChunks = rendererBridge.getGeneratedChunks().size
          const npcs = yield* batchScheduler.getStudents()
          const inferenceStats = yield* batchScheduler.getStats()
          const school = yield* gameEngine.getSchool()
          const worldState = yield* gameEngine.getWorldState()

          return {
            frameNumber,
            fps: Math.round(fps),
            loadedChunks,
            generatedChunks,
            visibleChunks: loadedChunks,
            npcCount: npcs.length,
            avgInferenceMs: inferenceStats.avgInferenceDurationMs,
            budgetTriangles: 0,
            budgetDrawCalls: loadedChunks,
            playerStress: worldState.playerStress.currentStress,
            npcsHelped: school?.stats.npcsHelped ?? 0,
            rareDiscoveries: school?.stats.rareTilesDiscovered ?? 0,
            chunksExplored: school?.stats.totalChunksExplored ?? 0,
            currentSchool: school?.name ?? "None",
          }
        }),

      getShareCode: () =>
        gameEngine.getShareCode(),

      getGameEvents: () =>
        gameEngine.getEventStream(),
    }
  })
}

export function createAndRunXZero(config?: Partial<AppConfig>): Effect.Effect<void> {
  const appConfig = { ...defaultAppConfig, ...config }

  return Effect.gen(function* () {
    const app = yield* makeXZeroApp(appConfig)
    yield* app.start()
    yield* Effect.never
  })
}
