import { v4 as uuidv4 } from "uuid"

export type NodeId = string
export type ChannelId = string
export type MessageId = string

export interface NodeInfo {
  id: NodeId
  name: string
  capabilities: string[]
  status: "connecting" | "ready" | "busy" | "draining" | "disconnected"
  lastHeartbeat: number
  metadata: Record<string, unknown>
}

export interface Message {
  id: MessageId
  type: MessageType
  from: NodeId
  to: NodeId | ChannelId | "*"
  channel?: ChannelId
  payload: unknown
  timestamp: number
  priority: MessagePriority
  ttl: number
}

export type MessageType =
  | "command"
  | "response"
  | "event"
  | "heartbeat"
  | "register"
  | "deregister"
  | "subscribe"
  | "unsubscribe"
  | "error"

export type MessagePriority = "critical" | "high" | "normal" | "low"

export interface Command {
  type: "command"
  name: string
  args: Record<string, unknown>
  timeout: number
}

export interface Response {
  type: "response"
  commandId: MessageId
  success: boolean
  data: unknown
  error?: string
}

export interface NodeEvent {
  type: "node:joined" | "node:left" | "node:status_change" | "node:heartbeat"
  node: NodeInfo
  timestamp: number
}

export interface ChannelEvent {
  type: "channel:created" | "channel:destroyed" | "channel:message"
  channel: ChannelId
  message?: Message
  timestamp: number
}

export type SystemEvent = NodeEvent | ChannelEvent

export interface RoutingRule {
  id: string
  match: RoutingMatch
  action: RoutingAction
  priority: number
}

export interface RoutingMatch {
  type?: MessageType
  channel?: ChannelId
  from?: NodeId
  to?: NodeId | ChannelId
  capability?: string
}

export interface RoutingAction {
  type: "forward" | "broadcast" | "fanout" | "load_balance" | "drop"
  target?: NodeId | ChannelId | NodeId[]
}

export interface HealthCheck {
  nodeId: NodeId
  latency: number
  status: "healthy" | "degraded" | "unhealthy"
  timestamp: number
}

export interface CoordinatorConfig {
  port: number
  host: string
  heartbeatInterval: number
  heartbeatTimeout: number
  maxMessageSize: number
  messageTTL: number
  enableCompression: boolean
  logLevel: "debug" | "info" | "warn" | "error"
}

export const defaultConfig: CoordinatorConfig = {
  port: 9000,
  host: "0.0.0.0",
  heartbeatInterval: 5000,
  heartbeatTimeout: 15000,
  maxMessageSize: 1024 * 1024,
  messageTTL: 30000,
  enableCompression: false,
  logLevel: "info",
}

export function createMessage(
  type: MessageType,
  from: NodeId,
  to: NodeId | ChannelId | "*",
  payload: unknown,
  options?: Partial<Pick<Message, "channel" | "priority" | "ttl">>
): Message {
  return {
    id: uuidv4(),
    type,
    from,
    to,
    payload,
    timestamp: Date.now(),
    priority: options?.priority ?? "normal",
    ttl: options?.ttl ?? 30000,
    channel: options?.channel,
  }
}

export function createNodeInfo(
  name: string,
  capabilities: string[] = [],
  metadata: Record<string, unknown> = {}
): Omit<NodeInfo, "id"> {
  return {
    name,
    capabilities,
    status: "connecting" as const,
    lastHeartbeat: Date.now(),
    metadata,
  }
}
