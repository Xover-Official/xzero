import { Effect, Context } from "effect"
import type { CameraState, Vec3, Mat4, Frustum, Plane } from "./types.js"
import {
  identityMat4,
  vec3Cross,
  vec3Sub,
  vec3Normalize,
  vec3Scale,
  vec3Dot,
  vec3Add,
  createPlane,
} from "./types.js"

function lookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const f = vec3Normalize(vec3Sub(target, eye))
  const r = vec3Normalize(vec3Cross(f, up))
  const u = vec3Cross(r, f)
  const e = new Float32Array(16)

  e[0] = r.x; e[1] = u.x; e[2] = -f.x; e[3] = 0
  e[4] = r.y; e[5] = u.y; e[6] = -f.y; e[7] = 0
  e[8] = r.z; e[9] = u.z; e[10] = -f.z; e[11] = 0
  e[12] = -vec3Dot(r, eye); e[13] = -vec3Dot(u, eye); e[14] = vec3Dot(f, eye); e[15] = 1

  return { elements: e }
}

function perspective(fov: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1.0 / Math.tan(fov / 2)
  const nf = 1 / (near - far)
  const e = new Float32Array(16)

  e[0] = f / aspect; e[1] = 0; e[2] = 0; e[3] = 0
  e[4] = 0; e[5] = f; e[6] = 0; e[7] = 0
  e[8] = 0; e[9] = 0; e[10] = (far + near) * nf; e[11] = -1
  e[12] = 0; e[13] = 0; e[14] = 2 * far * near * nf; e[15] = 0

  return { elements: e }
}

function extractFrustum(viewProj: Mat4): Frustum {
  const m = viewProj.elements
  const planes: Plane[] = []

  planes.push(createPlane(
    { x: m[3] + m[0], y: m[7] + m[4], z: m[11] + m[8] },
    m[15] + m[12]
  ))
  planes.push(createPlane(
    { x: m[3] - m[0], y: m[7] - m[4], z: m[11] - m[8] },
    m[15] - m[12]
  ))
  planes.push(createPlane(
    { x: m[3] + m[1], y: m[7] + m[5], z: m[11] + m[9] },
    m[15] + m[13]
  ))
  planes.push(createPlane(
    { x: m[3] - m[1], y: m[7] - m[5], z: m[11] - m[9] },
    m[15] - m[13]
  ))
  planes.push(createPlane(
    { x: m[3] + m[2], y: m[7] + m[6], z: m[11] + m[10] },
    m[15] + m[14]
  ))
  planes.push(createPlane(
    { x: m[3] - m[2], y: m[7] - m[6], z: m[11] - m[10] },
    m[15] - m[14]
  ))

  const corners: Vec3[] = []
  const nearH = Math.tan(Math.PI / 6) * 0.1
  const nearW = nearH * 1.6
  const farH = Math.tan(Math.PI / 6) * 1000
  const farW = farH * 1.6

  corners.push({ x: -farW, y: -farH, z: -1000 })
  corners.push({ x: farW, y: -farH, z: -1000 })
  corners.push({ x: farW, y: farH, z: -1000 })
  corners.push({ x: -farW, y: farH, z: -1000 })

  const center: Vec3 = { x: 0, y: 0, z: -500 }
  const radius = Math.sqrt(farW * farW + farH * farH + 1000 * 1000)

  return { planes, corners, center, radius }
}

export function createCamera(
  position: Vec3,
  target: Vec3,
  up: Vec3,
  fov: number,
  aspect: number,
  near: number,
  far: number
): CameraState {
  const viewMatrix = lookAt(position, target, up)
  const projMatrix = perspective(fov, aspect, near, far)

  const viewProj = multiplyMat4(projMatrix, viewMatrix)
  const frustum = extractFrustum(viewProj)

  const forward = vec3Normalize(vec3Sub(target, position))
  const right = vec3Normalize(vec3Cross(forward, up))
  const correctedUp = vec3Cross(right, forward)

  return {
    position, forward, up: correctedUp, right,
    fov, aspectRatio: aspect, nearPlane: near, farPlane: far,
    viewMatrix, projectionMatrix: viewProj, frustum,
  }
}

function multiplyMat4(a: Mat4, b: Mat4): Mat4 {
  const ae = a.elements, be = b.elements, e = new Float32Array(16)
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      e[i * 4 + j] =
        ae[i * 4] * be[j] +
        ae[i * 4 + 1] * be[4 + j] +
        ae[i * 4 + 2] * be[8 + j] +
        ae[i * 4 + 3] * be[12 + j]
    }
  }
  return { elements: e }
}

export function updateCamera(
  state: CameraState,
  position: Vec3,
  target: Vec3
): CameraState {
  return createCamera(
    position, target, state.up,
    state.fov, state.aspectRatio,
    state.nearPlane, state.farPlane
  )
}

export function moveCameraRelative(
  state: CameraState,
  forwardDelta: number,
  rightDelta: number,
  upDelta: number
): CameraState {
  const pos = vec3Add(
    vec3Add(
      vec3Add(state.position, vec3Scale(state.forward, forwardDelta)),
      vec3Scale(state.right, rightDelta)
    ),
    vec3Scale(state.up, upDelta)
  )
  const target = vec3Add(pos, state.forward)
  return updateCamera(state, pos, target)
}

export function rotateCamera(
  state: CameraState,
  yaw: number,
  pitch: number
): CameraState {
  const maxPitch = Math.PI / 2 - 0.01
  const clampedPitch = Math.max(-maxPitch, Math.min(maxPitch, pitch))

  const cosYaw = Math.cos(yaw), sinYaw = Math.sin(yaw)
  const cosPitch = Math.cos(clampedPitch), sinPitch = Math.sin(clampedPitch)

  const forward: Vec3 = {
    x: sinYaw * cosPitch,
    y: sinPitch,
    z: cosYaw * cosPitch,
  }

  const target = vec3Add(state.position, forward)
  return createCamera(
    state.position, target, { x: 0, y: 1, z: 0 },
    state.fov, state.aspectRatio,
    state.nearPlane, state.farPlane
  )
}

export function resolveFrustumCorners(frustum: Frustum, near: number, far: number): Vec3[] {
  const fov = Math.PI / 3
  const aspect = 16 / 9
  const nearH = Math.tan(fov / 2) * near
  const nearW = nearH * aspect
  const farH = Math.tan(fov / 2) * far
  const farW = farH * aspect

  return [
    { x: -nearW, y: -nearH, z: -near },
    { x: nearW, y: -nearH, z: -near },
    { x: nearW, y: nearH, z: -near },
    { x: -nearW, y: nearH, z: -near },
    { x: -farW, y: -farH, z: -far },
    { x: farW, y: -farH, z: -far },
    { x: farW, y: farH, z: -far },
    { x: -farW, y: farH, z: -far },
  ]
}

export class CameraManager extends Context.Tag("xzero/CameraManager")<
  CameraManager,
  {
    readonly getCamera: () => Effect.Effect<CameraState>
    readonly setCamera: (camera: CameraState) => Effect.Effect<void>
    readonly moveForward: (delta: number) => Effect.Effect<CameraState>
    readonly moveRight: (delta: number) => Effect.Effect<CameraState>
    readonly moveUp: (delta: number) => Effect.Effect<CameraState>
    readonly rotate: (yaw: number, pitch: number) => Effect.Effect<CameraState>
    readonly setPosition: (pos: Vec3, target: Vec3) => Effect.Effect<CameraState>
  }
>() {}
