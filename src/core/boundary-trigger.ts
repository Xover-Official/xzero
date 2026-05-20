import { Effect, Ref, PubSub, Stream, Context, Layer } from "effect"

export interface ChunkCoord {
  x: number
  z: number
}

export interface PlayerPosition {
  x: number
  y: number
  z: number
}

export interface BoundaryTriggerEvent {
  type: "chunk_enter" | "chunk_exit" | "chunk_transition"
  previousChunk: ChunkCoord | null
  currentChunk: ChunkCoord
  playerPosition: PlayerPosition
  timestamp: number
}

export interface ChunkLifecycleEvent {
  type: "chunk_load" | "chunk_unload" | "chunk_collapse"
  chunk: ChunkCoord
  reason: "player_enter" | "player_exit" | "memory_pressure" | "maze_regeneration"
  timestamp: number
}

export class BoundaryTriggerSystem extends Context.Tag("xzero/BoundaryTrigger")<
  BoundaryTriggerSystem,
  {
    readonly updatePlayerPosition: (pos: PlayerPosition) => Effect.Effect<BoundaryTriggerEvent | null>
    readonly subscribeBoundaryEvents: () => Effect.Effect<Stream.Stream<BoundaryTriggerEvent>>
    readonly subscribeLifecycleEvents: () => Effect.Effect<Stream.Stream<ChunkLifecycleEvent>>
    readonly setChunkSize: (size: number) => Effect.Effect<void>
    readonly getChunkSize: () => Effect.Effect<number>
    readonly getCurrentChunk: () => Effect.Effect<ChunkCoord>
    readonly getLoadedChunks: () => Effect.Effect<Set<string>>
    readonly markChunkLoaded: (chunk: ChunkCoord) => Effect.Effect<void>
    readonly markChunkUnloaded: (chunk: ChunkCoord) => Effect.Effect<void>
  }
>() {}

export const makeBoundaryTriggerSystem = (chunkSize: number = 64) =>
  Effect.gen(function* () {
    const chunkSizeRef = yield* Ref.make(chunkSize)
    const currentChunkRef = yield* Ref.make<ChunkCoord>({ x: 0, z: 0 })
    const lastPositionRef = yield* Ref.make<PlayerPosition>({ x: 0, y: 0, z: 0 })
    const loadedChunksRef = yield* Ref.make<Set<string>>(new Set())
    const boundaryPubSub = yield* PubSub.unbounded<BoundaryTriggerEvent>()
    const lifecyclePubSub = yield* PubSub.unbounded<ChunkLifecycleEvent>()

    function chunkKey(chunk: ChunkCoord): string {
      return `${chunk.x},${chunk.z}`
    }

    function positionToChunk(pos: PlayerPosition, size: number): ChunkCoord {
      return {
        x: Math.floor(pos.x / size),
        z: Math.floor(pos.z / size),
      }
    }

    function chunksEqual(a: ChunkCoord, b: ChunkCoord): boolean {
      return a.x === b.x && a.z === b.z
    }

    function doMarkChunkLoaded(chunk: ChunkCoord): Effect.Effect<void> {
      return Effect.gen(function* () {
        const chunks = yield* Ref.get(loadedChunksRef)
        chunks.add(chunkKey(chunk))
        yield* Ref.set(loadedChunksRef, new Set(chunks))
      })
    }

    function doMarkChunkUnloaded(chunk: ChunkCoord): Effect.Effect<void> {
      return Effect.gen(function* () {
        const chunks = yield* Ref.get(loadedChunksRef)
        chunks.delete(chunkKey(chunk))
        yield* Ref.set(loadedChunksRef, new Set(chunks))
      })
    }

    return {
      updatePlayerPosition: (pos: PlayerPosition) =>
        Effect.gen(function* () {
          const size = yield* Ref.get(chunkSizeRef)
          const currentChunk = yield* Ref.get(currentChunkRef)
          const lastPos = yield* Ref.get(lastPositionRef)

          const newChunk = positionToChunk(pos, size)

          // Check if player crossed chunk boundary
          if (!chunksEqual(currentChunk, newChunk)) {
            const event: BoundaryTriggerEvent = {
              type: "chunk_transition",
              previousChunk: currentChunk,
              currentChunk: newChunk,
              playerPosition: pos,
              timestamp: Date.now(),
            }

            // Publish lifecycle events for old chunk unload
            const unloadEvent: ChunkLifecycleEvent = {
              type: "chunk_unload",
              chunk: currentChunk,
              reason: "player_exit",
              timestamp: Date.now(),
            }

            // Publish lifecycle events for new chunk load
            const loadEvent: ChunkLifecycleEvent = {
              type: "chunk_load",
              chunk: newChunk,
              reason: "player_enter",
              timestamp: Date.now(),
            }

            yield* Ref.set(currentChunkRef, newChunk)
            yield* Ref.set(lastPositionRef, pos)
            yield* PubSub.publish(boundaryPubSub, event)
            yield* PubSub.publish(lifecyclePubSub, unloadEvent)
            yield* PubSub.publish(lifecyclePubSub, loadEvent)

            // Mark chunks in lifecycle tracking
            yield* doMarkChunkUnloaded(currentChunk)
            yield* doMarkChunkLoaded(newChunk)

            return event
          }

          yield* Ref.set(lastPositionRef, pos)
          return null
        }),

      subscribeBoundaryEvents: () =>
        Effect.succeed(Stream.fromPubSub(boundaryPubSub)),

      subscribeLifecycleEvents: () =>
        Effect.succeed(Stream.fromPubSub(lifecyclePubSub)),

      setChunkSize: (size: number) =>
        Ref.set(chunkSizeRef, size),

      getChunkSize: () =>
        Ref.get(chunkSizeRef),

      getCurrentChunk: () =>
        Ref.get(currentChunkRef),

      getLoadedChunks: () =>
        Ref.get(loadedChunksRef),

      markChunkLoaded: (chunk: ChunkCoord) =>
        doMarkChunkLoaded(chunk),

      markChunkUnloaded: (chunk: ChunkCoord) =>
        doMarkChunkUnloaded(chunk),
    }
  })

export const BoundaryTriggerLive = (chunkSize?: number) =>
  Layer.effect(
    BoundaryTriggerSystem,
    makeBoundaryTriggerSystem(chunkSize ?? 64)
  )
