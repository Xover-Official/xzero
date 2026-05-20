import { Effect } from "effect"
import {
  createAABB,
  createSphere,
  createChunkId,
  createPlane,
  planeDistanceToPoint,
  vec3Distance,
  worldToChunkCoord,
  chunkCoordToWorld,
  createChunkId,
  parseChunkId,
  vec3Add,
  vec3Sub,
  vec3Scale,
  vec3Normalize,
  vec3Dot,
  vec3Cross,
  vec3Length,
  lerp,
  clamp,
  visibleChunksInRadius,
  defaultRendererConfig,
  LOD_CONFIGS,
} from "../src/renderer/types.js"
import {
  aabbOnFrustumPlane,
  sphereOnFrustumPlane,
  isAABBInFrustum,
  isSphereInFrustum,
  createSpatialIndex,
  cellKey,
  cellKeyFromCoord,
  makeFrustumCullingEngine,
} from "../src/renderer/culling.js"
import { makeOcclusionEngine } from "../src/renderer/occlusion.js"
import { DefaultLodSelector, makeLodManager } from "../src/renderer/lod.js"
import { makeStreamingEngine } from "../src/renderer/streaming.js"
import { makeRenderScheduler } from "../src/renderer/scheduler.js"
import { makeBudgetEngine } from "../src/renderer/budget.js"
import type { AABB, Sphere, Frustum, Vec3, ChunkCoordinate, GeometryChunk, CameraState } from "../src/renderer/types.js"

console.log("=== XZero Rendering AI Test Suite ===\n")

async function test(name: string, fn: () => Promise<boolean>) {
  try {
    const result = await fn()
    if (result) {
      console.log(`  PASS: ${name}`)
    } else {
      console.log(`  FAIL: ${name}`)
      process.exitCode = 1
    }
  } catch (err) {
    console.log(`  FAIL: ${name} - ${err}`)
    process.exitCode = 1
  }
}

function createTestAABB(x: number, y: number, z: number, size: number): AABB {
  const half = size / 2
  return createAABB(
    { x: x - half, y: y - half, z: z - half },
    { x: x + half, y: y + half, z: z + half }
  )
}

function createTestSphere(x: number, y: number, z: number, radius: number): Sphere {
  return createSphere({ x, y, z }, radius)
}

function createTestFrustum(center: Vec3, radius: number): Frustum {
  const planes = [
    createPlane({ x: 1, y: 0, z: 0 }, center.x + radius),
    createPlane({ x: -1, y: 0, z: 0 }, -center.x + radius),
    createPlane({ x: 0, y: 1, z: 0 }, center.y + radius),
    createPlane({ x: 0, y: -1, z: 0 }, -center.y + radius),
    createPlane({ x: 0, y: 0, z: 1 }, center.z + radius),
    createPlane({ x: 0, y: 0, z: -1 }, -center.z + radius),
  ]
  return { planes, corners: [], center, radius }
}

function createTestChunk(id: string, x: number, z: number, size: number): GeometryChunk {
  const center = { x: x * size, y: 0, z: z * size }
  return {
    id,
    coord: { x, z, level: 0 },
    state: "loaded" as const,
    lod: 0 as const,
    bounds: createTestAABB(center.x, 0, center.z, size),
    boundingSphere: createTestSphere(center.x, 0, center.z, size / 2),
    vertexCount: 1000,
    triangleCount: 500,
    textureMemoryBytes: 1024 * 1024,
    lastVisibleFrame: 0,
    loadPriority: 50,
    distanceToCamera: 0,
  }
}

function createTestCamera(pos: Vec3): CameraState {
  return {
    position: pos,
    forward: { x: 0, y: 0, z: -1 },
    up: { x: 0, y: 1, z: 0 },
    right: { x: 1, y: 0, z: 0 },
    fov: Math.PI / 3,
    aspectRatio: 16 / 9,
    nearPlane: 0.1,
    farPlane: 1000,
    viewMatrix: { elements: new Float32Array(16) },
    projectionMatrix: { elements: new Float32Array(16) },
    frustum: createTestFrustum(pos, 500),
  }
}

async function runTests() {
  console.log("1. Type & Utility Tests")

  await test("create and parse chunk IDs", async () => {
    const coord: ChunkCoordinate = { x: 5, z: -3, level: 0 }
    const id = createChunkId(coord)
    const parsed = parseChunkId(id)
    return parsed.x === 5 && parsed.z === -3 && parsed.level === 0
  })

  await test("AABB creation and properties", async () => {
    const aabb = createTestAABB(10, 20, 30, 10)
    return (
      aabb.center.x === 10 &&
      aabb.center.y === 20 &&
      aabb.center.z === 30 &&
      aabb.halfExtents.x === 5
    )
  })

  await test("sphere creation and properties", async () => {
    const sphere = createTestSphere(5, 10, 15, 25)
    return (
      sphere.center.x === 5 &&
      sphere.center.y === 10 &&
      sphere.center.z === 15 &&
      sphere.radius === 25
    )
  })

  await test("vector operations", async () => {
    const a = { x: 1, y: 2, z: 3 }
    const b = { x: 4, y: 5, z: 6 }

    const sub = vec3Sub(b, a)
    const add = vec3Add(a, b)
    const scale = vec3Scale(a, 2)
    const dot = vec3Dot(a, b)
    const cross = vec3Cross(a, b)
    const len = vec3Length(a)
    const norm = vec3Normalize(a)
    const dist = vec3Distance(a, b)

    return (
      sub.x === 3 && sub.y === 3 && sub.z === 3 &&
      add.x === 5 && add.y === 7 && add.z === 9 &&
      scale.x === 2 && scale.y === 4 && scale.z === 6 &&
      dot === 32 &&
      Math.abs(cross.x - (-3)) < 0.001 &&
      Math.abs(len - 3.7416) < 0.01 &&
      Math.abs(vec3Length(norm) - 1) < 0.001 &&
      Math.abs(dist - 5.196) < 0.01
    )
  })

  await test("lerp and clamp", async () => {
    return (
      lerp(0, 10, 0.5) === 5 &&
      clamp(15, 0, 10) === 10 &&
      clamp(-5, 0, 10) === 0 &&
      clamp(5, 0, 10) === 5
    )
  })

  await test("chunk coordinate conversion", async () => {
    const pos = { x: 130, y: 0, z: -65 }
    const coord = worldToChunkCoord(pos, 64)
    return coord.x === 2 && coord.z === -2
  })

  await test("visible chunks in radius", async () => {
    const center: ChunkCoordinate = { x: 0, z: 0, level: 0 }
    const chunks = visibleChunksInRadius(center, 1)
    return chunks.length === 9
  })

  await test("default renderer config is valid", async () => {
    return (
      defaultRendererConfig.chunkSize === 64 &&
      defaultRendererConfig.maxTriangles === 5_000_000 &&
      defaultRendererConfig.frameBudgetMs === 16
    )
  })

  await test("LOD configs are ordered", async () => {
    return (
      LOD_CONFIGS[0].maxDistance < LOD_CONFIGS[1].maxDistance &&
      LOD_CONFIGS[1].maxDistance < LOD_CONFIGS[2].maxDistance &&
      LOD_CONFIGS[4].maxDistance === Infinity
    )
  })

  console.log("\n2. Frustum Culling Tests")

  await test("AABB inside frustum", async () => {
    const frustum = createTestFrustum({ x: 0, y: 0, z: 0 }, 100)
    const aabb = createTestAABB(0, 0, 0, 10)
    return isAABBInFrustum(aabb, frustum)
  })

  await test("AABB outside frustum", async () => {
    const frustum = createTestFrustum({ x: 0, y: 0, z: 0 }, 10)
    const aabb = createTestAABB(100, 100, 100, 10)
    return !isAABBInFrustum(aabb, frustum)
  })

  await test("sphere inside frustum", async () => {
    const frustum = createTestFrustum({ x: 0, y: 0, z: 0 }, 100)
    const sphere = createTestSphere(0, 0, 0, 5)
    return isSphereInFrustum(sphere, frustum)
  })

  await test("sphere outside frustum", async () => {
    const frustum = createTestFrustum({ x: 0, y: 0, z: 0 }, 10)
    const sphere = createTestSphere(100, 100, 100, 5)
    return !isSphereInFrustum(sphere, frustum)
  })

  await test("plane distance to point", async () => {
    const plane = createPlane({ x: 1, y: 0, z: 0 }, -10)
    const point = { x: 15, y: 0, z: 0 }
    return Math.abs(planeDistanceToPoint(plane, point) - 5) < 0.001
  })

  await test("spatial index creation", async () => {
    const index = createSpatialIndex(64)
    return index.cellSize === 64 && index.cells.size === 0
  })

  await test("spatial index cell key generation", async () => {
    return cellKey(5, -3) === "5,-3"
  })

  await test("frustum culling engine creates successfully", async () => {
    const engine = makeFrustumCullingEngine({ chunkSize: 64, viewDistance: 500 })
    return engine.getSpatialIndex() !== null
  })

  await test("spatial index rebuild", async () => {
    const engine = makeFrustumCullingEngine({ chunkSize: 64, viewDistance: 500 })
    const chunks = new Map()
    chunks.set("0,0@0", createTestChunk("0,0@0", 0, 0, 64))
    chunks.set("1,0@0", createTestChunk("1,0@0", 1, 0, 64))
    engine.rebuildSpatialIndex(chunks)
    return engine.getSpatialIndex().cells.size > 0
  })

  console.log("\n3. Occlusion Engine Tests")

  await test("occlusion engine creates successfully", async () => {
    const engine = makeOcclusionEngine({ resolution: 64, depthBias: 0.001, cacheFrames: 3 })
    return engine.getStats() !== null
  })

  await test("occlusion engine reset works", async () => {
    const engine = makeOcclusionEngine({ resolution: 64, depthBias: 0.001, cacheFrames: 3 })
    engine.reset()
    const stats = engine.getStats()
    return stats.queriesThisFrame === 0 && stats.occludedCount === 0
  })

  await test("occlusion batch test returns results", async () => {
    const engine = makeOcclusionEngine({ resolution: 64, depthBias: 0.001, cacheFrames: 3 })
    const camera = createTestCamera({ x: 0, y: 0, z: 0 })
    const queries = [
      { id: "chunk-1", bounds: createTestAABB(0, 0, -50, 10) },
    ]
    const results = await engine.batchTestOcclusion(queries, camera, 1).pipe(Effect.runPromise)
    return results.has("chunk-1")
  })

  console.log("\n4. LOD Manager Tests")

  await test("LOD selector picks correct level for close distance", async () => {
    const level = DefaultLodSelector.selectLod(10, 1.0)
    return level === 0
  })

  await test("LOD selector picks correct level for medium distance", async () => {
    const level = DefaultLodSelector.selectLod(200, 1.0)
    return level === 2
  })

  await test("LOD selector picks correct level for far distance", async () => {
    const level = DefaultLodSelector.selectLod(2000, 1.0)
    return level === 4
  })

  await test("LOD bias affects level selection", async () => {
    const levelNormal = DefaultLodSelector.selectLod(100, 1.0)
    const levelBiased = DefaultLodSelector.selectLod(100, 2.0)
    return levelBiased <= levelNormal
  })

  await test("LOD manager evaluates transitions", async () => {
    const manager = makeLodManager()
    const result = manager.evaluateLod("chunk-1", 2, 300, 1.0, 1)
    return result.targetLevel !== undefined
  })

  await test("LOD manager hysteresis prevents thrashing", async () => {
    const manager = makeLodManager()
    let shouldTransition = false

    for (let i = 0; i < 10; i++) {
      const result = manager.evaluateLod("chunk-1", 2, 300, 1.0, i)
      if (result.shouldTransition) shouldTransition = true
    }

    return !shouldTransition
  })

  await test("LOD manager allows upgrade after hysteresis", async () => {
    const manager = makeLodManager()
    let upgraded = false

    for (let i = 0; i < 20; i++) {
      const result = manager.evaluateLod("chunk-1", 3, 50, 1.0, i)
      if (result.shouldTransition && result.targetLevel < 3) upgraded = true
    }

    return upgraded
  })

  console.log("\n5. Streaming Engine Tests")

  await test("streaming engine creates successfully", async () => {
    const engine = makeStreamingEngine({
      preloadRadius: 1.5,
      unloadDelayFrames: 60,
      maxConcurrentLoads: 4,
      streamingBandwidth: 50 * 1024 * 1024,
    })
    return engine.getQueueSize().pendingLoads === 0
  })

  await test("streaming priorities are computed correctly", async () => {
    const engine = makeStreamingEngine({
      preloadRadius: 1.5,
      unloadDelayFrames: 60,
      maxConcurrentLoads: 4,
      streamingBandwidth: 50 * 1024 * 1024,
    })

    const chunks = new Map()
    chunks.set("chunk-1", { ...createTestChunk("chunk-1", 0, 0, 64), state: "loaded" })
    chunks.set("chunk-2", { ...createTestChunk("chunk-2", 1, 0, 64), state: "unloaded" })

    const cameraPos = { x: 0, y: 0, z: 0 }
    const priorities = await engine.computeStreamingPriorities(chunks, cameraPos, 500).pipe(Effect.runPromise)

    return priorities.length >= 1
  })

  await test("streaming queue processes loads and unloads", async () => {
    const engine = makeStreamingEngine({
      preloadRadius: 1.5,
      unloadDelayFrames: 60,
      maxConcurrentLoads: 4,
      streamingBandwidth: 50 * 1024 * 1024,
    })

    const budget = {
      maxTriangles: 5_000_000,
      maxDrawCalls: 2000,
      maxTextureMemory: 512 * 1024 * 1024,
      currentTriangles: 0,
      currentDrawCalls: 0,
      currentTextureMemory: 0,
      currentLoadedChunks: 0,
      targetLoadedChunks: 100,
    }

    engine.addLoadRequest({
      chunkId: "chunk-1",
      priority: 100,
      reason: "distance",
      distance: 50,
      estimatedSize: 1024 * 1024,
    })

    const result = await engine.processStreamingQueue(budget, 4).pipe(Effect.runPromise)
    return result.loaded.includes("chunk-1")
  })

  console.log("\n6. Scheduler Tests")

  await test("scheduler creates frame schedule", async () => {
    const scheduler = makeRenderScheduler({
      frameBudgetMs: 16,
      maxVisibleChunksPerFrame: 500,
      maxLoadOpsPerFrame: 4,
      maxUnloadOpsPerFrame: 8,
    })

    const camera = createTestCamera({ x: 0, y: 0, z: 0 })
    const visibleChunks: any[] = []
    const budget = {
      maxTriangles: 5_000_000,
      maxDrawCalls: 2000,
      maxTextureMemory: 512 * 1024 * 1024,
      currentTriangles: 0,
      currentDrawCalls: 0,
      currentTextureMemory: 0,
      currentLoadedChunks: 0,
      targetLoadedChunks: 100,
    }

    const schedule = await scheduler.scheduleFrame(camera, visibleChunks, budget, 1).pipe(Effect.runPromise)
    return schedule.frameNumber === 1 && schedule.frameBudgetMs === 16
  })

  await test("scheduler allocates frame budget", async () => {
    const scheduler = makeRenderScheduler({
      frameBudgetMs: 16,
      maxVisibleChunksPerFrame: 500,
      maxLoadOpsPerFrame: 4,
      maxUnloadOpsPerFrame: 8,
    })

    const camera = createTestCamera({ x: 0, y: 0, z: 0 })
    const visibleChunks: any[] = []
    const budget = {
      maxTriangles: 5_000_000,
      maxDrawCalls: 2000,
      maxTextureMemory: 512 * 1024 * 1024,
      currentTriangles: 0,
      currentDrawCalls: 0,
      currentTextureMemory: 0,
      currentLoadedChunks: 0,
      targetLoadedChunks: 100,
    }

    const schedule = await scheduler.scheduleFrame(camera, visibleChunks, budget, 1).pipe(Effect.runPromise)
    const allocated = await scheduler.allocateFrameBudget(schedule, 16).pipe(Effect.runPromise)
    return allocated.frameBudgetMs === 16
  })

  await test("scheduler detects frame completion", async () => {
    const scheduler = makeRenderScheduler({
      frameBudgetMs: 16,
      maxVisibleChunksPerFrame: 500,
      maxLoadOpsPerFrame: 4,
      maxUnloadOpsPerFrame: 8,
    })

    const camera = createTestCamera({ x: 0, y: 0, z: 0 })
    const visibleChunks: any[] = []
    const budget = {
      maxTriangles: 5_000_000,
      maxDrawCalls: 2000,
      maxTextureMemory: 512 * 1024 * 1024,
      currentTriangles: 0,
      currentDrawCalls: 0,
      currentTextureMemory: 0,
      currentLoadedChunks: 0,
      targetLoadedChunks: 100,
    }

    const schedule = await scheduler.scheduleFrame(camera, visibleChunks, budget, 1).pipe(Effect.runPromise)
    const incomplete = scheduler.isFrameComplete(schedule)
    const complete = scheduler.isFrameComplete({ ...schedule, elapsedMs: 20 })
    return !incomplete && complete
  })

  console.log("\n7. Budget Engine Tests")

  await test("budget engine tracks loads and unloads", async () => {
    const engine = makeBudgetEngine({
      maxTriangles: 5_000_000,
      maxDrawCalls: 2000,
      maxTextureMemory: 512 * 1024 * 1024,
      targetLoadedChunks: 100,
      unloadThresholdPct: 0.85,
    })

    await engine.recordLoad("chunk-1", 1000, 1024 * 1024).pipe(Effect.runPromise)
    const budget = engine.getBudget()
    return budget.currentTriangles === 1000 && budget.currentDrawCalls === 1
  })

  await test("budget engine prevents overloading", async () => {
    const engine = makeBudgetEngine({
      maxTriangles: 1000,
      maxDrawCalls: 1,
      maxTextureMemory: 1024 * 1024,
      targetLoadedChunks: 100,
      unloadThresholdPct: 0.85,
    })

    await engine.recordLoad("chunk-1", 1000, 1024 * 1024).pipe(Effect.runPromise)
    const canLoad = await engine.canLoad(500, 512 * 1024).pipe(Effect.runPromise)
    return !canLoad
  })

  await test("budget engine reports pressure correctly", async () => {
    const engine = makeBudgetEngine({
      maxTriangles: 5_000_000,
      maxDrawCalls: 2000,
      maxTextureMemory: 512 * 1024 * 1024,
      targetLoadedChunks: 100,
      unloadThresholdPct: 0.85,
    })

    const lowPressure = engine.getPressure()
    return lowPressure === "low"
  })

  await test("budget engine reports high pressure when near limits", async () => {
    const engine = makeBudgetEngine({
      maxTriangles: 5_000_000,
      maxDrawCalls: 2000,
      maxTextureMemory: 512 * 1024 * 1024,
      targetLoadedChunks: 100,
      unloadThresholdPct: 0.85,
    })

    await engine.recordLoad("chunk-1", 4_800_000, 450 * 1024 * 1024).pipe(Effect.runPromise)
    const pressure = engine.getPressure()
    return pressure === "high" || pressure === "critical"
  })

  await test("budget engine forces unload when over threshold", async () => {
    const engine = makeBudgetEngine({
      maxTriangles: 5_000_000,
      maxDrawCalls: 2000,
      maxTextureMemory: 512 * 1024 * 1024,
      targetLoadedChunks: 100,
      unloadThresholdPct: 0.85,
    })

    await engine.recordLoad("chunk-1", 4_800_000, 450 * 1024 * 1024).pipe(Effect.runPromise)
    const shouldUnload = engine.shouldForceUnload()
    return shouldUnload
  })

  await test("budget engine selects chunks to unload by visibility", async () => {
    const engine = makeBudgetEngine({
      maxTriangles: 5_000_000,
      maxDrawCalls: 2000,
      maxTextureMemory: 512 * 1024 * 1024,
      targetLoadedChunks: 100,
      unloadThresholdPct: 0.85,
    })

    await engine.recordLoad("chunk-1", 4_500_000, 450 * 1024 * 1024).pipe(Effect.runPromise)
    await engine.recordLoad("chunk-2", 400_000, 50 * 1024 * 1024).pipe(Effect.runPromise)

    const loadedChunks = new Map()
    loadedChunks.set("chunk-1", { triangleCount: 4_500_000, textureMemory: 450 * 1024 * 1024, lastVisibleFrame: 1 })
    loadedChunks.set("chunk-2", { triangleCount: 400_000, textureMemory: 50 * 1024 * 1024, lastVisibleFrame: 100 })

    const toUnload = engine.getChunksToUnload(loadedChunks, 100)
    return toUnload.includes("chunk-1") && toUnload.length > 0
  })

  console.log("\n=== All rendering tests completed ===")
}

runTests().catch(console.error)
