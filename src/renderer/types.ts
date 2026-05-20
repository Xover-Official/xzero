import { v4 as uuidv4 } from "uuid"

export type ChunkId = string
export type AssetId = string
export type MeshId = string
export type MaterialId = string

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface Mat4 {
  elements: Float32Array
}

export interface Frustum {
  planes: Plane[]
  corners: Vec3[]
  center: Vec3
  radius: number
}

export interface Plane {
  normal: Vec3
  distance: number
}

export interface AABB {
  min: Vec3
  max: Vec3
  center: Vec3
  halfExtents: Vec3
}

export interface Sphere {
  center: Vec3
  radius: number
}

export interface Ray {
  origin: Vec3
  direction: Vec3
}

export interface ChunkCoordinate {
  x: number
  z: number
  level: number
}

export type ChunkState =
  | "unloaded"
  | "queued"
  | "loading"
  | "loaded"
  | "visible"
  | "occluded"
  | "unloading"
  | "error"

export type LodLevel = 0 | 1 | 2 | 3 | 4

export interface LodConfig {
  level: LodLevel
  maxDistance: number
  triangleBudget: number
  textureResolution: number
  errorThreshold: number
}

export const LOD_CONFIGS: LodConfig[] = [
  { level: 0, maxDistance: 50, triangleBudget: 100_000, textureResolution: 2048, errorThreshold: 0 },
  { level: 1, maxDistance: 150, triangleBudget: 25_000, textureResolution: 1024, errorThreshold: 0.02 },
  { level: 2, maxDistance: 500, triangleBudget: 5_000, textureResolution: 512, errorThreshold: 0.05 },
  { level: 3, maxDistance: 1500, triangleBudget: 1_000, textureResolution: 256, errorThreshold: 0.1 },
  { level: 4, maxDistance: Infinity, triangleBudget: 100, textureResolution: 128, errorThreshold: 0.25 },
]

export interface GeometryChunk {
  id: ChunkId
  coord: ChunkCoordinate
  state: ChunkState
  lod: LodLevel
  mesh?: MeshId
  material?: MaterialId
  bounds: AABB
  boundingSphere: Sphere
  vertexCount: number
  triangleCount: number
  textureMemoryBytes: number
  lastVisibleFrame: number
  loadPriority: number
  distanceToCamera: number
}

export interface SpatialCell {
  coord: ChunkCoordinate
  chunks: ChunkId[]
  bounds: AABB
  isOccluded: boolean
  lastVisibilityCheck: number
}

export interface BudgetTracker {
  maxTriangles: number
  maxDrawCalls: number
  maxTextureMemory: number
  currentTriangles: number
  currentDrawCalls: number
  currentTextureMemory: number
  currentLoadedChunks: number
  targetLoadedChunks: number
}

export interface CameraState {
  position: Vec3
  forward: Vec3
  up: Vec3
  right: Vec3
  fov: number
  aspectRatio: number
  nearPlane: number
  farPlane: number
  viewMatrix: Mat4
  projectionMatrix: Mat4
  frustum: Frustum
}

export interface StreamingPriority {
  chunkId: ChunkId
  score: number
  reason: "distance" | "visibility" | "importance" | "prediction" | "lod_transition"
}

export interface VisibilityResult {
  chunkId: ChunkId
  isVisible: boolean
  isOccluded: boolean
  screenCoverage: number
  distance: number
  lod: LodLevel
}

export interface RenderSchedule {
  frameNumber: number
  camera: CameraState
  visibleChunks: VisibilityResult[]
  loadQueue: ChunkId[]
  unloadQueue: ChunkId[]
  budget: BudgetTracker
  frameBudgetMs: number
  elapsedMs: number
}

export interface OcclusionQuery {
  bounds: AABB
  result: "visible" | "occluded" | "unknown"
  confidence: number
  lastTestedFrame: number
}

export interface LodTransition {
  chunkId: ChunkId
  fromLevel: LodLevel
  toLevel: LodLevel
  progress: number
  durationMs: number
}

export interface RendererConfig {
  chunkSize: number
  viewDistance: number
  maxTriangles: number
  maxDrawCalls: number
  maxTextureMemory: number
  frameBudgetMs: number
  streamingBandwidth: number
  lodBias: number
  occlusionCulling: boolean
  asyncLoading: boolean
  preloadRadius: number
  unloadDelayFrames: number
}

export const defaultRendererConfig: RendererConfig = {
  chunkSize: 64,
  viewDistance: 1000,
  maxTriangles: 5_000_000,
  maxDrawCalls: 2000,
  maxTextureMemory: 512 * 1024 * 1024,
  frameBudgetMs: 16,
  streamingBandwidth: 50 * 1024 * 1024,
  lodBias: 1.0,
  occlusionCulling: true,
  asyncLoading: true,
  preloadRadius: 1.5,
  unloadDelayFrames: 60,
}

export function createAABB(min: Vec3, max: Vec3): AABB {
  return {
    min,
    max,
    center: {
      x: (min.x + max.x) / 2,
      y: (min.y + max.y) / 2,
      z: (min.z + max.z) / 2,
    },
    halfExtents: {
      x: (max.x - min.x) / 2,
      y: (max.y - min.y) / 2,
      z: (max.z - min.z) / 2,
    },
  }
}

export function createSphere(center: Vec3, radius: number): Sphere {
  return { center, radius }
}

export function createChunkId(coord: ChunkCoordinate): ChunkId {
  return `${coord.x},${coord.z}@${coord.level}`
}

export function parseChunkId(id: ChunkId): ChunkCoordinate {
  const [pos, level] = id.split("@")
  const [x, z] = pos.split(",").map(Number)
  return { x, z, level: Number(level) }
}

export function vec3Sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

export function vec3Add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

export function vec3Scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s }
}

export function vec3Dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

export function vec3Length(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
}

export function vec3Normalize(v: Vec3): Vec3 {
  const len = vec3Length(v)
  return len === 0 ? { x: 0, y: 0, z: 0 } : vec3Scale(v, 1 / len)
}

export function vec3Distance(a: Vec3, b: Vec3): number {
  return vec3Length(vec3Sub(a, b))
}

export function vec3Cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

export function identityMat4(): Mat4 {
  const e = new Float32Array(16)
  e[0] = e[5] = e[10] = e[15] = 1
  return { elements: e }
}

export function createPlane(normal: Vec3, distance: number): Plane {
  return { normal: vec3Normalize(normal), distance }
}

export function planeDistanceToPoint(plane: Plane, point: Vec3): number {
  return vec3Dot(plane.normal, point) + plane.distance
}

export function createRay(origin: Vec3, direction: Vec3): Ray {
  return { origin, direction: vec3Normalize(direction) }
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function chunkCoordToWorld(coord: ChunkCoordinate, chunkSize: number): Vec3 {
  return {
    x: coord.x * chunkSize,
    y: 0,
    z: coord.z * chunkSize,
  }
}

export function worldToChunkCoord(position: Vec3, chunkSize: number): ChunkCoordinate {
  return {
    x: Math.floor(position.x / chunkSize),
    z: Math.floor(position.z / chunkSize),
    level: 0,
  }
}

export function visibleChunksInRadius(
  center: ChunkCoordinate,
  radius: number
): ChunkCoordinate[] {
  const chunks: ChunkCoordinate[] = []
  const r = Math.ceil(radius)
  for (let x = center.x - r; x <= center.x + r; x++) {
    for (let z = center.z - r; z <= center.z + r; z++) {
      chunks.push({ x, z, level: 0 })
    }
  }
  return chunks
}
