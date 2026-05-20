import { Effect, Context, Layer, Ref } from "effect"
import type { Vec3 } from "./types.js"
import type { CameraState } from "./types.js"

export interface RenderTarget {
  readonly width: number
  readonly height: number
  readonly canvas: HTMLCanvasElement | OffscreenCanvas | null
}

export interface CanvasRenderer {
  readonly initialize: (canvas: HTMLCanvasElement | OffscreenCanvas) => Effect.Effect<void>
  readonly render: (camera: CameraState, frameNumber: number) => Effect.Effect<void>
  readonly resize: (width: number, height: number) => Effect.Effect<void>
  readonly getTarget: () => Effect.Effect<RenderTarget>
  readonly clear: (color?: [number, number, number, number]) => Effect.Effect<void>
  readonly drawTile: (
    x: number,
    y: number,
    z: number,
    typeId: string,
    rotation: number,
    scale: number
  ) => Effect.Effect<void>
}

export const CanvasRenderer = Context.GenericTag<CanvasRenderer>("xzero/renderer/CanvasRenderer")

const TILE_COLORS: Record<string, [number, number, number]> = {
  hallway_straight: [0.4, 0.4, 0.45],
  hallway_corner: [0.35, 0.35, 0.4],
  hallway_branch: [0.5, 0.35, 0.35],
  hallway_dead_end: [0.3, 0.25, 0.3],
  hallway_cross: [0.45, 0.45, 0.5],
  hallway_loop_connector: [0.35, 0.45, 0.35],
  classroom: [0.6, 0.55, 0.4],
  courtyard: [0.3, 0.5, 0.3],
  entrance: [0.55, 0.45, 0.35],
  stairwell: [0.4, 0.35, 0.45],
  toilet: [0.45, 0.5, 0.55],
  roof: [0.35, 0.4, 0.5],
}

const DEFAULT_COLOR: [number, number, number] = [0.3, 0.3, 0.35]

export function makeCanvasRenderer(): Effect.Effect<CanvasRenderer> {
  return Effect.gen(function* () {
    const targetRef = yield* Ref.make<RenderTarget>({
      width: 800,
      height: 600,
      canvas: null,
    })

    const ctxRef = yield* Ref.make<CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null>(null)

    const TILE_SIZE = 32

    return {
      initialize: (canvas) =>
        Effect.gen(function* () {
          const context = canvas.getContext("2d")
          if (!context) {
            return yield* Effect.fail(new Error("Failed to get 2D context"))
          }

          yield* Ref.set(ctxRef, context)
          yield* Ref.set(targetRef, {
            width: canvas.width,
            height: canvas.height,
            canvas,
          })
        }) as Effect.Effect<void>,

      render: (camera, frameNumber) =>
        Effect.gen(function* () {
          const ctx = yield* Ref.get(ctxRef)
          if (!ctx) return

          const target = yield* Ref.get(targetRef)

          // Clear with dark background
          ctx.fillStyle = "#1a1a2e"
          ctx.fillRect(0, 0, target.width, target.height)

          // Draw camera info overlay
          ctx.fillStyle = "#00ff88"
          ctx.font = "12px monospace"
          ctx.fillText(`Frame: ${frameNumber}`, 10, 20)
          ctx.fillText(`Camera: (${camera.position.x.toFixed(1)}, ${camera.position.y.toFixed(1)}, ${camera.position.z.toFixed(1)})`, 10, 35)
          ctx.fillText(`View Distance: ${(camera as any).viewDistance ?? 500}`, 10, 50)

          // Draw grid lines for visual reference
          ctx.strokeStyle = "rgba(255, 255, 255, 0.05)"
          ctx.lineWidth = 1
          const gridSize = TILE_SIZE * 4
          const offsetX = -camera.position.x * TILE_SIZE + target.width / 2
          const offsetZ = -camera.position.z * TILE_SIZE + target.height / 2

          for (let x = offsetX % gridSize; x < target.width; x += gridSize) {
            ctx.beginPath()
            ctx.moveTo(x, 0)
            ctx.lineTo(x, target.height)
            ctx.stroke()
          }
          for (let y = offsetZ % gridSize; y < target.height; y += gridSize) {
            ctx.beginPath()
            ctx.moveTo(0, y)
            ctx.lineTo(target.width, y)
            ctx.stroke()
          }

          // Draw player marker
          const playerScreenX = target.width / 2
          const playerScreenY = target.height / 2
          ctx.fillStyle = "#ff4444"
          ctx.beginPath()
          ctx.arc(playerScreenX, playerScreenY, 6, 0, Math.PI * 2)
          ctx.fill()
          ctx.strokeStyle = "#ff8888"
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(playerScreenX, playerScreenY, 10, 0, Math.PI * 2)
          ctx.stroke()
        }) as Effect.Effect<void>,

      resize: (width, height) =>
        Effect.gen(function* () {
          const target = yield* Ref.get(targetRef)
          const canvas = target.canvas
          if (canvas) {
            canvas.width = width
            canvas.height = height
          }
          yield* Ref.set(targetRef, { width, height, canvas })
        }) as Effect.Effect<void>,

      getTarget: () =>
        Ref.get(targetRef),

      clear: (color = [0.1, 0.1, 0.18, 1]) =>
        Effect.gen(function* () {
          const ctx = yield* Ref.get(ctxRef)
          const target = yield* Ref.get(targetRef)
          if (!ctx) return

          ctx.fillStyle = `rgba(${color[0] * 255}, ${color[1] * 255}, ${color[2] * 255}, ${color[3]})`
          ctx.fillRect(0, 0, target.width, target.height)
        }) as Effect.Effect<void>,

      drawTile: (x, y, z, typeId, rotation, scale) =>
        Effect.gen(function* () {
          const ctx = yield* Ref.get(ctxRef)
          const target = yield* Ref.get(targetRef)
          if (!ctx) return

          const camera = { x: 0, z: 0 } // Would come from camera state
          const screenX = (x - camera.x) * TILE_SIZE * scale + target.width / 2
          const screenY = (z - camera.z) * TILE_SIZE * scale + target.height / 2

          const color = TILE_COLORS[typeId] ?? DEFAULT_COLOR
          ctx.fillStyle = `rgb(${color[0] * 255}, ${color[1] * 255}, ${color[2] * 255})`

          const size = TILE_SIZE * scale
          ctx.save()
          ctx.translate(screenX + size / 2, screenY + size / 2)
          ctx.rotate((rotation * Math.PI) / 180)
          ctx.fillRect(-size / 2, -size / 2, size, size)

          // Draw tile type label for debug
          ctx.fillStyle = "rgba(255, 255, 255, 0.3)"
          ctx.font = `${8 * scale}px monospace`
          ctx.textAlign = "center"
          ctx.fillText(typeId.replace("hallway_", "").substring(0, 6), 0, 3 * scale)
          ctx.restore()
        }) as Effect.Effect<void>,
    }
  })
}

export const CanvasRendererLive = Layer.effect(CanvasRenderer, makeCanvasRenderer())
