export interface GridCoord {
  x: number
  y: number
}

export interface TileType {
  id: string
  name: string
  category: TileCategory
  stressLevel: StressLevel
  mextCompliance: MEXTZone | null
  connectivity: ConnectivityProfile
  transitionWeight: number
}

export type TileCategory =
  | "hallway"
  | "courtyard"
  | "classroom"
  | "corridor"
  | "entrance"
  | "stairwell"
  | "toilet"
  | "utility"
  | "outdoor_path"
  | "open_space"

export type StressLevel =
  | "high"    // busy corridors, intersections, gates — high anxiety
  | "medium"  // standard hallways, classrooms — moderate
  | "low"     // courtyards, outdoor paths — calming

export type MEXTZone =
  | "instructional"  // classrooms, labs — 3.3m²/student minimum
  | "circulation"     // hallways, corridors — 2.0m²/student minimum
  | "service"         // toilets, utilities — separate from instructional
  | "open"            // courtyards, outdoor — ≥30% of site area
  | "entrance"        // entry zones — buffer between street and instructional

export interface ConnectivityProfile {
  doors: number       // how many open sides this tile connects to
  maxCorridorWidth: number  // cells wide this tile can span
  requiredAdjacency: TileCategory[]  // what should be adjacent (soft rule)
  forbiddenAdjacency: TileCategory[] // what must not be adjacent (hard rule)
}

export interface Tile {
  typeId: string
  rotation: number    // 0, 90, 180, 270 degrees
  flipX: boolean
}

export interface GridCell {
  coord: GridCoord
  possibleTiles: Set<string>  // tile IDs still possible (WFC superpositions)
  collapsed: boolean
  tile: Tile | null
  stressLevel: StressLevel
  mextZone: MEXTZone | null
}

export interface LayoutGrid {
  width: number
  height: number
  cells: Map<string, GridCell>  // key = "x,y"
  mextStats: MEXTStats
}

export interface MEXTStats {
  totalCells: number
  instructionalCells: number
  circulationCells: number
  serviceCells: number
  openCells: number
  entranceCells: number
  stressZones: { high: number; medium: number; low: number }
  courtyardCount: number
  courtyardSizes: number[]
  circulationRatio: number
  openAreaRatio: number
}

export interface LayoutSeed {
  entranceCoord: GridCoord
  courtyardSeeds: GridCoord[]
  classroomBlockSeeds: GridCoord[]
}

export interface WFCConfig {
  gridWidth: number
  gridHeight: number
  seed: number
  maxIterations: number
  backtrackLimit: number
  mextEnabled: boolean
  stressCyclingEnabled: boolean
  stressCycleLength: number  // cells before alternating high→low
  mazeMode?: boolean         // force branching paths, loops, dead-ends
  loopClosureBias?: number   // 0-1, probability to force loop connections
  deadEndRatio?: number      // target ratio of dead-end tiles (0.15-0.30)
  branchWeight?: number      // multiplier for branching corridor selection
}

export interface GenerationResult {
  success: boolean
  grid: LayoutGrid | null
  iterations: number
  backtracks: number
  errors: string[]
  mextReport: MEXTComplianceReport | null
}

export interface MEXTComplianceReport {
  compliant: boolean
  violations: MEXTViolation[]
  circulationRatio: number  // should be ≥ 0.13 (13%) for circulation
  openAreaRatio: number     // should be ≥ 0.30 (30%) for open/courtyard
  courtyardRequirements: CourtyardRequirement[]
}

export interface MEXTViolation {
  type: "circulation_ratio" | "open_area" | "courtyard_size" | "adjacency_violation"
  description: string
  coord?: GridCoord
  severity: "critical" | "warning"
}

export interface CourtyardRequirement {
  id: string
  size: number         // cells
  hasMinSize: boolean  // ≥ 4x4 cells
  connected: boolean   // no dead-end corridors into it
  bufferingZone: boolean  // no high-stress tiles adjacent
}

export const DEFAULT_WFC_CONFIG: WFCConfig = {
  gridWidth: 40,
  gridHeight: 40,
  seed: Date.now(),
  maxIterations: 5000,
  backtrackLimit: 50,
  mextEnabled: true,
  stressCyclingEnabled: true,
  stressCycleLength: 8,
  mazeMode: false,
  loopClosureBias: 0.25,
  deadEndRatio: 0.20,
  branchWeight: 1.5,
}