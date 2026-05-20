import { Effect, Context, Layer, Ref, Queue, Schedule, Stream } from "effect"
import type {
  Message,
  NodeId,
  ChannelId,
  RoutingRule,
  MessageType,
  MessagePriority,
} from "../core/types.js"
import { NodeRegistry, NodeRegistryLive } from "../registry/node-registry.js"

const priorityWeight: Record<MessagePriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
}

export class MessageRouter extends Context.Tag("xzero/MessageRouter")<
  MessageRouter,
  {
    readonly route: (message: Message) => Effect.Effect<NodeId[]>
    readonly addRule: (rule: RoutingRule) => Effect.Effect<void>
    readonly removeRule: (ruleId: string) => Effect.Effect<void>
    readonly getRules: () => Effect.Effect<RoutingRule[]>
    readonly getRoutingStats: () => Effect.Effect<RoutingStats>
  }
>() {}

export interface RoutingStats {
  totalRouted: number
  avgLatency: number
  droppedMessages: number
  priorityBreakdown: Record<MessagePriority, number>
}

export const makeMessageRouter = Effect.gen(function* () {
  const rulesRef = yield* Ref.make<RoutingRule[]>([])
  const statsRef = yield* Ref.make<RoutingStats>({
    totalRouted: 0,
    avgLatency: 0,
    droppedMessages: 0,
    priorityBreakdown: { critical: 0, high: 0, normal: 0, low: 0 },
  })
  const registry = yield* NodeRegistry

  function matchRule(message: Message, rule: RoutingRule): boolean {
    const m = rule.match
    if (m.type && message.type !== m.type) return false
    if (m.channel && message.channel !== m.channel) return false
    if (m.from && message.from !== m.from) return false
    if (m.to && message.to !== m.to) return false
    return true
  }

  function executeRule(
    message: Message,
    rule: RoutingRule
  ): Effect.Effect<NodeId[]> {
    return Effect.gen(function* () {
      const action = rule.action

      switch (action.type) {
        case "forward": {
          if (!action.target) return []
          if (typeof action.target === "string") {
            return [action.target]
          }
          return []
        }

        case "broadcast": {
          const nodes = yield* registry.getAllNodes()
          return nodes
            .filter((n) => n.id !== message.from && n.status === "ready")
            .map((n) => n.id)
        }

        case "fanout": {
          const targets = action.target ?? []
          return Array.isArray(targets) ? targets : [targets]
        }

        case "load_balance": {
          if (!message.channel) return []
          const nodes = yield* registry.findAvailableNodes()
          if (nodes.length === 0) return []

          const idx =
            hashString(message.channel + message.id) % nodes.length
          return [nodes[idx].id]
        }

        case "drop":
          return []

        default:
          return []
      }
    })
  }

  function hashString(str: string): number {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash |= 0
    }
    return Math.abs(hash)
  }

  return {
    route: (message: Message) =>
      Effect.gen(function* () {
        const start = Date.now()
        const rules = yield* Ref.get(rulesRef)

        const matchedRules = rules
          .filter((r) => matchRule(message, r))
          .sort((a, b) => b.priority - a.priority)

        let targets: NodeId[] = []

        if (matchedRules.length > 0) {
          targets = yield* executeRule(message, matchedRules[0])
        } else {
          if (message.to === "*") {
            const allNodes = yield* registry.getAllNodes()
            targets = allNodes
              .filter((n) => n.id !== message.from && n.status === "ready")
              .map((n) => n.id)
          } else if (typeof message.to === "string" && message.to.startsWith("node:")) {
            targets = [message.to.replace("node:", "")]
          } else if (message.channel) {
            const nodes = yield* registry.findAvailableNodes()
            targets = nodes.map((n) => n.id)
          }
        }

        const latency = Date.now() - start

        yield* Ref.update(statsRef, (stats) => ({
          ...stats,
          totalRouted: stats.totalRouted + 1,
          avgLatency:
            stats.totalRouted === 0
              ? latency
              : (stats.avgLatency * stats.totalRouted + latency) /
                (stats.totalRouted + 1),
          priorityBreakdown: {
            ...stats.priorityBreakdown,
            [message.priority]: stats.priorityBreakdown[message.priority] + 1,
          },
        }))

        if (targets.length === 0) {
          yield* Ref.update(statsRef, (s) => ({
            ...s,
            droppedMessages: s.droppedMessages + 1,
          }))
        }

        return targets
      }),

    addRule: (rule: RoutingRule) =>
      Effect.gen(function* () {
        const rules = yield* Ref.get(rulesRef)
        yield* Ref.set(rulesRef, [...rules, rule])
      }),

    removeRule: (ruleId: string) =>
      Effect.gen(function* () {
        const rules = yield* Ref.get(rulesRef)
        yield* Ref.set(
          rulesRef,
          rules.filter((r) => r.id !== ruleId)
        )
      }),

    getRules: () => Ref.get(rulesRef),

    getRoutingStats: () => Ref.get(statsRef),
  }
})

export const MessageRouterLive = Layer.effect(MessageRouter, makeMessageRouter).pipe(
  Layer.provide(NodeRegistryLive)
)
