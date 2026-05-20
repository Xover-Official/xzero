import { Effect, Context, Layer, Schedule, Stream, Ref } from "effect"
import type {
  Message,
  NodeInfo,
  NodeId,
  SystemEvent,
  CoordinatorConfig,
  RoutingRule,
} from "../core/types.js"
import { EventBus, EventBusLive } from "../core/events.js"
import { NodeRegistry, NodeRegistryLive } from "../registry/node-registry.js"
import { MessageRouter, MessageRouterLive } from "../router/message-router.js"
import { Transport, TransportLive } from "../transport/websocket.js"

export class Coordinator extends Context.Tag("xzero/Coordinator")<
  Coordinator,
  {
    readonly start: () => Effect.Effect<void>
    readonly stop: () => Effect.Effect<void>
    readonly registerNode: (info: NodeInfo) => Effect.Effect<NodeInfo>
    readonly deregisterNode: (nodeId: NodeId) => Effect.Effect<void>
    readonly sendMessage: (message: Message) => Effect.Effect<NodeId[]>
    readonly addRoutingRule: (rule: RoutingRule) => Effect.Effect<void>
    readonly getNodes: () => Effect.Effect<NodeInfo[]>
    readonly getConnectedNodes: () => Effect.Effect<NodeId[]>
    readonly getStats: () => Effect.Effect<CoordinatorStats>
  }
>() {}

export interface CoordinatorStats {
  nodeCount: number
  connectedCount: number
  messagesRouted: number
  avgRoutingLatency: number
  droppedMessages: number
  uptime: number
}

export const makeCoordinator = (config: CoordinatorConfig) =>
  Effect.gen(function* () {
    const eventBus = yield* EventBus
    const registry = yield* NodeRegistry
    const router = yield* MessageRouter
    const transport = yield* Transport
    const startTimeRef = yield* Ref.make(Date.now())

    yield* transport.onMessage(
      (nodeId: NodeId, message: Message) =>
        Effect.gen(function* () {
          switch (message.type) {
            case "register": {
              const nodeInfo = message.payload as NodeInfo
              const registered = yield* registry.registerNode({
                ...nodeInfo,
                id: nodeId,
              })
              yield* eventBus.publishEvent({
                type: "node:joined",
                node: registered,
                timestamp: Date.now(),
              })
              break
            }

            case "deregister": {
              yield* registry.deregisterNode(nodeId)
              yield* eventBus.publishEvent({
                type: "node:left",
                node: { id: nodeId, name: "", capabilities: [], status: "disconnected", lastHeartbeat: Date.now(), metadata: {} },
                timestamp: Date.now(),
              })
              break
            }

            case "heartbeat": {
              yield* registry.recordHeartbeat(nodeId)
              yield* eventBus.publishEvent({
                type: "node:heartbeat",
                node: yield* registry.getNode(nodeId).pipe(
                  Effect.map((n) => n ?? { id: nodeId, name: "", capabilities: [], status: "disconnected" as const, lastHeartbeat: Date.now(), metadata: {} })
                ),
                timestamp: Date.now(),
              })
              break
            }

            case "subscribe": {
              const channel = message.payload as string
              yield* eventBus.publishEvent({
                type: "channel:created",
                channel,
                timestamp: Date.now(),
              })
              break
            }

            case "command":
            case "event": {
              const targets = yield* router.route(message)
              for (const target of targets) {
                yield* transport.sendToNode(target, message).pipe(Effect.ignore)
              }

              yield* eventBus.publishMessage(message)

              if (message.channel) {
                yield* eventBus.publishEvent({
                  type: "channel:message",
                  channel: message.channel,
                  message,
                  timestamp: Date.now(),
                })
              }
              break
            }

            default:
              break
          }
        })
    )

    yield* transport.onDisconnection(
      (nodeId: NodeId) =>
        Effect.gen(function* () {
          yield* registry.deregisterNode(nodeId)
          yield* eventBus.publishEvent({
            type: "node:left",
            node: { id: nodeId, name: "", capabilities: [], status: "disconnected", lastHeartbeat: Date.now(), metadata: {} },
            timestamp: Date.now(),
          })
        })
    )

    return {
      start: () =>
        Effect.gen(function* () {
          yield* transport.start()

          yield* Stream.fromSchedule(Schedule.spaced(config.heartbeatInterval)).pipe(
            Stream.tap(() =>
              Effect.gen(function* () {
                const nodes = yield* registry.getAllNodes()
                const now = Date.now()

                for (const node of nodes) {
                  if (now - node.lastHeartbeat > config.heartbeatTimeout) {
                    yield* registry.deregisterNode(node.id)
                    yield* eventBus.publishEvent({
                      type: "node:left",
                      node: { ...node, status: "disconnected" },
                      timestamp: now,
                    })
                  }
                }
              }).pipe(Effect.ignore)
            ),
            Stream.runDrain,
            Effect.forkDaemon
          )

          yield* Ref.set(startTimeRef, Date.now())
          console.log("[coordinator] Central coordinator started")
        }),

      stop: () =>
        Effect.gen(function* () {
          yield* transport.stop()
          console.log("[coordinator] Central coordinator stopped")
        }),

      registerNode: (info: NodeInfo) => registry.registerNode(info),

      deregisterNode: (nodeId: NodeId) => registry.deregisterNode(nodeId),

      sendMessage: (message: Message) =>
        Effect.gen(function* () {
          const targets = yield* router.route(message)
          for (const target of targets) {
            yield* transport.sendToNode(target, message).pipe(Effect.ignore)
          }
          yield* eventBus.publishMessage(message)
          return targets
        }),

      addRoutingRule: (rule: RoutingRule) => router.addRule(rule),

      getNodes: () => registry.getAllNodes(),

      getConnectedNodes: () => transport.getConnectedNodes(),

      getStats: () =>
        Effect.gen(function* () {
          const routingStats = yield* router.getRoutingStats()
          const nodeCount = yield* registry.getNodeCount()
          const connected = yield* transport.getConnectedNodes()
          const startTime = yield* Ref.get(startTimeRef)

          return {
            nodeCount,
            connectedCount: connected.length,
            messagesRouted: routingStats.totalRouted,
            avgRoutingLatency: routingStats.avgLatency,
            droppedMessages: routingStats.droppedMessages,
            uptime: Date.now() - startTime,
          }
        }),
    }
  })

export const CoordinatorLive = (config: CoordinatorConfig) =>
  Layer.effect(
    Coordinator,
    makeCoordinator(config)
  ).pipe(
    Layer.provide(EventBusLive),
    Layer.provide(NodeRegistryLive),
    Layer.provide(MessageRouterLive),
    Layer.provide(TransportLive(config))
  )
