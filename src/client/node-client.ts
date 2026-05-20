import { Effect, Queue, Stream, Ref, Schedule } from "effect"
import { WebSocket } from "ws"
import type {
  Message,
  NodeInfo,
  NodeId,
  MessageType,
  MessagePriority,
  Command,
  Response,
} from "../core/types.js"
import { createMessage } from "../core/types.js"

export class NodeClient {
  private ws: WebSocket | null = null
  private nodeId: NodeId | null = null
  private messageQueue: Queue.Queue<Message> | null = null
  private responseMap = new Map<string, (response: Response) => void>()
  private config: NodeClientConfig

  constructor(config: NodeClientConfig) {
    this.config = config
  }

  connect(): Effect.Effect<NodeId, Error> {
    return Effect.async<NodeId, Error>((resume) => {
      try {
        this.ws = new WebSocket(this.config.coordinatorUrl, {
          headers: {
            "x-node-id": this.config.nodeId,
            "x-node-name": this.config.name,
          },
        })

        this.ws.on("open", () => {
          this.nodeId = this.config.nodeId

          Effect.runPromise(Queue.unbounded<Message>()).then((q) => {
            this.messageQueue = q
          })

          const registerMsg = createMessage(
            "register",
            this.config.nodeId,
            "*",
            {
              name: this.config.name,
              capabilities: this.config.capabilities,
              metadata: this.config.metadata,
            }
          )

          this.ws!.send(JSON.stringify(registerMsg))

          this.ws!.on("message", (data) => {
            const msg = JSON.parse(data.toString()) as Message
            if (msg.type === "response" && "commandId" in msg) {
              const handler = this.responseMap.get(msg.commandId as string)
              if (handler) {
                handler(msg as any)
                this.responseMap.delete(msg.commandId as string)
              }
            }
            if (this.messageQueue) {
              Queue.offer(this.messageQueue, msg).pipe(Effect.runSync)
            }
          })

          resume(Effect.succeed(this.config.nodeId))
        })

        this.ws.on("error", (err) => {
          resume(Effect.fail(new Error(`Connection failed: ${err.message}`)))
        })

        this.ws.on("close", () => {
          this.nodeId = null
        })
      } catch (err) {
        resume(Effect.fail(err as Error))
      }
    })
  }

  disconnect(): Effect.Effect<void> {
    return Effect.sync(() => {
      if (this.nodeId && this.ws) {
        const msg = createMessage("deregister", this.nodeId, "*", {})
        this.ws.send(JSON.stringify(msg))
        this.ws.close()
      }
      this.ws = null
      this.nodeId = null
    })
  }

  sendHeartbeat(): Effect.Effect<void> {
    return Effect.sync(() => {
      if (this.nodeId && this.ws?.readyState === WebSocket.OPEN) {
        const msg = createMessage("heartbeat", this.nodeId, "*", {
          timestamp: Date.now(),
        })
        this.ws.send(JSON.stringify(msg))
      }
    })
  }

  startHeartbeatLoop(interval: number = 5000): Effect.Effect<void> {
    return Stream.fromSchedule(Schedule.spaced(interval)).pipe(
      Stream.tap(() => this.sendHeartbeat()),
      Stream.runDrain,
      Effect.forkDaemon,
      Effect.as(void 0)
    )
  }

  sendMessage(
    to: NodeId | "*",
    payload: unknown,
    options?: {
      type?: MessageType
      channel?: string
      priority?: MessagePriority
    }
  ): Effect.Effect<void> {
    return Effect.sync(() => {
      if (!this.nodeId || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
        throw new Error("Not connected")
      }

      const msg = createMessage(
        options?.type ?? "event",
        this.nodeId,
        to,
        payload,
        {
          channel: options?.channel,
          priority: options?.priority,
        }
      )

      this.ws.send(JSON.stringify(msg))
    })
  }

  sendCommand(
    to: NodeId,
    command: Command
  ): Effect.Effect<Response, Error> {
    return Effect.async<Response, Error>((resume) => {
      if (!this.nodeId || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
        resume(Effect.fail(new Error("Not connected")))
        return
      }

      const msg = createMessage("command", this.nodeId, to, command, {
        priority: "high",
      })

      const timeout = setTimeout(() => {
        this.responseMap.delete(msg.id)
        resume(Effect.fail(new Error("Command timed out")))
      }, command.timeout ?? 30000)

      this.responseMap.set(msg.id, (response) => {
        clearTimeout(timeout)
        resume(Effect.succeed(response))
      })

      this.ws.send(JSON.stringify(msg))
    })
  }

  subscribe(channel: string): Effect.Effect<Stream.Stream<Message>> {
    return Effect.sync(() => {
      if (!this.messageQueue) {
        throw new Error("Not connected")
      }

      return Stream.fromQueue(this.messageQueue).pipe(
        Stream.filter((msg) => msg.channel === channel)
      )
    })
  }

  onMessage(
    filter?: (msg: Message) => boolean
  ): Effect.Effect<Stream.Stream<Message>> {
    return Effect.sync(() => {
      if (!this.messageQueue) {
        throw new Error("Not connected")
      }

      let stream = Stream.fromQueue(this.messageQueue)
      if (filter) {
        stream = Stream.filter(stream, filter)
      }
      return stream
    })
  }

  getStatus(): { connected: boolean; nodeId: NodeId | null } {
    return {
      connected: this.ws?.readyState === WebSocket.OPEN,
      nodeId: this.nodeId,
    }
  }
}

export interface NodeClientConfig {
  coordinatorUrl: string
  nodeId: string
  name: string
  capabilities?: string[]
  metadata?: Record<string, unknown>
}

export const createNodeClient = (config: NodeClientConfig): NodeClient => {
  return new NodeClient(config)
}
