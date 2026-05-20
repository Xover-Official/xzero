import { Effect } from "effect"
import {
  runWFC,
  makeChunkGenerator,
  makePCGAssembler,
} from "../src/pcg/assembler.js"
import {
  TILE_DEFINITIONS,
  MEXT_REGULATIONS,
  getTilesByCategory,
  getTilesByStress,
  getTilesByZone,
  getCompatibleTiles,
  getTileById,
  getAllTileIds,
} from "../src/pcg/mext-data.js"
import {
  makeQuantizedLLM,
  makePsychologicalNode,
  type StudentProfile,
  type BehavioralContext,
  type TimeOfDay,
  type DayOfWeek,
  type LocationType,
  type StudentMood,
} from "../src/pcg/psychological-node.js"
import {
  makeRendererPCGBridge,
} from "../src/pcg/renderer-pcg-bridge.js"
import { makeFrustumCullingEngine } from "../src/renderer/culling.js"
import { makeOcclusionEngine } from "../src/renderer/occlusion.js"
import { makeStreamingEngine } from "../src/renderer/streaming.js"
import type { CameraState, Vec3, Frustum } from "../src/renderer/types.js"
import { createPlane, createTestAABB, createTestSphere } from "../src/renderer/types.js"

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

console.log("=== XZero PCG & Psychological Node Test Suite ===\n")

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

function createTestContext(overrides: Partial<BehavioralContext> = {}): BehavioralContext {
  return {
    timeOfDay: "morning_class" as TimeOfDay,
    dayOfWeek: "monday" as DayOfWeek,
    locationType: "classroom" as LocationType,
    nearbyStudents: 5,
    nearbyTeachers: 1,
    noiseLevel: 0.5,
    temperature: 22,
    isExamPeriod: false,
    isLunchTime: false,
    isAfterSchool: false,
    ...overrides,
  }
}

function createTestStudent(overrides: Partial<StudentProfile> = {}): StudentProfile {
  return {
    id: "student-1",
    name: "Test Student",
    grade: 10,
    personality: {
      introversion: 0.5,
      conscientiousness: 0.7,
      neuroticism: 0.4,
      openness: 0.6,
      agreeableness: 0.8,
    },
    stressThreshold: 0.3,
    socialNeed: 0.5,
    academicPressure: 0.6,
    sleepDebt: 0.2,
    currentMood: "focused" as StudentMood,
    location: { x: 0, y: 0, z: 0 },
    lastMoodChange: Date.now(),
    behavioralHistory: [],
    ...overrides,
  }
}

async function runTests() {
  console.log("1. MEXT Data Tests")

  await test("tile definitions exist and are valid", async () => {
    return Object.keys(TILE_DEFINITIONS).length > 0
  })

  await test("all tile categories are represented", async () => {
    const categories = new Set<string>()
    for (const tile of Object.values(TILE_DEFINITIONS)) {
      categories.add(tile.category)
    }
    return categories.size >= 8
  })

  await test("getTilesByCategory returns correct tiles", async () => {
    const classrooms = getTilesByCategory("classroom")
    return classrooms.length >= 3 && classrooms.every((t) => t.category === "classroom")
  })

  await test("getTilesByStress returns correct tiles", async () => {
    const lowStress = getTilesByStress("low")
    return lowStress.length > 0 && lowStress.every((t) => t.stressLevel === "low")
  })

  await test("getTilesByZone returns correct tiles", async () => {
    const instructional = getTilesByZone("instructional")
    return instructional.length > 0 && instructional.every((t) => t.mextCompliance === "instructional")
  })

  await test("getCompatibleTiles filters forbidden adjacencies", async () => {
    const compatible = getCompatibleTiles("classroom_standard")
    return compatible.length > 0 && !compatible.some((t) => t.category === "toilet")
  })

  await test("getTileById returns correct tile", async () => {
    const tile = getTileById("hallway_straight")
    return tile?.id === "hallway_straight" && tile?.category === "hallway"
  })

  await test("getAllTileIds returns all tile IDs", async () => {
    const ids = getAllTileIds()
    return ids.length === Object.keys(TILE_DEFINITIONS).length
  })

  await test("MEXT regulations are defined", async () => {
    return (
      MEXT_REGULATIONS.instructionalAreaPerStudent === 3.3 &&
      MEXT_REGULATIONS.circulationRatio === 0.13 &&
      MEXT_REGULATIONS.openAreaRatio === 0.30
    )
  })

  console.log("\n2. PCG Assembler Tests")

  await test("WFC generates a valid layout", async () => {
    const result = runWFC({
      gridWidth: 20,
      gridHeight: 20,
      seed: 42,
      maxIterations: 1000,
      backtrackLimit: 20,
      mextEnabled: true,
      stressCyclingEnabled: false,
      stressCycleLength: 8,
    })
    return result.success && result.grid !== null
  })

  await test("WFC layout has correct dimensions", async () => {
    const result = runWFC({
      gridWidth: 15,
      gridHeight: 15,
      seed: 42,
      maxIterations: 1000,
      backtrackLimit: 20,
      mextEnabled: true,
      stressCyclingEnabled: false,
      stressCycleLength: 8,
    })
    return result.grid?.width === 15 && result.grid?.height === 15
  })

  await test("WFC layout has entrance", async () => {
    const result = runWFC({
      gridWidth: 20,
      gridHeight: 20,
      seed: 42,
      maxIterations: 1000,
      backtrackLimit: 20,
      mextEnabled: true,
      stressCyclingEnabled: false,
      stressCycleLength: 8,
    })

    if (!result.grid) return false

    for (const cell of result.grid.cells.values()) {
      if (cell.tile?.typeId === "entrance_main") return true
    }
    return false
  })

  await test("WFC layout has courtyards", async () => {
    const result = runWFC({
      gridWidth: 40,
      gridHeight: 40,
      seed: 42,
      maxIterations: 3000,
      backtrackLimit: 50,
      mextEnabled: true,
      stressCyclingEnabled: false,
      stressCycleLength: 8,
    })

    if (!result.grid) return false
    const courtyardCount = [...result.grid.cells.values()].filter(
      (c) => c.tile?.typeId.startsWith("courtyard")
    ).length
    return courtyardCount > 0
  })

  await test("WFC layout has classrooms", async () => {
    const result = runWFC({
      gridWidth: 40,
      gridHeight: 40,
      seed: 42,
      maxIterations: 3000,
      backtrackLimit: 50,
      mextEnabled: true,
      stressCyclingEnabled: false,
      stressCycleLength: 8,
    })

    if (!result.grid) return false
    const classroomCount = [...result.grid.cells.values()].filter(
      (c) => c.tile?.typeId.startsWith("classroom")
    ).length
    return classroomCount > 0
  })

  await test("WFC generates MEXT compliance report", async () => {
    const result = runWFC({
      gridWidth: 20,
      gridHeight: 20,
      seed: 42,
      maxIterations: 1000,
      backtrackLimit: 20,
      mextEnabled: true,
      stressCyclingEnabled: false,
      stressCycleLength: 8,
    })
    return result.mextReport !== null
  })

  await test("WFC MEXT report has valid ratios", async () => {
    const result = runWFC({
      gridWidth: 20,
      gridHeight: 20,
      seed: 42,
      maxIterations: 1000,
      backtrackLimit: 20,
      mextEnabled: true,
      stressCyclingEnabled: false,
      stressCycleLength: 8,
    })

    if (!result.mextReport) return false
    return (
      result.mextReport.circulationRatio >= 0 &&
      result.mextReport.openAreaRatio >= 0 &&
      result.mextReport.circulationRatio + result.mextReport.openAreaRatio <= 1
    )
  })

  await test("WFC uses iteration and backtrack counting", async () => {
    const result = runWFC({
      gridWidth: 10,
      gridHeight: 10,
      seed: 42,
      maxIterations: 500,
      backtrackLimit: 10,
      mextEnabled: true,
      stressCyclingEnabled: false,
      stressCycleLength: 8,
    })
    return result.iterations >= 0 && result.backtracks >= 0
  })

  await test("chunk generator creates chunks with correct seed", async () => {
    const generator = makeChunkGenerator(42)
    const seed = generator.getChunkSeed(0, 0)
    return seed === generator.getChunkSeed(0, 0)
  })

  await test("chunk generator creates different seeds for different chunks", async () => {
    const generator = makeChunkGenerator(42)
    const seed1 = generator.getChunkSeed(0, 0)
    const seed2 = generator.getChunkSeed(1, 0)
    return seed1 !== seed2
  })

  await test("chunk generator produces tiles for a chunk", async () => {
    const generator = makeChunkGenerator(42)
    const result = await generator.generateChunk(0, 0, 8).pipe(Effect.runPromise)
    return result.tiles.size === 64
  })

  await test("chunk generator produces correct bounds", async () => {
    const generator = makeChunkGenerator(42)
    const result = await generator.generateChunk(1, 2, 8).pipe(Effect.runPromise)
    return (
      result.bounds.minX === 8 &&
      result.bounds.minZ === 16 &&
      result.bounds.maxX === 15 &&
      result.bounds.maxZ === 23
    )
  })

  await test("PCG assembler creates successfully", async () => {
    const assembler = makePCGAssembler(42)
    return assembler !== null
  })

  await test("PCG assembler generates layout via Effect", async () => {
    const assembler = makePCGAssembler(42)
    const result = await assembler.generateLayout({
      gridWidth: 15,
      gridHeight: 15,
      seed: 42,
      maxIterations: 500,
      backtrackLimit: 10,
    }).pipe(Effect.runPromise)
    return result.success && result.grid !== null
  })

  await test("PCG assembler generates infinite chunks", async () => {
    const assembler = makePCGAssembler(42)
    const result = await assembler.generateInfiniteChunk(0, 0, 8).pipe(Effect.runPromise)
    return result.tiles.size === 64
  })

  await test("PCG assembler global seed can be changed", async () => {
    const assembler = makePCGAssembler(42)
    assembler.getChunkGenerator().setGlobalSeed(123)
    return assembler.getChunkGenerator().getGlobalSeed() === 123
  })

  console.log("\n3. Psychological Node Tests")

  await test("quantized LLM creates successfully", async () => {
    const llm = makeQuantizedLLM()
    return llm !== null
  })

  await test("LLM evaluates behavior for normal student", async () => {
    const llm = makeQuantizedLLM()
    const student = createTestStudent()
    const context = createTestContext()

    const action = await llm.evaluateBehavior(student, context).pipe(Effect.runPromise)
    return action.type !== undefined && action.duration > 0
  })

  await test("LLM triggers afternoon napping rule", async () => {
    const llm = makeQuantizedLLM()
    const student = createTestStudent({
      sleepDebt: 0.6,
    })
    const context = createTestContext({
      timeOfDay: "afternoon_class",
      locationType: "classroom",
      nearbyTeachers: 1,
    })

    const action = await llm.evaluateBehavior(student, context).pipe(Effect.runPromise)
    return action.type === "napping"
  })

  await test("LLM triggers exam stress avoidance", async () => {
    const llm = makeQuantizedLLM()
    const student = createTestStudent({
      stressThreshold: 0.8,
    })
    const context = createTestContext({
      timeOfDay: "morning_class",
      isExamPeriod: true,
    })

    const action = await llm.evaluateBehavior(student, context).pipe(Effect.runPromise)
    return action.type === "avoiding"
  })

  await test("LLM triggers burnout collapse", async () => {
    const llm = makeQuantizedLLM()
    const student = createTestStudent({
      stressThreshold: 0.9,
      sleepDebt: 0.9,
      academicPressure: 0.9,
    })
    const context = createTestContext({
      timeOfDay: "afternoon_class",
      isExamPeriod: true,
      locationType: "classroom",
    })

    const action = await llm.evaluateBehavior(student, context).pipe(Effect.runPromise)
    return action.type === "hiding" || action.type === "avoiding" || action.type === "napping"
  })

  await test("LLM triggers lunchtime socializing", async () => {
    const llm = makeQuantizedLLM()
    const student = createTestStudent({
      socialNeed: 0.8,
      stressThreshold: 0.2,
    })
    const context = createTestContext({
      timeOfDay: "lunch",
      isLunchTime: true,
      locationType: "courtyard",
      isExamPeriod: false,
    })

    const action = await llm.evaluateBehavior(student, context).pipe(Effect.runPromise)
    return action.type === "socializing" || action.type === "eating" || action.type === "wandering"
  })

  await test("LLM triggers toilet refuge", async () => {
    const llm = makeQuantizedLLM()
    const student = createTestStudent({
      stressThreshold: 0.8,
      socialNeed: 0.1,
      sleepDebt: 0.3,
    })
    const context = createTestContext({
      nearbyStudents: 5,
      locationType: "hallway",
      isExamPeriod: false,
      timeOfDay: "afternoon_class",
    })

    const action = await llm.evaluateBehavior(student, context).pipe(Effect.runPromise)
    return action.type === "hiding" || action.type === "avoiding" || action.type === "phone_usage" || action.type === "wandering"
  })

  await test("LLM triggers stairwell loitering", async () => {
    const llm = makeQuantizedLLM()
    const student = createTestStudent({
      stressThreshold: 0.3,
    })
    const context = createTestContext({
      locationType: "stairwell",
      nearbyStudents: 3,
      nearbyTeachers: 0,
      isExamPeriod: false,
    })

    const action = await llm.evaluateBehavior(student, context).pipe(Effect.runPromise)
    return action.type === "socializing" || action.type === "phone_usage" || action.type === "wandering" || action.type === "studying"
  })

  await test("LLM updates student state after action", async () => {
    const llm = makeQuantizedLLM()
    const student = createTestStudent()
    const action = {
      type: "napping" as const,
      duration: 15,
      intensity: 0.5,
      moodShift: "drowsy" as StudentMood,
      notes: "test nap",
    }

    const updated = await llm.updateState(student, action, 15).pipe(Effect.runPromise)
    return updated.sleepDebt < student.sleepDebt
  })

  await test("LLM getTimeOfDay returns correct periods", async () => {
    const llm = makeQuantizedLLM()
    return (
      llm.getTimeOfDay(6) === "early_morning" &&
      llm.getTimeOfDay(9) === "morning_class" &&
      llm.getTimeOfDay(12) === "lunch" &&
      llm.getTimeOfDay(14) === "afternoon_class" &&
      llm.getTimeOfDay(15) === "after_school" &&
      llm.getTimeOfDay(18) === "evening"
    )
  })

  await test("LLM getDayOfWeek returns correct days", async () => {
    const llm = makeQuantizedLLM()
    return (
      llm.getDayOfWeek(0) === "monday" &&
      llm.getDayOfWeek(4) === "friday"
    )
  })

  await test("psychological node creates successfully", async () => {
    const node = makePsychologicalNode()
    return node !== null
  })

  await test("psychological node adds and retrieves students", async () => {
    const node = makePsychologicalNode()
    const student = createTestStudent()

    await node.addStudent(student).pipe(Effect.runPromise)
    const students = await node.getStudents().pipe(Effect.runPromise)

    return students.length === 1 && students[0].id === "student-1"
  })

  await test("psychological node removes students", async () => {
    const node = makePsychologicalNode()
    const student = createTestStudent()

    await node.addStudent(student).pipe(Effect.runPromise)
    await node.removeStudent("student-1").pipe(Effect.runPromise)
    const students = await node.getStudents().pipe(Effect.runPromise)

    return students.length === 0
  })

  await test("psychological node tick produces actions", async () => {
    const node = makePsychologicalNode()
    const student = createTestStudent()

    await node.addStudent(student).pipe(Effect.runPromise)
    const actions = await node.tick(5).pipe(Effect.runPromise)

    return actions.size === 1
  })

  await test("psychological node gets student state", async () => {
    const node = makePsychologicalNode()
    const student = createTestStudent()

    await node.addStudent(student).pipe(Effect.runPromise)
    const state = await node.getStudentState("student-1").pipe(Effect.runPromise)

    return state !== null && state.mood !== undefined
  })

  await test("psychological node returns null for unknown student", async () => {
    const node = makePsychologicalNode()
    const state = await node.getStudentState("unknown").pipe(Effect.runPromise)
    return state === null
  })

  console.log("\n4. Renderer-PCG Bridge Tests")

  await test("bridge creates successfully", async () => {
    const culling = makeFrustumCullingEngine({ chunkSize: 64, viewDistance: 500 })
    const occlusion = makeOcclusionEngine({ resolution: 64, depthBias: 0.001, cacheFrames: 3 })
    const streaming = makeStreamingEngine({
      preloadRadius: 1.5,
      unloadDelayFrames: 60,
      maxConcurrentLoads: 4,
      streamingBandwidth: 50 * 1024 * 1024,
    })
    const pcg = makePCGAssembler(42)

    const bridge = makeRendererPCGBridge(culling, occlusion, streaming, pcg)
    return bridge !== null
  })

  await test("bridge updates camera", async () => {
    const culling = makeFrustumCullingEngine({ chunkSize: 64, viewDistance: 500 })
    const occlusion = makeOcclusionEngine({ resolution: 64, depthBias: 0.001, cacheFrames: 3 })
    const streaming = makeStreamingEngine({
      preloadRadius: 1.5,
      unloadDelayFrames: 60,
      maxConcurrentLoads: 4,
      streamingBandwidth: 50 * 1024 * 1024,
    })
    const pcg = makePCGAssembler(42)

    const bridge = makeRendererPCGBridge(culling, occlusion, streaming, pcg)
    const camera = createTestCamera({ x: 0, y: 0, z: 0 })

    await bridge.updateCamera(camera).pipe(Effect.runPromise)
    return true
  })

  await test("bridge processes frame", async () => {
    const culling = makeFrustumCullingEngine({ chunkSize: 64, viewDistance: 500 })
    const occlusion = makeOcclusionEngine({ resolution: 64, depthBias: 0.001, cacheFrames: 3 })
    const streaming = makeStreamingEngine({
      preloadRadius: 1.5,
      unloadDelayFrames: 60,
      maxConcurrentLoads: 4,
      streamingBandwidth: 50 * 1024 * 1024,
    })
    const pcg = makePCGAssembler(42)

    const bridge = makeRendererPCGBridge(culling, occlusion, streaming, pcg)
    const camera = createTestCamera({ x: 0, y: 0, z: 0 })

    await bridge.updateCamera(camera).pipe(Effect.runPromise)
    const result = await bridge.processFrame(1).pipe(Effect.runPromise)

    return result.generated >= 0
  })

  await test("bridge tracks loaded chunks", async () => {
    const culling = makeFrustumCullingEngine({ chunkSize: 64, viewDistance: 500 })
    const occlusion = makeOcclusionEngine({ resolution: 64, depthBias: 0.001, cacheFrames: 3 })
    const streaming = makeStreamingEngine({
      preloadRadius: 1.5,
      unloadDelayFrames: 60,
      maxConcurrentLoads: 4,
      streamingBandwidth: 50 * 1024 * 1024,
    })
    const pcg = makePCGAssembler(42)

    const bridge = makeRendererPCGBridge(culling, occlusion, streaming, pcg)
    const camera = createTestCamera({ x: 0, y: 0, z: 0 })

    await bridge.updateCamera(camera).pipe(Effect.runPromise)
    await bridge.processFrame(1).pipe(Effect.runPromise)

    const loaded = bridge.getLoadedChunks()
    return loaded.size >= 0
  })

  await test("bridge view distance can be changed", async () => {
    const culling = makeFrustumCullingEngine({ chunkSize: 64, viewDistance: 500 })
    const occlusion = makeOcclusionEngine({ resolution: 64, depthBias: 0.001, cacheFrames: 3 })
    const streaming = makeStreamingEngine({
      preloadRadius: 1.5,
      unloadDelayFrames: 60,
      maxConcurrentLoads: 4,
      streamingBandwidth: 50 * 1024 * 1024,
    })
    const pcg = makePCGAssembler(42)

    const bridge = makeRendererPCGBridge(culling, occlusion, streaming, pcg)
    bridge.setViewDistance(1000)
    return bridge.getViewDistance() === 1000
  })

  console.log("\n5. Maze Mode Tests")

  await test("maze mode generates layout with branching", async () => {
    const result = runWFC({
      gridWidth: 20,
      gridHeight: 20,
      seed: 42,
      maxIterations: 1000,
      backtrackLimit: 20,
      mextEnabled: false,
      stressCyclingEnabled: false,
      stressCycleLength: 8,
      mazeMode: true,
      loopClosureBias: 0.25,
      deadEndRatio: 0.20,
      branchWeight: 1.5,
    })

    if (!result.grid) return false

    const branchCount = [...result.grid.cells.values()].filter(
      (c) => c.tile?.typeId.includes("branch") || c.tile?.typeId.includes("cross") || c.tile?.typeId.includes("intersection")
    ).length

    return branchCount > 0
  })

  await test("maze mode generates dead-ends", async () => {
    const result = runWFC({
      gridWidth: 20,
      gridHeight: 20,
      seed: 42,
      maxIterations: 1000,
      backtrackLimit: 20,
      mextEnabled: false,
      stressCyclingEnabled: false,
      stressCycleLength: 8,
      mazeMode: true,
      loopClosureBias: 0.25,
      deadEndRatio: 0.20,
      branchWeight: 1.5,
    })

    if (!result.grid) return false

    const deadEndCount = [...result.grid.cells.values()].filter(
      (c) => c.tile?.typeId.includes("dead_end")
    ).length

    return deadEndCount > 0
  })

  await test("chunk generator supports maze mode", async () => {
    const generator = makeChunkGenerator(42)
    const result = await generator.generateChunk(0, 0, 8, true).pipe(Effect.runPromise)
    return result.mazeStats !== undefined && result.mazeStats.branchCount > 0
  })

  await test("chunk generator maze mode has correct tile distribution", async () => {
    const generator = makeChunkGenerator(42)
    const result = await generator.generateChunk(0, 0, 10, true).pipe(Effect.runPromise)

    if (!result.mazeStats) return false

    const total = result.mazeStats.branchCount + result.mazeStats.deadEndCount + result.mazeStats.loopCount
    return total > 0 && result.tiles.size === 100
  })

  await test("PCG assembler generates maze chunks", async () => {
    const assembler = makePCGAssembler(42)
    const result = await assembler.generateInfiniteChunk(0, 0, 8, true).pipe(Effect.runPromise)
    return result.mazeStats !== undefined && result.tiles.size === 64
  })

  await test("maze mode produces more branches than straight hallways", async () => {
    const result = runWFC({
      gridWidth: 30,
      gridHeight: 30,
      seed: 123,
      maxIterations: 2000,
      backtrackLimit: 30,
      mextEnabled: false,
      stressCyclingEnabled: false,
      stressCycleLength: 8,
      mazeMode: true,
      loopClosureBias: 0.30,
      deadEndRatio: 0.20,
      branchWeight: 2.0,
    })

    if (!result.grid) return false

    const branchCount = [...result.grid.cells.values()].filter(
      (c) => c.tile?.typeId.includes("branch") || c.tile?.typeId.includes("cross")
    ).length

    const straightCount = [...result.grid.cells.values()].filter(
      (c) => c.tile?.typeId.includes("straight")
    ).length

    return branchCount >= straightCount
  })

  console.log("\n6. Batch Inference Scheduler Tests")

  await test("batch scheduler creates successfully", async () => {
    const { makeBatchInferenceScheduler } = await import("../src/pcg/psychological-node.js")
    const scheduler = makeBatchInferenceScheduler()
    return scheduler !== null
  })

  await test("batch scheduler has default config", async () => {
    const { makeBatchInferenceScheduler } = await import("../src/pcg/psychological-node.js")
    const scheduler = makeBatchInferenceScheduler()
    const config = scheduler.getConfig()
    return config.inferenceIntervalMs === 3000 && config.maxBatchSize === 20
  })

  await test("batch scheduler skips ticks below interval", async () => {
    const { makeBatchInferenceScheduler } = await import("../src/pcg/psychological-node.js")
    const scheduler = makeBatchInferenceScheduler({ inferenceIntervalMs: 1000, maxBatchSize: 20, staggerOffsetMs: 0 })
    const result = await scheduler.tick(500).pipe(Effect.runPromise)
    return result === null
  })

  await test("batch scheduler processes when interval elapses", async () => {
    const { makeBatchInferenceScheduler } = await import("../src/pcg/psychological-node.js")
    const scheduler = makeBatchInferenceScheduler({ inferenceIntervalMs: 50, maxBatchSize: 20, staggerOffsetMs: 0 })
    await scheduler.tick(100).pipe(Effect.runPromise)
    const stats = await scheduler.getStats().pipe(Effect.runPromise)
    return stats.totalInferences >= 1
  })

  await test("batch scheduler tracks stats correctly", async () => {
    const { makeBatchInferenceScheduler } = await import("../src/pcg/psychological-node.js")
    const scheduler = makeBatchInferenceScheduler({ inferenceIntervalMs: 50, maxBatchSize: 20, staggerOffsetMs: 0 })
    await scheduler.tick(100).pipe(Effect.runPromise)
    const stats = await scheduler.getStats().pipe(Effect.runPromise)
    return stats.skippedTicks >= 0 && stats.totalInferences >= 1
  })

  await test("batch scheduler config can be updated", async () => {
    const { makeBatchInferenceScheduler } = await import("../src/pcg/psychological-node.js")
    const scheduler = makeBatchInferenceScheduler()
    await scheduler.updateConfig({ inferenceIntervalMs: 5000 }).pipe(Effect.runPromise)
    const config = scheduler.getConfig()
    return config.inferenceIntervalMs === 5000
  })

  console.log("\n=== All PCG & Psychological tests completed ===")
}

runTests().catch(console.error)
