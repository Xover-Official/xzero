import { Effect, PubSub, Queue, Stream, Context, Layer } from "effect"
import type { Message, SystemEvent, NodeEvent, ChannelEvent, MessagePriority } from "./types.js"

export class EventBus extends Context.Tag("xzero/EventBus")<
  EventBus,
  {
    readonly publishMessage: (message: Message) => Effect.Effect<void>
    readonly publishEvent: (event: SystemEvent) => Effect.Effect<void>
    readonly subscribeMessages: (
      filter?: (msg: Message) => boolean
    ) => Effect.Effect<Stream.Stream<Message>>
    readonly subscribeEvents: (
      filter?: (event: SystemEvent) => boolean
    ) => Effect.Effect<Stream.Stream<SystemEvent>>
    readonly subscribeChannel: (
      channel: string
    ) => Effect.Effect<Stream.Stream<Message>>
    readonly subscribePriority: (
      priority: MessagePriority
    ) => Effect.Effect<Stream.Stream<Message>>
  }
>() {}

export const makeEventBus = Effect.gen(function* () {
  const messagePubSub = yield* PubSub.unbounded<Message>()
  const eventPubSub = yield* PubSub.unbounded<SystemEvent>()

  const channelSubscribers = new Map<string, Set<Queue.Queue<Message>>>()
  const priorityQueues = new Map<string, Set<Queue.Queue<Message>>>()

  function filterStream<T>(
    stream: Stream.Stream<T>,
    filter?: (item: T) => boolean
  ): Stream.Stream<T> {
    return filter ? Stream.filter(stream, (item) => filter(item)) : stream
  }

  return {
    publishMessage: (message: Message) =>
      Effect.gen(function* () {
        yield* PubSub.publish(messagePubSub, message)

        if (message.channel) {
          const subs = channelSubscribers.get(message.channel)
          if (subs) {
            for (const q of subs) {
              yield* Queue.offer(q, message).pipe(Effect.ignore)
            }
          }
        }

        const pSubs = priorityQueues.get(message.priority)
        if (pSubs) {
          for (const q of pSubs) {
            yield* Queue.offer(q, message).pipe(Effect.ignore)
          }
        }
      }),

    publishEvent: (event: SystemEvent) =>
      PubSub.publish(eventPubSub, event),

    subscribeMessages: (filter?: (msg: Message) => boolean) =>
      Effect.succeed(filterStream(Stream.fromPubSub(messagePubSub), filter)),

    subscribeEvents: (filter?: (event: SystemEvent) => boolean) =>
      Effect.succeed(filterStream(Stream.fromPubSub(eventPubSub), filter)),

    subscribeChannel: (channel: string) =>
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<Message>()
        if (!channelSubscribers.has(channel)) {
          channelSubscribers.set(channel, new Set())
        }
        channelSubscribers.get(channel)!.add(queue)

        return Stream.fromQueue(queue).pipe(
          Stream.ensuring(
            Effect.sync(() => {
              const subs = channelSubscribers.get(channel)
              if (subs) {
                subs.delete(queue)
                if (subs.size === 0) channelSubscribers.delete(channel)
              }
            })
          )
        )
      }),

    subscribePriority: (priority: MessagePriority) =>
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<Message>()
        if (!priorityQueues.has(priority)) {
          priorityQueues.set(priority, new Set())
        }
        priorityQueues.get(priority)!.add(queue)

        return Stream.fromQueue(queue).pipe(
          Stream.ensuring(
            Effect.sync(() => {
              const subs = priorityQueues.get(priority)
              if (subs) {
                subs.delete(queue)
                if (subs.size === 0) priorityQueues.delete(priority)
              }
            })
          )
        )
      }),
  }
})

export const EventBusLive = Layer.effect(EventBus, makeEventBus)
