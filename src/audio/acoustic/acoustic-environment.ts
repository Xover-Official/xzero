import type { TileCategory } from "../../pcg/types.js"

export interface AcousticProfile {
  name: string
  reverbTime: number
  earlyReflections: number
  lateReverb: number
  slapbackDelay: number
  slapbackGain: number
  occlusionFactor: number
  airAbsorption: number
  diffusion: number
  density: number
  highCut: number
  lowCut: number
  ambientVolume: number
  ambientType: AmbientType
  spatialSpread: number
  dopplerIntensity: number
}

export type AmbientType =
  | "silence"
  | "room_tone"
  | "classroom_ambience"
  | "hallway_echo"
  | "courtyard_birds"
  | "outdoor_wind"
  | "stairwell_footsteps"
  | "toilet_drip"
  | "entrance_traffic"
  | "utility_hum"

export const ACOUSTIC_PROFILES: Record<string, AcousticProfile> = {
  hallway: {
    name: "School Hallway",
    reverbTime: 1.2,
    earlyReflections: 0.6,
    lateReverb: 0.4,
    slapbackDelay: 0.08,
    slapbackGain: 0.3,
    occlusionFactor: 0.1,
    airAbsorption: 0.02,
    diffusion: 0.5,
    density: 0.7,
    highCut: 8000,
    lowCut: 80,
    ambientVolume: 0.15,
    ambientType: "hallway_echo",
    spatialSpread: 0.8,
    dopplerIntensity: 0.3,
  },

  classroom: {
    name: "Classroom",
    reverbTime: 0.6,
    earlyReflections: 0.8,
    lateReverb: 0.2,
    slapbackDelay: 0.04,
    slapbackGain: 0.15,
    occlusionFactor: 0.7,
    airAbsorption: 0.05,
    diffusion: 0.8,
    density: 0.9,
    highCut: 12000,
    lowCut: 60,
    ambientVolume: 0.08,
    ambientType: "classroom_ambience",
    spatialSpread: 0.4,
    dopplerIntensity: 0.1,
  },

  corridor: {
    name: "Wide Corridor",
    reverbTime: 1.5,
    earlyReflections: 0.5,
    lateReverb: 0.5,
    slapbackDelay: 0.12,
    slapbackGain: 0.35,
    occlusionFactor: 0.05,
    airAbsorption: 0.01,
    diffusion: 0.4,
    density: 0.6,
    highCut: 7000,
    lowCut: 100,
    ambientVolume: 0.2,
    ambientType: "hallway_echo",
    spatialSpread: 0.9,
    dopplerIntensity: 0.4,
  },

  courtyard: {
    name: "Courtyard",
    reverbTime: 2.0,
    earlyReflections: 0.3,
    lateReverb: 0.6,
    slapbackDelay: 0.15,
    slapbackGain: 0.2,
    occlusionFactor: 0.0,
    airAbsorption: 0.08,
    diffusion: 0.3,
    density: 0.4,
    highCut: 16000,
    lowCut: 40,
    ambientVolume: 0.25,
    ambientType: "courtyard_birds",
    spatialSpread: 1.0,
    dopplerIntensity: 0.6,
  },

  entrance: {
    name: "School Entrance",
    reverbTime: 1.0,
    earlyReflections: 0.5,
    lateReverb: 0.3,
    slapbackDelay: 0.06,
    slapbackGain: 0.25,
    occlusionFactor: 0.3,
    airAbsorption: 0.03,
    diffusion: 0.6,
    density: 0.7,
    highCut: 10000,
    lowCut: 70,
    ambientVolume: 0.2,
    ambientType: "entrance_traffic",
    spatialSpread: 0.7,
    dopplerIntensity: 0.3,
  },

  stairwell: {
    name: "Stairwell",
    reverbTime: 2.5,
    earlyReflections: 0.4,
    lateReverb: 0.7,
    slapbackDelay: 0.2,
    slapbackGain: 0.4,
    occlusionFactor: 0.15,
    airAbsorption: 0.04,
    diffusion: 0.3,
    density: 0.5,
    highCut: 6000,
    lowCut: 50,
    ambientVolume: 0.12,
    ambientType: "stairwell_footsteps",
    spatialSpread: 0.6,
    dopplerIntensity: 0.2,
  },

  toilet: {
    name: "Toilet",
    reverbTime: 1.8,
    earlyReflections: 0.7,
    lateReverb: 0.5,
    slapbackDelay: 0.1,
    slapbackGain: 0.3,
    occlusionFactor: 0.8,
    airAbsorption: 0.06,
    diffusion: 0.9,
    density: 0.8,
    highCut: 9000,
    lowCut: 60,
    ambientVolume: 0.1,
    ambientType: "toilet_drip",
    spatialSpread: 0.3,
    dopplerIntensity: 0.05,
  },

  utility: {
    name: "Utility Room",
    reverbTime: 0.8,
    earlyReflections: 0.6,
    lateReverb: 0.3,
    slapbackDelay: 0.05,
    slapbackGain: 0.2,
    occlusionFactor: 0.9,
    airAbsorption: 0.07,
    diffusion: 0.7,
    density: 0.8,
    highCut: 8000,
    lowCut: 50,
    ambientVolume: 0.15,
    ambientType: "utility_hum",
    spatialSpread: 0.2,
    dopplerIntensity: 0.05,
  },

  outdoor_path: {
    name: "Outdoor Walkway",
    reverbTime: 1.5,
    earlyReflections: 0.2,
    lateReverb: 0.4,
    slapbackDelay: 0.1,
    slapbackGain: 0.15,
    occlusionFactor: 0.0,
    airAbsorption: 0.1,
    diffusion: 0.2,
    density: 0.3,
    highCut: 18000,
    lowCut: 30,
    ambientVolume: 0.3,
    ambientType: "outdoor_wind",
    spatialSpread: 1.0,
    dopplerIntensity: 0.7,
  },

  open_space: {
    name: "Open Field",
    reverbTime: 3.0,
    earlyReflections: 0.1,
    lateReverb: 0.5,
    slapbackDelay: 0.2,
    slapbackGain: 0.1,
    occlusionFactor: 0.0,
    airAbsorption: 0.12,
    diffusion: 0.1,
    density: 0.2,
    highCut: 20000,
    lowCut: 20,
    ambientVolume: 0.35,
    ambientType: "courtyard_birds",
    spatialSpread: 1.0,
    dopplerIntensity: 0.8,
  },
}

export const DEFAULT_ACOUSTIC_PROFILE: AcousticProfile = {
  name: "Default Space",
  reverbTime: 0.8,
  earlyReflections: 0.5,
  lateReverb: 0.3,
  slapbackDelay: 0.06,
  slapbackGain: 0.2,
  occlusionFactor: 0.5,
  airAbsorption: 0.05,
  diffusion: 0.6,
  density: 0.7,
  highCut: 12000,
  lowCut: 60,
  ambientVolume: 0.1,
  ambientType: "room_tone",
  spatialSpread: 0.5,
  dopplerIntensity: 0.2,
}

export function getAcousticProfile(category: TileCategory): AcousticProfile {
  return ACOUSTIC_PROFILES[category] ?? DEFAULT_ACOUSTIC_PROFILE
}

export function lerpAcousticProfiles(
  profileA: AcousticProfile,
  profileB: AcousticProfile,
  t: number
): AcousticProfile {
  const clamp = (v: number) => Math.max(0, Math.min(1, v))
  const ct = clamp(t)

  return {
    name: ct < 0.5 ? profileA.name : profileB.name,
    reverbTime: profileA.reverbTime + (profileB.reverbTime - profileA.reverbTime) * ct,
    earlyReflections: profileA.earlyReflections + (profileB.earlyReflections - profileA.earlyReflections) * ct,
    lateReverb: profileA.lateReverb + (profileB.lateReverb - profileA.lateReverb) * ct,
    slapbackDelay: profileA.slapbackDelay + (profileB.slapbackDelay - profileA.slapbackDelay) * ct,
    slapbackGain: profileA.slapbackGain + (profileB.slapbackGain - profileA.slapbackGain) * ct,
    occlusionFactor: profileA.occlusionFactor + (profileB.occlusionFactor - profileA.occlusionFactor) * ct,
    airAbsorption: profileA.airAbsorption + (profileB.airAbsorption - profileA.airAbsorption) * ct,
    diffusion: profileA.diffusion + (profileB.diffusion - profileA.diffusion) * ct,
    density: profileA.density + (profileB.density - profileA.density) * ct,
    highCut: profileA.highCut + (profileB.highCut - profileA.highCut) * ct,
    lowCut: profileA.lowCut + (profileB.lowCut - profileA.lowCut) * ct,
    ambientVolume: profileA.ambientVolume + (profileB.ambientVolume - profileA.ambientVolume) * ct,
    ambientType: ct < 0.5 ? profileA.ambientType : profileB.ambientType,
    spatialSpread: profileA.spatialSpread + (profileB.spatialSpread - profileA.spatialSpread) * ct,
    dopplerIntensity: profileA.dopplerIntensity + (profileB.dopplerIntensity - profileA.dopplerIntensity) * ct,
  }
}

export function computeOcclusionFactor(
  playerPos: { x: number; y: number; z: number },
  sourcePos: { x: number; y: number; z: number },
  wallThickness: number,
  material: string
): number {
  const dx = sourcePos.x - playerPos.x
  const dy = sourcePos.y - playerPos.y
  const dz = sourcePos.z - playerPos.z
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)

  if (distance === 0) return 1.0

  const materialAbsorption: Record<string, number> = {
    concrete: 0.02,
    wood: 0.1,
    glass: 0.05,
    drywall: 0.15,
    brick: 0.03,
    metal: 0.01,
    air: 0.0,
  }

  const absorption = materialAbsorption[material] ?? 0.1
  const occlusion = Math.exp(-absorption * wallThickness * distance * 0.1)

  return Math.max(0, Math.min(1, occlusion))
}

export function computeDistanceAttenuation(
  distance: number,
  minDistance: number = 1,
  maxDistance: number = 50,
  rolloff: number = 1
): number {
  if (distance <= minDistance) return 1.0
  if (distance >= maxDistance) return 0.0

  const normalizedDist = (distance - minDistance) / (maxDistance - minDistance)
  return Math.pow(1 - normalizedDist, rolloff)
}

export function computeDopplerShift(
  sourceVelocity: { x: number; y: number; z: number },
  playerVelocity: { x: number; y: number; z: number },
  sourceToPlayer: { x: number; y: number; z: number },
  speedOfSound: number = 343
): number {
  const dist = Math.sqrt(
    sourceToPlayer.x ** 2 + sourceToPlayer.y ** 2 + sourceToPlayer.z ** 2
  )

  if (dist === 0) return 1.0

  const nx = sourceToPlayer.x / dist
  const ny = sourceToPlayer.y / dist
  const nz = sourceToPlayer.z / dist

  const vSource = sourceVelocity.x * nx + sourceVelocity.y * ny + sourceVelocity.z * nz
  const vPlayer = playerVelocity.x * nx + playerVelocity.y * ny + playerVelocity.z * nz

  const doppler = (speedOfSound + vPlayer) / (speedOfSound - vSource)

  return Math.max(0.5, Math.min(2.0, doppler))
}
