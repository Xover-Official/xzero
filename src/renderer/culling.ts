import { Effect, Ref } from "effect"
import type { AABB, Sphere, Frustum, Plane, Vec3, ChunkCoordinate, ChunkId, GeometryChunk, CameraState, VisibilityResult } from "./types.js"
import {
  planeDistanceToPoint,
  vec3Dot,
  vec3Sub,
  createAABB,
  createSphere,
  createChunkId,
  worldToChunkCoord,
  visibleChunksInRadius,
} from "./types.js"

export function aabbOnFrustumPlane(aabb: AABB, plane: Plane): "inside" | "intersect" | "outside" {
  const nx = aabb.halfExtents.x * Math.abs(plane.normal.x)
  const ny = aabb.halfExtents.y * Math.abs(plane.normal.y)
  const nz = aabb.halfExtents.z * Math.abs(plane.normal.z)
  const radius = nx + ny + nz
  const distance = planeDistanceToPoint(plane, aabb.center)

  if (distance > radius) return "inside"
  if (distance < -radius) return "outside"
  return "intersect"
}

export function sphereOnFrustumPlane(sphere: Sphere, plane: Plane): "inside" | "outside" {
  const distance = planeDistanceToPoint(plane, sphere.center)
  return distance > sphere.radius ? "inside" : "outside"
}

export function isAABBInFrustum(aabb: AABB, frustum: Frustum): boolean {
  for (const plane of frustum.planes) {
    const result = aabbOnFrustumPlane(aabb, plane)
    if (result === "outside") return false
  }
  return true
}

export function isSphereInFrustum(sphere: Sphere, frustum: Frustum): boolean {
  for (const plane of frustum.planes) {
    if (sphereOnFrustumPlane(sphere, plane) === "outside") return false
  }
  return true
}

export interface CullingStats {
  totalTested: number
  frustumPassed: number
  occlusionPassed: number
  totalVisible: number
  cullingTimeMs: number
}

export interface SpatialIndex {
  cells: Map<string, ChunkCoordinate[]>
  cellSize: number
}

export function createSpatialIndex(cellSize: number): SpatialIndex {
  return { cells: new Map(), cellSize }
}

export function cellKey(x: number, z: number): string {
  return `${Math.floor(x)},${Math.floor(z)}`
}

export function cellKeyFromCoord(coord: ChunkCoordinate): string {
  return cellKey(coord.x, coord.z)
}

export function chunksInFrustum(
  chunks: Map<ChunkId, GeometryChunk>,
  frustum: Frustum,
  cameraPos: Vec3,
  viewDistance: number
): Map<ChunkId, GeometryChunk> {
  const visible = new Map<ChunkId, GeometryChunk>()

  for (const [id, chunk] of chunks) {
    if (!isAABBInFrustum(chunk.bounds, frustum)) continue

    const dist = vec3Dist(chunk.bounds.center, cameraPos)
    if (dist > viewDistance) continue

    visible.set(id, chunk)
  }

  return visible
}

function vec3Dist(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

export interface FrustumCullingEngine {
  readonly cullChunks: (
    chunks: Map<ChunkId, GeometryChunk>,
    camera: CameraState,
    viewDistance: number
  ) => Effect.Effect<{ visible: VisibilityResult[]; stats: CullingStats }>
  readonly getSpatialIndex: () => SpatialIndex
  readonly rebuildSpatialIndex: (chunks: Map<ChunkId, GeometryChunk>) => void
}

export function makeFrustumCullingEngine(config: { chunkSize: number; viewDistance: number }): FrustumCullingEngine {
  const spatialIndex = createSpatialIndex(config.chunkSize * 4)

  function rebuildSpatialIndex(chunks: Map<ChunkId, GeometryChunk>): void {
    spatialIndex.cells.clear()
    for (const [, chunk] of chunks) {
      const key = cellKeyFromCoord(chunk.coord)
      if (!spatialIndex.cells.has(key)) {
        spatialIndex.cells.set(key, [])
      }
      spatialIndex.cells.get(key)!.push(chunk.coord)
    }
  }

  function candidateChunks(chunks: Map<ChunkId, GeometryChunk>, cameraPos: Vec3): [ChunkId, GeometryChunk][] {
    const cameraCoord = worldToChunkCoord(cameraPos, config.chunkSize)
    const radius = Math.ceil(config.viewDistance / config.chunkSize) + 1
    const candidates: [ChunkId, GeometryChunk][] = []

    for (let x = cameraCoord.x - radius; x <= cameraCoord.x + radius; x++) {
      for (let z = cameraCoord.z - radius; z <= cameraCoord.z + radius; z++) {
        const key = cellKey(x, z)
        const cellCoords = spatialIndex.cells.get(key)
        if (!cellCoords) continue

        for (const coord of cellCoords) {
          const id = createChunkId(coord)
          const chunk = chunks.get(id)
          if (chunk && chunk.state !== "unloaded" && chunk.state !== "queued") {
            candidates.push([id, chunk])
          }
        }
      }
    }

    return candidates
  }

  return {
    cullChunks: (chunks, camera, viewDistance) =>
      Effect.gen(function* () {
        const startTime = performance.now()
        const visible: VisibilityResult[] = []
        let frustumPassed = 0
        let totalTested = 0

        const candidates = candidateChunks(chunks, camera.position)

        for (const [id, chunk] of candidates) {
          totalTested++

          if (!isAABBInFrustum(chunk.bounds, camera.frustum)) continue
          frustumPassed++

          const dist = vec3Dist(chunk.bounds.center, camera.position)
          if (dist > viewDistance) continue

          const screenCoverage = computeScreenCoverage(chunk.boundingSphere, dist, camera)
          const lod = selectLod(dist, viewDistance)

          visible.push({
            chunkId: id, isVisible: true, isOccluded: false,
            screenCoverage, distance: dist, lod,
          })
        }

        const endTime = performance.now()

        return {
          visible,
          stats: {
            totalTested,
            frustumPassed,
            occlusionPassed: 0,
            totalVisible: visible.length,
            cullingTimeMs: endTime - startTime,
          },
        }
      }),

    getSpatialIndex: () => spatialIndex,

    rebuildSpatialIndex,
  }
}

function computeScreenCoverage(sphere: Sphere, distance: number, camera: CameraState): number {
  if (distance <= 0) return 1

  const fovScale = 2 * Math.tan(camera.fov / 2)
  const screenHeightAtDist = 2 * distance * Math.tan(camera.fov / 2)
  const coverage = (sphere.radius * 2) / screenHeightAtDist

  return Math.min(coverage, 1)
}

function selectLod(distance: number, viewDistance: number): 0 | 1 | 2 | 3 | 4 {
  const ratios = [0.05, 0.15, 0.5, 0.85, 1.0]
  const normalizedDist = distance / viewDistance

  if (normalizedDist < ratios[0]) return 0
  if (normalizedDist < ratios[1]) return 1
  if (normalizedDist < ratios[2]) return 2
  if (normalizedDist < ratios[3]) return 3
  return 4
}
