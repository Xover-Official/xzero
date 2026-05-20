import { Effect } from "effect"
import {
  makeBoundaryTriggerSystem,
} from "../src/core/boundary-trigger.js"

console.log("=== XZero Boundary Trigger Test Suite ===\n")

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

async function runTests() {
  console.log("1. Boundary Trigger System Tests")

  await test("boundary trigger system creates successfully", async () => {
    const system = await makeBoundaryTriggerSystem(64).pipe(Effect.runPromise)
    return system !== null
  })

  await test("initial chunk is (0, 0)", async () => {
    const system = await makeBoundaryTriggerSystem(64).pipe(Effect.runPromise)
    const chunk = await system.getCurrentChunk().pipe(Effect.runPromise)
    return chunk.x === 0 && chunk.z === 0
  })

  await test("chunk size can be retrieved", async () => {
    const system = await makeBoundaryTriggerSystem(32).pipe(Effect.runPromise)
    const size = await system.getChunkSize().pipe(Effect.runPromise)
    return size === 32
  })

  await test("chunk size can be changed", async () => {
    const system = await makeBoundaryTriggerSystem(64).pipe(Effect.runPromise)
    await system.setChunkSize(128).pipe(Effect.runPromise)
    const size = await system.getChunkSize().pipe(Effect.runPromise)
    return size === 128
  })

  await test("no event when player stays in same chunk", async () => {
    const system = await makeBoundaryTriggerSystem(64).pipe(Effect.runPromise)
    const event = await system.updatePlayerPosition({ x: 10, y: 0, z: 10 }).pipe(Effect.runPromise)
    return event === null
  })

  await test("event fires when player crosses chunk boundary", async () => {
    const system = await makeBoundaryTriggerSystem(64).pipe(Effect.runPromise)
    const event = await system.updatePlayerPosition({ x: 70, y: 0, z: 10 }).pipe(Effect.runPromise)
    return event !== null && event.type === "chunk_transition"
  })

  await test("new chunk is correct after crossing boundary", async () => {
    const system = await makeBoundaryTriggerSystem(64).pipe(Effect.runPromise)
    const event = await system.updatePlayerPosition({ x: 70, y: 0, z: 10 }).pipe(Effect.runPromise)
    return event?.currentChunk.x === 1 && event?.currentChunk.z === 0
  })

  await test("previous chunk is tracked", async () => {
    const system = await makeBoundaryTriggerSystem(64).pipe(Effect.runPromise)
    const event = await system.updatePlayerPosition({ x: 70, y: 0, z: 10 }).pipe(Effect.runPromise)
    return event?.previousChunk?.x === 0 && event?.previousChunk?.z === 0
  })

  await test("loaded chunks are tracked", async () => {
    const system = await makeBoundaryTriggerSystem(64).pipe(Effect.runPromise)
    await system.updatePlayerPosition({ x: 70, y: 0, z: 10 }).pipe(Effect.runPromise)
    const loaded = await system.getLoadedChunks().pipe(Effect.runPromise)
    return loaded.has("1,0")
  })

  await test("old chunk is unloaded when player leaves", async () => {
    const system = await makeBoundaryTriggerSystem(64).pipe(Effect.runPromise)
    await system.updatePlayerPosition({ x: 70, y: 0, z: 10 }).pipe(Effect.runPromise)
    const loaded = await system.getLoadedChunks().pipe(Effect.runPromise)
    return !loaded.has("0,0")
  })

  await test("multiple chunk crossings work correctly", async () => {
    const system = await makeBoundaryTriggerSystem(64).pipe(Effect.runPromise)
    await system.updatePlayerPosition({ x: 70, y: 0, z: 10 }).pipe(Effect.runPromise)
    await system.updatePlayerPosition({ x: 130, y: 0, z: 10 }).pipe(Effect.runPromise)
    const chunk = await system.getCurrentChunk().pipe(Effect.runPromise)
    return chunk.x === 2 && chunk.z === 0
  })

  await test("Z-axis chunk crossing works", async () => {
    const system = await makeBoundaryTriggerSystem(64).pipe(Effect.runPromise)
    const event = await system.updatePlayerPosition({ x: 10, y: 0, z: 70 }).pipe(Effect.runPromise)
    return event?.currentChunk.x === 0 && event?.currentChunk.z === 1
  })

  await test("diagonal chunk crossing works", async () => {
    const system = await makeBoundaryTriggerSystem(64).pipe(Effect.runPromise)
    const event = await system.updatePlayerPosition({ x: 70, y: 0, z: 70 }).pipe(Effect.runPromise)
    return event?.currentChunk.x === 1 && event?.currentChunk.z === 1
  })

  await test("manual chunk marking works", async () => {
    const system = await makeBoundaryTriggerSystem(64).pipe(Effect.runPromise)
    await system.markChunkLoaded({ x: 5, z: 5 }).pipe(Effect.runPromise)
    const loaded = await system.getLoadedChunks().pipe(Effect.runPromise)
    return loaded.has("5,5")
  })

  await test("manual chunk unmarking works", async () => {
    const system = await makeBoundaryTriggerSystem(64).pipe(Effect.runPromise)
    await system.markChunkLoaded({ x: 5, z: 5 }).pipe(Effect.runPromise)
    await system.markChunkUnloaded({ x: 5, z: 5 }).pipe(Effect.runPromise)
    const loaded = await system.getLoadedChunks().pipe(Effect.runPromise)
    return !loaded.has("5,5")
  })

  console.log("\n=== All Boundary Trigger tests completed ===")
}

runTests().catch(console.error)
