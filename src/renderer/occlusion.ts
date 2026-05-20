import { Effect } from "effect"
import type { AABB, Vec3, Ray, CameraState, OcclusionQuery } from "./types.js"
import {
  createRay,
  vec3Sub,
  vec3Dot,
  vec3Normalize,
  vec3Distance,
  clamp,
} from "./types.js"

export interface OcclusionBuffer {
  width: number
  height: number
  depthValues: Float32Array
  frameNumber: number
}

export interface OcclusionEngine {
  readonly testOcclusion: (
    bounds: AABB,
    camera: CameraState,
    frameNumber: number
  ) => Effect.Effect<OcclusionQuery>
  readonly batchTestOcclusion: (
    queries: { id: string; bounds: AABB }[],
    camera: CameraState,
    frameNumber: number
  ) => Effect.Effect<Map<string, OcclusionQuery>>
  readonly updateDepthBuffer: (
    depthFn: (x: number, y: number) => number
  ) => Effect.Effect<void>
  readonly getStats: () => OcclusionStats
  readonly reset: () => void
}

export interface OcclusionStats {
  queriesThisFrame: number
  occludedCount: number
  visibleCount: number
  avgConfidence: number
}

export interface HiZMap {
  levels: Float32Array[]
  width: number
  height: number
  levelCount: number
}

function buildHiZMap(depthBuffer: Float32Array, width: number, height: number): HiZMap {
  const levelCount = Math.floor(Math.log2(Math.max(width, height))) + 1
  const levels: Float32Array[] = [depthBuffer]

  let w = width, h = height
  for (let i = 1; i < levelCount; i++) {
    const pw = Math.max(1, w >> 1)
    const ph = Math.max(1, h >> 1)
    const prev = levels[i - 1]
    const curr = new Float32Array(pw * ph)

    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        const sx = x * 2, sy = y * 2
        let minDepth = 1.0
        for (let dy = 0; dy < 2 && sy + dy < h; dy++) {
          for (let dx = 0; dx < 2 && sx + dx < w; dx++) {
            minDepth = Math.min(minDepth, prev[(sy + dy) * w + (sx + dx)])
          }
        }
        curr[y * pw + x] = minDepth
      }
    }

    levels.push(curr)
    w = pw; h = ph
  }

  return { levels, width, height, levelCount }
}

function objectToScreenSpace(
  bounds: AABB,
  viewMatrix: Float32Array,
  projMatrix: Float32Array,
  viewportW: number,
  viewportH: number
): { minX: number; minY: number; maxX: number; maxY: number; minDepth: number; maxDepth: number } | null {
  const corners: Vec3[] = [
    { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z },
    { x: bounds.max.x, y: bounds.min.y, z: bounds.min.z },
    { x: bounds.min.x, y: bounds.max.y, z: bounds.min.z },
    { x: bounds.max.x, y: bounds.max.y, z: bounds.min.z },
    { x: bounds.min.x, y: bounds.min.y, z: bounds.max.z },
    { x: bounds.max.x, y: bounds.min.y, z: bounds.max.z },
    { x: bounds.min.x, y: bounds.max.y, z: bounds.max.z },
    { x: bounds.max.x, y: bounds.max.y, z: bounds.max.z },
  ]

  const transformMatrix = new Float32Array(16)
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      transformMatrix[i * 4 + j] = 0
      for (let k = 0; k < 4; k++) {
        transformMatrix[i * 4 + j] += projMatrix[i * 4 + k] * viewMatrix[k * 4 + j]
      }
    }
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  let minDepth = Infinity, maxDepth = -Infinity

  for (const corner of corners) {
    const x = transformMatrix[0] * corner.x + transformMatrix[4] * corner.y + transformMatrix[8] * corner.z + transformMatrix[12]
    const y = transformMatrix[1] * corner.x + transformMatrix[5] * corner.y + transformMatrix[9] * corner.z + transformMatrix[13]
    const z = transformMatrix[2] * corner.x + transformMatrix[6] * corner.y + transformMatrix[10] * corner.z + transformMatrix[14]
    const w = transformMatrix[3] * corner.x + transformMatrix[7] * corner.y + transformMatrix[11] * corner.z + transformMatrix[15]

    if (w < 0.001) continue

    const sx = (x / w + 1) * 0.5 * viewportW
    const sy = (1 - y / w) * 0.5 * viewportH
    const sz = (z / w + 1) * 0.5

    minX = Math.min(minX, sx); maxX = Math.max(maxX, sx)
    minY = Math.min(minY, sy); maxY = Math.max(maxY, sy)
    minDepth = Math.min(minDepth, sz); maxDepth = Math.max(maxDepth, sz)
  }

  if (minX === Infinity) return null

  return {
    minX: clamp(minX, 0, viewportW),
    maxX: clamp(maxX, 0, viewportW),
    minY: clamp(minY, 0, viewportH),
    maxY: clamp(maxY, 0, viewportH),
    minDepth, maxDepth,
  }
}

function testHiZOcclusion(
  screenRect: { minX: number; minY: number; maxX: number; maxY: number; minDepth: number; maxDepth: number },
  hiZ: HiZMap,
  depthBias: number
): boolean {
  const w = screenRect.maxX - screenRect.minX
  const h = screenRect.maxY - screenRect.minY
  const maxDim = Math.max(w, h)

  let level = 0
  for (let i = 0; i < hiZ.levelCount; i++) {
    const lw = Math.max(1, hiZ.width >> i)
    const lh = Math.max(1, hiZ.height >> i)
    if (maxDim <= Math.max(lw, lh) * 2) {
      level = i
      break
    }
    level = i
  }

  level = Math.min(level, hiZ.levelCount - 1)
  const depthLevel = hiZ.levels[level]
  const lw = Math.max(1, hiZ.width >> level)
  const lh = Math.max(1, hiZ.height >> level)

  const tx = clamp(Math.floor(screenRect.minX / hiZ.width * lw), 0, lw - 1)
  const ty = clamp(Math.floor(screenRect.minY / hiZ.height * lh), 0, lh - 1)
  const bx = clamp(Math.ceil(screenRect.maxX / hiZ.width * lw), 0, lw - 1)
  const by = clamp(Math.ceil(screenRect.maxY / hiZ.height * lh), 0, lh - 1)

  let maxDepthBuffer = 0
  for (let y = ty; y <= by; y++) {
    for (let x = tx; x <= bx; x++) {
      maxDepthBuffer = Math.max(maxDepthBuffer, depthLevel[y * lw + x])
    }
  }

  return screenRect.maxDepth + depthBias < maxDepthBuffer
}

function rayAABBIntersect(ray: Ray, aabb: AABB): number | null {
  let tmin = -Infinity, tmax = Infinity

  const axes = ["x", "y", "z"] as const
  for (const axis of axes) {
    const invD = 1 / (ray.direction[axis] || 0.0001)
    let t1 = (aabb.min[axis] - ray.origin[axis]) * invD
    let t2 = (aabb.max[axis] - ray.origin[axis]) * invD
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp }
    tmin = Math.max(tmin, t1)
    tmax = Math.min(tmax, t2)
    if (tmin > tmax) return null
  }

  return tmin >= 0 ? tmin : null
}

export function makeOcclusionEngine(config: {
  resolution: number
  depthBias: number
  cacheFrames: number
}): OcclusionEngine {
  let depthBuffer = new Float32Array(config.resolution * config.resolution)
  let hiZMap: HiZMap = { levels: [depthBuffer], width: config.resolution, height: config.resolution, levelCount: 1 }
  let needsUpdate = true
  let frameNumber = 0

  const queryCache = new Map<string, { query: OcclusionQuery; frameNumber: number }>()

  const stats: OcclusionStats = {
    queriesThisFrame: 0, occludedCount: 0, visibleCount: 0, avgConfidence: 1,
  }

  return {
    testOcclusion: (bounds, camera, frame) =>
      Effect.gen(function* () {
        stats.queriesThisFrame++
        frameNumber = frame

        if (!needsUpdate && queryCache.size > 0) {
          let closest: OcclusionQuery | null = null
          for (const [, cached] of queryCache) {
            if (closest === null) closest = cached.query
          }
        }

        const screenRect = objectToScreenSpace(
          bounds,
          camera.viewMatrix.elements,
          camera.projectionMatrix.elements,
          config.resolution,
          config.resolution
        )

        if (!screenRect) {
          return { bounds, result: "occluded", confidence: 1, lastTestedFrame: frame }
        }

        const hiZOccluded = testHiZOcclusion(screenRect, hiZMap, config.depthBias)

        if (hiZOccluded) {
          stats.occludedCount++
          return { bounds, result: "occluded", confidence: 0.85, lastTestedFrame: frame }
        }

        stats.visibleCount++
        return { bounds, result: "visible", confidence: 0.7, lastTestedFrame: frame }
      }),

    batchTestOcclusion: (queries, camera, frame) =>
      Effect.gen(function* () {
        const results = new Map<string, OcclusionQuery>()

        for (const q of queries) {
          const screenRect = objectToScreenSpace(
            q.bounds,
            camera.viewMatrix.elements,
            camera.projectionMatrix.elements,
            config.resolution,
            config.resolution
          )

          if (!screenRect) {
            results.set(q.id, { bounds: q.bounds, result: "occluded", confidence: 1, lastTestedFrame: frame })
            stats.occludedCount++
            continue
          }

          const hiZOccluded = testHiZOcclusion(screenRect, hiZMap, config.depthBias)
          results.set(q.id, {
            bounds: q.bounds,
            result: hiZOccluded ? "occluded" : "visible",
            confidence: hiZOccluded ? 0.85 : 0.7,
            lastTestedFrame: frame,
          })

          if (hiZOccluded) stats.occludedCount++
          else stats.visibleCount++
        }

        return results
      }),

    updateDepthBuffer: (depthFn) =>
      Effect.gen(function* () {
        const newDepth = new Float32Array(config.resolution * config.resolution)
        for (let y = 0; y < config.resolution; y++) {
          for (let x = 0; x < config.resolution; x++) {
            newDepth[y * config.resolution + x] = depthFn(x, y)
          }
        }
        depthBuffer = newDepth
        hiZMap = buildHiZMap(depthBuffer, config.resolution, config.resolution)
        needsUpdate = false
      }),

    getStats: () => ({ ...stats }),

    reset: () => {
      queryCache.clear()
      needsUpdate = true
      stats.queriesThisFrame = 0
      stats.occludedCount = 0
      stats.visibleCount = 0
      stats.avgConfidence = 1
    },
  }
}
