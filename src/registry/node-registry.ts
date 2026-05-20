import { Effect, Context, Layer, Ref, Schedule, Stream } from "effect"
import type { NodeId, NodeInfo, HealthCheck } from "../core/types.js"

export class NodeRegistry extends Context.Tag("xzero/NodeRegistry")<
  NodeRegistry,
  {
    readonly registerNode: (info: NodeInfo) => Effect.Effect<NodeInfo>
    readonly deregisterNode: (nodeId: NodeId) => Effect.Effect<void>
    readonly getNode: (nodeId: NodeId) => Effect.Effect<NodeInfo | null>
    readonly getAllNodes: () => Effect.Effect<NodeInfo[]>
    readonly updateNodeStatus: (
      nodeId: NodeId,
      status: NodeInfo["status"]
    ) => Effect.Effect<void>
    readonly recordHeartbeat: (nodeId: NodeId) => Effect.Effect<HealthCheck>
    readonly findNodesByCapability: (
      capability: string
    ) => Effect.Effect<NodeInfo[]>
    readonly findAvailableNodes: () => Effect.Effect<NodeInfo[]>
    readonly getNodeCount: () => Effect.Effect<number>
  }
>() {}

export const makeNodeRegistry = Effect.gen(function* () {
  const nodesRef = yield* Ref.make<Map<NodeId, NodeInfo>>(new Map())

  return {
    registerNode: (info: NodeInfo) =>
      Effect.gen(function* () {
        const nodes = yield* Ref.get(nodesRef)
        const updated = new Map(nodes)
        updated.set(info.id, { ...info, status: "ready" })
        yield* Ref.set(nodesRef, updated)
        return { ...info, status: "ready" as const }
      }),

    deregisterNode: (nodeId: NodeId) =>
      Effect.gen(function* () {
        const nodes = yield* Ref.get(nodesRef)
        const updated = new Map(nodes)
        updated.delete(nodeId)
        yield* Ref.set(nodesRef, updated)
      }),

    getNode: (nodeId: NodeId) =>
      Effect.gen(function* () {
        const nodes = yield* Ref.get(nodesRef)
        return nodes.get(nodeId) ?? null
      }),

    getAllNodes: () =>
      Effect.gen(function* () {
        const nodes = yield* Ref.get(nodesRef)
        return Array.from(nodes.values())
      }),

    updateNodeStatus: (nodeId: NodeId, status: NodeInfo["status"]) =>
      Effect.gen(function* () {
        const nodes = yield* Ref.get(nodesRef)
        const node = nodes.get(nodeId)
        if (node) {
          const updated = new Map(nodes)
          updated.set(nodeId, { ...node, status })
          yield* Ref.set(nodesRef, updated)
        }
      }),

    recordHeartbeat: (nodeId: NodeId) =>
      Effect.gen(function* () {
        const now = Date.now()
        const nodes = yield* Ref.get(nodesRef)
        const node = nodes.get(nodeId)

        if (!node) {
          return yield* Effect.fail(new Error(`Node ${nodeId} not found`))
        }

        const latency = now - node.lastHeartbeat
        const updated = new Map(nodes)
        updated.set(nodeId, { ...node, lastHeartbeat: now })
        yield* Ref.set(nodesRef, updated)

        const healthStatus: HealthCheck["status"] =
          latency < 1000 ? "healthy" : latency < 5000 ? "degraded" : "unhealthy"

        return {
          nodeId,
          latency,
          status: healthStatus,
          timestamp: now,
        }
      }),

    findNodesByCapability: (capability: string) =>
      Effect.gen(function* () {
        const nodes = yield* Ref.get(nodesRef)
        return Array.from(nodes.values()).filter((n) =>
          n.capabilities.includes(capability)
        )
      }),

    findAvailableNodes: () =>
      Effect.gen(function* () {
        const nodes = yield* Ref.get(nodesRef)
        return Array.from(nodes.values()).filter(
          (n) => n.status === "ready" || n.status === "busy"
        )
      }),

    getNodeCount: () =>
      Effect.gen(function* () {
        const nodes = yield* Ref.get(nodesRef)
        return nodes.size
      }),
  }
})

export const NodeRegistryLive = Layer.effect(NodeRegistry, makeNodeRegistry as Effect.Effect<NodeRegistry["Type"], never, never>)
