import { Effect, Ref, Layer } from "effect"
import type { ChunkId, GeometryChunk, CameraState, VisibilityResult, BudgetTracker } from "../renderer/types.js"
import {
  createAABB,
  createSphere,
  createChunkId,
  worldToChunkCoord,
  vec3Distance,
  chunkCoordToWorld,
} from "../renderer/types.js"
import type { FrustumCullingEngine } from "../renderer/culling.js"
import type { OcclusionEngine } from "../renderer/occlusion.js"
import type { StreamingEngine } from "../renderer/streaming.js"
import type { PCGAssembler } from "../pcg/assembler.js"
import type { Tile } from "../pcg/types.js"
import { TILE_DEFINITIONS } from "../pcg/mext-data.js"

export interface RendererPCGBridge {
  readonly updateCamera: (camera: CameraState) => Effect.Effect<void>
  readonly processFrame: (frameNumber: number) => Effect.Effect<{
    visible: VisibilityResult[]
    loaded: ChunkId[]
    unloaded: ChunkId[]
    generated: number
  }>
  readonly getLoadedChunks: () => Set<ChunkId>
  readonly getGeneratedChunks: () => Map<ChunkId, Map<string, Tile>>
  readonly setViewDistance: (distance: number) => void
  readonly getViewDistance: () => number
  readonly onMazeComplexityChange: (callback: (chunkId: ChunkId, complexity: MazeComplexity) => void) => void
  readonly getMazeComplexity: (chunkId: ChunkId) => MazeComplexity | null
}

export interface MazeComplexity {
  branchCount: number
  deadEndCount: number
  crossCount: number
  loopCount: number
  complexityScore: number       // 0-1, normalized complexity
  cullingAggression: number     // 0-1, how aggressively to cull
  budgetMultiplier: number      // <1 = reduce budget, >1 = increase
}

const CHUNK_SIZE = 64
const TILE_TO_WORLD_SCALE = 4
const MAZE_COMPLEXITY_THRESHOLD = 0.6  // Above this, trigger aggressive culling

function tileToGeometryChunk(
  chunkId: ChunkId,
  chunkX: number,
  chunkZ: number,
  tiles: Map<string, Tile>,
  frameNumber: number
): GeometryChunk {
  const worldPos = chunkCoordToWorld({ x: chunkX, z: chunkZ, level: 0 }, CHUNK_SIZE)

  let totalTriangles = 0
  let totalTextureMemory = 0
  let vertexCount = 0

  for (const [, tile] of tiles) {
    const tileDef = TILE_DEFINITIONS[tile.typeId]
    if (!tileDef) continue

    const baseTriangles = 200
    const baseVertices = 400
    const baseTexture = 512 * 1024

    totalTriangles += baseTriangles
    vertexCount += baseVertices
    totalTextureMemory += baseTexture
  }

  const halfSize = CHUNK_SIZE / 2

  return {
    id: chunkId,
    coord: { x: chunkX, z: chunkZ, level: 0 },
    state: "loaded",
    lod: 0,
    mesh: undefined,
    material: undefined,
    bounds: createAABB(
      { x: worldPos.x - halfSize, y: -5, z: worldPos.z - halfSize },
      { x: worldPos.x + halfSize, y: 20, z: worldPos.z + halfSize }
    ),
    boundingSphere: createSphere(
      { x: worldPos.x, y: 7.5, z: worldPos.z },
      halfSize * 1.2
    ),
    vertexCount,
    triangleCount: totalTriangles,
    textureMemoryBytes: totalTextureMemory,
    lastVisibleFrame: frameNumber,
    loadPriority: 50,
    distanceToCamera: 0,
  }
}

export function makeRendererPCGBridge(
  cullingEngine: FrustumCullingEngine,
  occlusionEngine: OcclusionEngine,
  streamingEngine: StreamingEngine,
  pcgAssembler: PCGAssembler,
  initialViewDistance: number = 500
): RendererPCGBridge {
  const loadedChunks = new Set<ChunkId>()
  const generatedChunks = new Map<ChunkId, Map<string, Tile>>()
  const chunkGeometry = new Map<ChunkId, GeometryChunk>()
  const mazeComplexityMap = new Map<ChunkId, MazeComplexity>()
  let viewDistance = initialViewDistance
  let currentCamera: CameraState | null = null
  let frameNumber = 0
  let complexityCallback: ((chunkId: ChunkId, complexity: MazeComplexity) => void) | null = null

  function analyzeMazeComplexity(tiles: Map<string, Tile>): MazeComplexity {
    let branchCount = 0
    let deadEndCount = 0
    let crossCount = 0
    let loopCount = 0

    for (const [, tile] of tiles) {
      const typeId = tile.typeId
      if (typeId.includes("branch")) branchCount++
      else if (typeId.includes("dead_end")) deadEndCount++
      else if (typeId.includes("cross")) crossCount++
      else if (typeId.includes("loop_connector")) loopCount++
    }

    const totalTiles = tiles.size
    const junctionCount = branchCount + crossCount
    const complexityScore = Math.min(1, (junctionCount + deadEndCount * 0.5) / (totalTiles * 0.3))

    // Higher complexity = more aggressive culling needed
    const cullingAggression = complexityScore > MAZE_COMPLEXITY_THRESHOLD
      ? 0.5 + complexityScore * 0.5
      : complexityScore * 0.5

    // Complex mazes get reduced budget to maintain performance
    const budgetMultiplier = complexityScore > 0.8 ? 0.7 : complexityScore > 0.6 ? 0.85 : 1.0

    return {
      branchCount,
      deadEndCount,
      crossCount,
      loopCount,
      complexityScore,
      cullingAggression,
      budgetMultiplier,
    }
  }

  function getChunksInRadius(cameraPos: { x: number; y: number; z: number }, radius: number): { x: number; z: number }[] {
    const cameraCoord = worldToChunkCoord(cameraPos, CHUNK_SIZE)
    const chunkRadius = Math.ceil(radius / CHUNK_SIZE)
    const chunks: { x: number; z: number }[] = []

    for (let x = cameraCoord.x - chunkRadius; x <= cameraCoord.x + chunkRadius; x++) {
      for (let z = cameraCoord.z - chunkRadius; z <= cameraCoord.z + chunkRadius; z++) {
        chunks.push({ x, z })
      }
    }

    return chunks
  }

  async function ensureChunkGenerated(chunkX: number, chunkZ: number): Promise<Map<string, Tile>> {
    const chunkId = createChunkId({ x: chunkX, z: chunkZ, level: 0 })

    if (generatedChunks.has(chunkId)) {
      return generatedChunks.get(chunkId)!
    }

    const result = await pcgAssembler.generateInfiniteChunk(chunkX, chunkZ, CHUNK_SIZE).pipe(Effect.runPromise)
    generatedChunks.set(chunkId, result.tiles)

    // Analyze maze complexity immediately upon generation
    const complexity = analyzeMazeComplexity(result.tiles)
    mazeComplexityMap.set(chunkId, complexity)

    // Notify listeners if complexity is high
    if (complexity.complexityScore > MAZE_COMPLEXITY_THRESHOLD && complexityCallback) {
      complexityCallback(chunkId, complexity)
    }

    return result.tiles
  }

  function ensureChunkGeneratedEffect(chunkX: number, chunkZ: number) {
    return Effect.gen(function* () {
      const chunkId = createChunkId({ x: chunkX, z: chunkZ, level: 0 })

      if (generatedChunks.has(chunkId)) {
        return generatedChunks.get(chunkId)!
      }

      const result = yield* pcgAssembler.generateInfiniteChunk(chunkX, chunkZ, CHUNK_SIZE)
      generatedChunks.set(chunkId, result.tiles)

      // Analyze maze complexity immediately upon generation
      const complexity = analyzeMazeComplexity(result.tiles)
      mazeComplexityMap.set(chunkId, complexity)

      // Notify listeners if complexity is high
      if (complexity.complexityScore > MAZE_COMPLEXITY_THRESHOLD && complexityCallback) {
        complexityCallback(chunkId, complexity)
      }

      return result.tiles
    })
  }

  return {
    updateCamera: (camera) =>
      Effect.gen(function* () {
        currentCamera = camera
        frameNumber++

        const nearbyChunks = getChunksInRadius(camera.position, viewDistance)

        for (const chunk of nearbyChunks) {
          const chunkId = createChunkId({ x: chunk.x, z: chunk.z, level: 0 })

          if (!generatedChunks.has(chunkId)) {
            yield* ensureChunkGeneratedEffect(chunk.x, chunk.z)
          }

          if (!chunkGeometry.has(chunkId)) {
            const tiles = generatedChunks.get(chunkId)!
            const tileMap = new Map<string, Tile>()
            for (const [key, tile] of tiles) {
              const worldPos = chunkCoordToWorld({ x: chunk.x, z: chunk.z, level: 0 }, CHUNK_SIZE)
              tileMap.set(`${worldPos.x},${worldPos.z}_${key}`, tile)
            }

            const geometryChunk = tileToGeometryChunk(chunkId, chunk.x, chunk.z, tileMap, frameNumber)
            chunkGeometry.set(chunkId, geometryChunk)
          }
        }

        cullingEngine.rebuildSpatialIndex(chunkGeometry)
      }),

    processFrame: (frame) =>
      Effect.gen(function* () {
        frameNumber = frame
        if (!currentCamera) {
          return { visible: [], loaded: [], unloaded: [], generated: 0 }
        }

        // Compute average maze complexity for nearby chunks to adjust budget
        let avgComplexity = 0
        let complexityCount = 0
        const nearbyChunks = getChunksInRadius(currentCamera.position, viewDistance)
        for (const chunk of nearbyChunks) {
          const chunkId = createChunkId({ x: chunk.x, z: chunk.z, level: 0 })
          const complexity = mazeComplexityMap.get(chunkId)
          if (complexity) {
            avgComplexity += complexity.complexityScore
            complexityCount++
          }
        }
        avgComplexity = complexityCount > 0 ? avgComplexity / complexityCount : 0

        // Adjust view distance based on maze complexity
        const effectiveViewDistance = avgComplexity > 0.7
          ? viewDistance * 0.7  // Reduce view distance in complex mazes
          : avgComplexity > 0.5
            ? viewDistance * 0.85
            : viewDistance

        const cullResult = yield* cullingEngine.cullChunks(
          chunkGeometry,
          currentCamera,
          effectiveViewDistance
        )

        let visibleResults = cullResult.visible

        // Aggressive occlusion for high-complexity chunks
        if (avgComplexity > MAZE_COMPLEXITY_THRESHOLD) {
          visibleResults = visibleResults.filter((v) => {
            const complexity = mazeComplexityMap.get(v.chunkId)
            if (complexity && complexity.cullingAggression > 0.7) {
              // High-complexity chunks need stricter occlusion testing
              return v.distance < effectiveViewDistance * 0.5
            }
            return true
          })
        }

        const occlusionQueries = visibleResults.map((v) => {
          const chunk = chunkGeometry.get(v.chunkId)
          return {
            id: v.chunkId,
            bounds: chunk?.bounds ?? createAABB(
              { x: 0, y: 0, z: 0 },
              { x: 0, y: 0, z: 0 }
            ),
          }
        })

        if (occlusionQueries.length > 0) {
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

        // Budget adjustment based on maze complexity
        const budgetMultiplier = avgComplexity > 0.7 ? 0.7 : avgComplexity > 0.5 ? 0.85 : 1.0

        const budget: BudgetTracker = {
          maxTriangles: Math.floor(5_000_000 * budgetMultiplier),
          maxDrawCalls: Math.floor(2000 * budgetMultiplier),
          maxTextureMemory: Math.floor(512 * 1024 * 1024 * budgetMultiplier),
          currentTriangles: 0,
          currentDrawCalls: loadedChunks.size,
          currentTextureMemory: 0,
          currentLoadedChunks: loadedChunks.size,
          targetLoadedChunks: Math.floor(100 * budgetMultiplier),
        }

        for (const v of visibleResults) {
          const chunk = chunkGeometry.get(v.chunkId)
          if (chunk) {
            budget.currentTriangles += chunk.triangleCount
            budget.currentTextureMemory += chunk.textureMemoryBytes
          }
        }

        const streamingResult = yield* streamingEngine.processStreamingQueue(
          budget,
          4
        )

        for (const id of streamingResult.loaded) {
          loadedChunks.add(id)
          const chunk = chunkGeometry.get(id)
          if (chunk) {
            chunk.state = "visible"
            chunk.lastVisibleFrame = frameNumber
          }
        }

        for (const id of streamingResult.unloaded) {
          loadedChunks.delete(id)
          const chunk = chunkGeometry.get(id)
          if (chunk) {
            chunk.state = "unloaded"
          }
        }

        for (const v of visibleResults) {
          if (!loadedChunks.has(v.chunkId)) {
            streamingEngine.addLoadRequest({
              chunkId: v.chunkId,
              priority: 100 - v.distance,
              reason: "visibility",
              distance: v.distance,
              estimatedSize: 1024 * 1024,
            })
          }
        }

        for (const chunk of nearbyChunks) {
          const chunkId = createChunkId({ x: chunk.x, z: chunk.z, level: 0 })
          if (!generatedChunks.has(chunkId)) {
            yield* ensureChunkGeneratedEffect(chunk.x, chunk.z)
          }
        }

        return {
          visible: visibleResults,
          loaded: streamingResult.loaded,
          unloaded: streamingResult.unloaded,
          generated: generatedChunks.size,
        }
      }),

    getLoadedChunks: () => loadedChunks,

    getGeneratedChunks: () => generatedChunks,

    setViewDistance: (distance) => { viewDistance = distance },

    getViewDistance: () => viewDistance,

    onMazeComplexityChange: (callback) => {
      complexityCallback = callback
    },

    getMazeComplexity: (chunkId) => mazeComplexityMap.get(chunkId) ?? null,
  }
}

export const RendererPCGBridgeLive = (
  cullingEngine: FrustumCullingEngine,
  occlusionEngine: OcclusionEngine,
  streamingEngine: StreamingEngine,
  pcgAssembler: PCGAssembler,
  viewDistance?: number
) =>
  Layer.succeed(
    RendererPCGBridgeTag,
    makeRendererPCGBridge(cullingEngine, occlusionEngine, streamingEngine, pcgAssembler, viewDistance)
  )

export class RendererPCGBridgeTag extends Effect.Tag("xzero/RendererPCGBridge")<
  RendererPCGBridgeTag,
  RendererPCGBridge
>() {}
