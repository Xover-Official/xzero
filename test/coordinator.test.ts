import { Effect, Layer, Ref, TestClock, Stream, Fiber, PubSub, Queue } from "effect"
import { EventBus, EventBusLive } from "../src/core/events.js"
import { NodeRegistry, NodeRegistryLive } from "../src/registry/node-registry.js"
import { MessageRouter, MessageRouterLive } from "../src/router/message-router.js"
import { createMessage, createNodeInfo } from "../src/core/types.js"

console.log("=== XZero Coordinator Test Suite ===\n")

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
  console.log("1. Event Bus Tests")

  await test("publish and subscribe to messages", async () => {
    const result = await Effect.gen(function* () {
      const eventBus = yield* EventBus
      const queue = yield* Queue.unbounded<Message>()

      const stream = yield* eventBus.subscribeMessages()
      const fiber = yield* stream.pipe(
        Stream.take(1),
        Stream.runCollect,
        Effect.tap((msgs) =>
          Effect.sync(() => {
            for (const msg of msgs) {
              Queue.offer(queue, msg).pipe(Effect.runSync)
            }
          })
        ),
        Effect.fork
      )

      yield* Effect.sleep(10)

      const msg = createMessage("event", "node-1", "node-2", { test: true })
      yield* eventBus.publishMessage(msg)

      yield* Effect.sleep(50)
      yield* Fiber.interrupt(fiber)

      const size = yield* Queue.size(queue)
      return size === 1
    }).pipe(
      Effect.provide(EventBusLive),
      Effect.runPromise
    )

    return result
  })

  await test("channel subscriptions work", async () => {
    const result = await Effect.gen(function* () {
      const eventBus = yield* EventBus
      const queue = yield* Queue.unbounded<Message>()

      const stream = yield* eventBus.subscribeChannel("test-channel")
      const fiber = yield* stream.pipe(
        Stream.take(1),
        Stream.runCollect,
        Effect.tap((msgs) =>
          Effect.sync(() => {
            for (const msg of msgs) {
              Queue.offer(queue, msg).pipe(Effect.runSync)
            }
          })
        ),
        Effect.fork
      )

      yield* Effect.sleep(10)

      const msg = createMessage("event", "node-1", "*", { data: "hello" }, {
        channel: "test-channel",
      })
      yield* eventBus.publishMessage(msg)

      yield* Effect.sleep(50)
      yield* Fiber.interrupt(fiber)

      const size = yield* Queue.size(queue)
      return size === 1
    }).pipe(
      Effect.provide(EventBusLive),
      Effect.runPromise
    )

    return result
  })

  console.log("\n2. Node Registry Tests")

  await test("register and retrieve nodes", async () => {
    const result = await Effect.gen(function* () {
      const registry = yield* NodeRegistry

      const nodeInfo = {
        ...createNodeInfo("test-node", ["llm", "embedding"]),
        id: "node-1",
      }

      yield* registry.registerNode(nodeInfo)
      const retrieved = yield* registry.getNode("node-1")

      return retrieved !== null && retrieved.name === "test-node"
    }).pipe(
      Effect.provide(NodeRegistryLive),
      Effect.runPromise
    )

    return result
  })

  await test("find nodes by capability", async () => {
    const result = await Effect.gen(function* () {
      const registry = yield* NodeRegistry

      yield* registry.registerNode({
        ...createNodeInfo("llm-node", ["llm"]),
        id: "node-1",
      })
      yield* registry.registerNode({
        ...createNodeInfo("embed-node", ["embedding"]),
        id: "node-2",
      })
      yield* registry.registerNode({
        ...createNodeInfo("multi-node", ["llm", "embedding"]),
        id: "node-3",
      })

      const llmNodes = yield* registry.findNodesByCapability("llm")
      return llmNodes.length === 2
    }).pipe(
      Effect.provide(NodeRegistryLive),
      Effect.runPromise
    )

    return result
  })

  await test("heartbeat tracking", async () => {
    const result = await Effect.gen(function* () {
      const registry = yield* NodeRegistry

      yield* registry.registerNode({
        ...createNodeInfo("test-node"),
        id: "node-1",
      })

      yield* Effect.sleep(10)

      const health = yield* registry.recordHeartbeat("node-1")
      return health.status === "healthy" && health.latency >= 0
    }).pipe(
      Effect.provide(NodeRegistryLive),
      Effect.runPromise
    )

    return result
  })

  await test("deregister nodes", async () => {
    const result = await Effect.gen(function* () {
      const registry = yield* NodeRegistry

      yield* registry.registerNode({
        ...createNodeInfo("temp-node"),
        id: "node-temp",
      })

      yield* registry.deregisterNode("node-temp")
      const retrieved = yield* registry.getNode("node-temp")

      return retrieved === null
    }).pipe(
      Effect.provide(NodeRegistryLive),
      Effect.runPromise
    )

    return result
  })

  console.log("\n3. Message Router Tests")

  await test("route broadcast messages", async () => {
    const result = await Effect.gen(function* () {
      const router = yield* MessageRouter
      const registry = yield* NodeRegistry

      yield* registry.registerNode({
        ...createNodeInfo("node-a"),
        id: "node-a",
      })
      yield* registry.registerNode({
        ...createNodeInfo("node-b"),
        id: "node-b",
      })

      const msg = createMessage("event", "node-a", "*", { broadcast: true })
      const targets = yield* router.route(msg)

      return targets.includes("node-b") && !targets.includes("node-a")
    }).pipe(
      Effect.provide(Layer.merge(NodeRegistryLive, MessageRouterLive)),
      Effect.runPromise
    )

    return result
  })

  await test("routing rules are applied", async () => {
    const result = await Effect.gen(function* () {
      const router = yield* MessageRouter

      yield* router.addRule({
        id: "test-rule",
        match: { type: "command" },
        action: { type: "forward", target: "node-specific" },
        priority: 100,
      })

      const msg = createMessage("command", "node-1", "node-2", { cmd: "test" })
      const targets = yield* router.route(msg)

      return targets.includes("node-specific")
    }).pipe(
      Effect.provide(MessageRouterLive),
      Effect.runPromise
    )

    return result
  })

  await test("routing stats are tracked", async () => {
    const result = await Effect.gen(function* () {
      const router = yield* MessageRouter

      const msg = createMessage("event", "node-1", "*", { test: true })
      yield* router.route(msg)
      yield* router.route(msg)

      const stats = yield* router.getRoutingStats()
      return stats.totalRouted === 2
    }).pipe(
      Effect.provide(MessageRouterLive),
      Effect.runPromise
    )

    return result
  })

  console.log("\n=== All tests completed ===")
}

runTests().catch(console.error)
