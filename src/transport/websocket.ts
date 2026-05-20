import { Effect, Context, Layer, Scope, Stream, Queue, Ref } from "effect"
import { WebSocketServer, WebSocket } from "ws"
import type { Message, NodeId, CoordinatorConfig } from "../core/types.js"

export class Transport extends Context.Tag("xzero/Transport")<
  Transport,
  {
    readonly start: () => Effect.Effect<void>
    readonly stop: () => Effect.Effect<void>
    readonly sendToNode: (nodeId: NodeId, message: Message) => Effect.Effect<void>
    readonly broadcast: (message: Message, exclude?: NodeId) => Effect.Effect<void>
    readonly getConnectedNodes: () => Effect.Effect<NodeId[]>
    readonly onMessage: (
      handler: (nodeId: NodeId, message: Message) => Effect.Effect<void>
    ) => Effect.Effect<void>
    readonly onConnection: (
      handler: (nodeId: NodeId) => Effect.Effect<void>
    ) => Effect.Effect<void>
    readonly onDisconnection: (
      handler: (nodeId: NodeId) => Effect.Effect<void>
    ) => Effect.Effect<void>
  }
>() {}

interface ClientConnection {
  ws: WebSocket
  nodeId: NodeId
  lastActivity: number
}

export const makeTransport = (config: CoordinatorConfig) =>
  Effect.gen(function* () {
    let wss: WebSocketServer | null = null
    const clientsRef = yield* Ref.make<Map<NodeId, ClientConnection>>(new Map())
    const messageHandlersRef = yield* Ref.make<
      Array<(nodeId: NodeId, message: Message) => Effect.Effect<void>>
    >([])
    const connectHandlersRef = yield* Ref.make<
      Array<(nodeId: NodeId) => Effect.Effect<void>>
    >([])
    const disconnectHandlersRef = yield* Ref.make<
      Array<(nodeId: NodeId) => Effect.Effect<void>>
    >([])

    function serializeMessage(msg: Message): string {
      return JSON.stringify(msg)
    }

    function deserializeMessage(data: string): Message | null {
      try {
        const parsed = JSON.parse(data)
        if (parsed.type && parsed.from && parsed.to && parsed.payload !== undefined) {
          return parsed as Message
        }
        return null
      } catch {
        return null
      }
    }

    function registerClient(nodeId: NodeId, ws: WebSocket): Effect.Effect<void> {
      return Effect.gen(function* () {
        const clients = yield* Ref.get(clientsRef)
        const updated = new Map(clients)
        updated.set(nodeId, { ws, nodeId, lastActivity: Date.now() })
        yield* Ref.set(clientsRef, updated)

        const handlers = yield* Ref.get(connectHandlersRef)
        for (const handler of handlers) {
          yield* handler(nodeId).pipe(Effect.ignore)
        }
      })
    }

    function unregisterClient(nodeId: NodeId): Effect.Effect<void> {
      return Effect.gen(function* () {
        const clients = yield* Ref.get(clientsRef)
        const updated = new Map(clients)
        updated.delete(nodeId)
        yield* Ref.set(clientsRef, updated)

        const handlers = yield* Ref.get(disconnectHandlersRef)
        for (const handler of handlers) {
          yield* handler(nodeId).pipe(Effect.ignore)
        }
      })
    }

    return {
      start: () =>
        Effect.async<void>((resume) => {
          try {
            wss = new WebSocketServer({
              port: config.port,
              host: config.host,
              maxPayload: config.maxMessageSize,
            })

            wss.on("connection", (ws, req) => {
              const nodeId = req.headers["x-node-id"] as string | undefined

              ws.on("message", (data) => {
                const message = deserializeMessage(data.toString())
                if (message && nodeId) {
                  Effect.gen(function* () {
                    const clients = yield* Ref.get(clientsRef)
                    const conn = clients.get(nodeId)
                    if (conn) {
                      yield* Ref.set(
                        clientsRef,
                        new Map(clients).set(nodeId, {
                          ...conn,
                          lastActivity: Date.now(),
                        })
                      )
                    }

                    const handlers = yield* Ref.get(messageHandlersRef)
                    for (const handler of handlers) {
                      yield* handler(nodeId, message).pipe(Effect.ignore)
                    }
                  }).pipe(Effect.runFork)
                }
              })

              ws.on("close", () => {
                if (nodeId) {
                  unregisterClient(nodeId).pipe(Effect.runFork)
                }
              })

              ws.on("error", (err) => {
                console.error(`[transport] WebSocket error:`, err.message)
              })

              if (nodeId) {
                registerClient(nodeId, ws).pipe(Effect.runFork)
              }
            })

            wss.on("listening", () => {
              console.log(
                `[transport] Coordinator listening on ${config.host}:${config.port}`
              )
              resume(Effect.void)
            })

            wss.on("error", (err) => {
              console.error(`[transport] Server error:`, err.message)
              resume(Effect.void)
            })
          } catch (err) {
            resume(Effect.void)
          }
        }),

      stop: () =>
        Effect.async<void>((resume) => {
          if (wss) {
            wss.close(() => {
              wss = null
              resume(Effect.void)
            })
          } else {
            resume(Effect.void)
          }
        }),

      sendToNode: (nodeId: NodeId, message: Message) =>
        Effect.gen(function* () {
          const clients = yield* Ref.get(clientsRef)
          const conn = clients.get(nodeId)

          if (!conn) {
            return yield* Effect.fail(new Error(`Node ${nodeId} not connected`))
          }

          if (conn.ws.readyState === WebSocket.OPEN) {
            conn.ws.send(serializeMessage(message))
          }
        }),

      broadcast: (message: Message, exclude?: NodeId) =>
        Effect.gen(function* () {
          const clients = yield* Ref.get(clientsRef)
          const data = serializeMessage(message)

          for (const [nodeId, conn] of clients) {
            if (nodeId !== exclude && conn.ws.readyState === WebSocket.OPEN) {
              conn.ws.send(data)
            }
          }
        }),

      getConnectedNodes: () =>
        Effect.gen(function* () {
          const clients = yield* Ref.get(clientsRef)
          return Array.from(clients.keys())
        }),

      onMessage: (handler: any) =>
        Effect.gen(function* () {
          const handlers = yield* Ref.get(messageHandlersRef)
          yield* Ref.set(messageHandlersRef, [...handlers, handler])
        }),

      onConnection: (handler: any) =>
        Effect.gen(function* () {
          const handlers = yield* Ref.get(connectHandlersRef)
          yield* Ref.set(connectHandlersRef, [...handlers, handler])
        }),

      onDisconnection: (handler: any) =>
        Effect.gen(function* () {
          const handlers = yield* Ref.get(disconnectHandlersRef)
          yield* Ref.set(disconnectHandlersRef, [...handlers, handler])
        }),
    }
  })

export const TransportLive = (config: CoordinatorConfig) =>
  Layer.effect(Transport, makeTransport(config) as Effect.Effect<Transport["Type"], never, never>)
