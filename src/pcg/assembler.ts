import { Effect, Ref, Random } from "effect"
import type {
  GridCoord,
  GridCell,
  LayoutGrid,
  LayoutSeed,
  WFCConfig,
  GenerationResult,
  MEXTComplianceReport,
  MEXTViolation,
  CourtyardRequirement,
  MEXTStats,
  Tile,
  TileType,
} from "./types.js"
import { DEFAULT_WFC_CONFIG } from "./types.js"
import {
  TILE_DEFINITIONS,
  MEXT_REGULATIONS,
  getCompatibleTiles,
  getTileById,
  getAllTileIds,
} from "./mext-data.js"

function cellKey(coord: GridCoord): string {
  return `${coord.x},${coord.y}`
}

function parseCoord(key: string): GridCoord {
  const [x, y] = key.split(",").map(Number)
  return { x, y }
}

function createEmptyCell(coord: GridCoord, allTileIds: string[]): GridCell {
  return {
    coord,
    possibleTiles: new Set(allTileIds),
    collapsed: false,
    tile: null,
    stressLevel: "medium",
    mextZone: null,
  }
}

function createEmptyGrid(width: number, height: number, allTileIds: string[]): LayoutGrid {
  const cells = new Map<string, GridCell>()
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const coord = { x, y }
      cells.set(cellKey(coord), createEmptyCell(coord, allTileIds))
    }
  }

  return {
    width,
    height,
    cells,
    mextStats: computeMEXTStats(cells),
  }
}

function getNeighbors(coord: GridCoord, grid: LayoutGrid): GridCell[] {
  const neighbors: GridCell[] = []
  const dirs = [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
  ]

  for (const dir of dirs) {
    const nx = coord.x + dir.x
    const ny = coord.y + dir.y
    const key = cellKey({ x: nx, y: ny })
    const cell = grid.cells.get(key)
    if (cell) neighbors.push(cell)
  }

  return neighbors
}

function getNeighborDirection(from: GridCoord, to: GridCoord): number {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (dx === 1) return 1
  if (dy === 1) return 2
  if (dx === -1) return 3
  return 0
}

function areTilesCompatible(tileA: TileType, tileB: TileType, direction: number): boolean {
  if (tileA.connectivity.forbiddenAdjacency.includes(tileB.category)) return false
  if (tileB.connectivity.forbiddenAdjacency.includes(tileA.category)) return false
  return true
}

function propagateConstraints(cell: GridCell, grid: LayoutGrid, allTileIds: string[]): boolean {
  const neighbors = getNeighbors(cell.coord, grid)

  for (const neighbor of neighbors) {
    if (neighbor.collapsed) continue

    const direction = getNeighborDirection(cell.coord, neighbor.coord)
    const collapsedTile = cell.tile
    if (!collapsedTile) continue

    const collapsedType = getTileById(collapsedTile.typeId)
    if (!collapsedType) continue

    const beforeSize = neighbor.possibleTiles.size

    for (const tileId of neighbor.possibleTiles) {
      const neighborType = getTileById(tileId)
      if (!neighborType) continue

      if (!areTilesCompatible(collapsedType, neighborType, direction)) {
        neighbor.possibleTiles.delete(tileId)
      }
    }

    if (neighbor.possibleTiles.size === 0) {
      return false
    }

    if (neighbor.possibleTiles.size === 1 && !neighbor.collapsed) {
      const tileId = [...neighbor.possibleTiles][0]
      neighbor.collapsed = true
      neighbor.tile = { typeId: tileId, rotation: 0, flipX: false }
      neighbor.mextZone = getTileById(tileId)?.mextCompliance ?? null
      neighbor.stressLevel = getTileById(tileId)?.stressLevel ?? "medium"

      if (!propagateConstraints(neighbor, grid, allTileIds)) {
        return false
      }
    }
  }

  return true
}

function findLowestEntropyCell(grid: LayoutGrid, random: Random.Random, config: Partial<WFCConfig> = {}): GridCell | null {
  let minEntropy = Infinity
  let candidates: GridCell[] = []

  for (const cell of grid.cells.values()) {
    if (cell.collapsed) continue
    if (cell.possibleTiles.size === 0) return null

    let entropy = cell.possibleTiles.size

    // Maze mode: bias toward branching and dead-end tiles
    if (config.mazeMode) {
      const hasBranchTile = [...cell.possibleTiles].some(id =>
        id.includes("branch") || id.includes("cross") || id.includes("intersection")
      )
      const hasDeadEndTile = [...cell.possibleTiles].some(id =>
        id.includes("dead_end")
      )

      // Reduce entropy for cells that can branch (favor them)
      if (hasBranchTile && config.branchWeight) {
        entropy = Math.max(1, entropy / config.branchWeight)
      }

      // Slightly favor dead-ends to hit target ratio
      if (hasDeadEndTile) {
        entropy = Math.max(1, entropy * 0.85)
      }
    }

    if (entropy < minEntropy) {
      minEntropy = entropy
      candidates = [cell]
    } else if (entropy === minEntropy) {
      candidates.push(cell)
    }
  }

  if (candidates.length === 0) return null

  const index = Math.floor(Math.random() * candidates.length)
  return candidates[index]
}

function collapseCell(cell: GridCell, random: Random.Random, config: Partial<WFCConfig> = {}): boolean {
  if (cell.collapsed || cell.possibleTiles.size === 0) return false

  let tileIds = [...cell.possibleTiles]

  // Maze mode: bias tile selection toward tactical layout
  if (config.mazeMode) {
    const branchTiles = tileIds.filter(id =>
      id.includes("branch") || id.includes("cross") || id.includes("intersection")
    )
    const deadEndTiles = tileIds.filter(id => id.includes("dead_end"))
    const loopTiles = tileIds.filter(id => id.includes("loop_connector"))
    const straightTiles = tileIds.filter(id => id.includes("straight"))

    // Weighted selection based on maze parameters
    const weights = new Map<string, number>()

    for (const id of tileIds) {
      let weight = 1.0

      if (branchTiles.includes(id)) weight *= (config.branchWeight ?? 1.5)
      if (deadEndTiles.includes(id)) weight *= 1.3
      if (loopTiles.includes(id)) weight *= (config.loopClosureBias ?? 0.25) * 2
      if (straightTiles.includes(id)) weight *= 0.7 // Deprioritize long straights

      weights.set(id, weight)
    }

    // Weighted random selection
    const totalWeight = [...weights.values()].reduce((sum, w) => sum + w, 0)
    let roll = Math.random() * totalWeight

    for (const [id, weight] of weights) {
      roll -= weight
      if (roll <= 0) {
        tileIds = [id]
        break
      }
    }
  }

  const chosenIndex = Math.floor(Math.random() * tileIds.length)
  const chosenId = tileIds[chosenIndex]

  cell.collapsed = true
  cell.tile = { typeId: chosenId, rotation: 0, flipX: false }
  cell.mextZone = getTileById(chosenId)?.mextCompliance ?? null
  cell.stressLevel = getTileById(chosenId)?.stressLevel ?? "medium"

  return true
}

function generateLayoutSeed(width: number, height: number, random: Random.Random): LayoutSeed {
  const entranceX = Math.floor(width / 2)
  const entranceY = height - 1

  const courtyardCount = 1 + Math.floor(Math.random() * 2)
  const courtyardSeeds: GridCoord[] = []

  for (let i = 0; i < courtyardCount; i++) {
    courtyardSeeds.push({
      x: 5 + Math.floor(Math.random() * (width - 10)),
      y: 5 + Math.floor(Math.random() * (height - 15)),
    })
  }

  const classroomBlockCount = 2 + Math.floor(Math.random() * 3)
  const classroomBlockSeeds: GridCoord[] = []

  for (let i = 0; i < classroomBlockCount; i++) {
    classroomBlockSeeds.push({
      x: 2 + Math.floor(Math.random() * (width - 8)),
      y: 2 + Math.floor(Math.random() * (height - 10)),
    })
  }

  return {
    entranceCoord: { x: entranceX, y: entranceY },
    courtyardSeeds,
    classroomBlockSeeds,
  }
}

function applySeedConstraints(grid: LayoutGrid, seed: LayoutSeed, allTileIds: string[]): void {
  const entranceCell = grid.cells.get(cellKey(seed.entranceCoord))
  if (entranceCell) {
    entranceCell.possibleTiles = new Set(["entrance_main"])
    entranceCell.collapsed = true
    entranceCell.tile = { typeId: "entrance_main", rotation: 0, flipX: false }
    entranceCell.mextZone = "entrance"
    entranceCell.stressLevel = "high"
  }

  for (const courtyard of seed.courtyardSeeds) {
    for (let dy = 0; dy < 4; dy++) {
      for (let dx = 0; dx < 4; dx++) {
        const coord = { x: courtyard.x + dx, y: courtyard.y + dy }
        const key = cellKey(coord)
        const cell = grid.cells.get(key)
        if (cell) {
          cell.possibleTiles = new Set(["courtyard_medium"])
          cell.collapsed = true
          cell.tile = { typeId: "courtyard_medium", rotation: 0, flipX: false }
          cell.mextZone = "open"
          cell.stressLevel = "low"
        }
      }
    }
  }

  for (const block of seed.classroomBlockSeeds) {
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        const coord = { x: block.x + dx, y: block.y + dy }
        const key = cellKey(coord)
        const cell = grid.cells.get(key)
        if (cell && !cell.collapsed) {
          cell.possibleTiles = new Set(["classroom_standard"])
          cell.collapsed = true
          cell.tile = { typeId: "classroom_standard", rotation: 0, flipX: false }
          cell.mextZone = "instructional"
          cell.stressLevel = "medium"
        }
      }
    }
  }

  const shoeCoord = { x: seed.entranceCoord.x, y: seed.entranceCoord.y - 1 }
  const shoeCell = grid.cells.get(cellKey(shoeCoord))
  if (shoeCell && !shoeCell.collapsed) {
    shoeCell.possibleTiles = new Set(["entrance_shoe"])
    shoeCell.collapsed = true
    shoeCell.tile = { typeId: "entrance_shoe", rotation: 0, flipX: false }
    shoeCell.mextZone = "entrance"
    shoeCell.stressLevel = "medium"
  }
}

function computeMEXTStats(cells: Map<string, GridCell>): MEXTStats {
  let totalCells = 0
  let instructionalCells = 0
  let circulationCells = 0
  let serviceCells = 0
  let openCells = 0
  let entranceCells = 0
  let stressZones = { high: 0, medium: 0, low: 0 }
  let courtyardCount = 0
  let courtyardSizes: number[] = []

  const courtyardClusters = new Map<string, number>()

  for (const cell of cells.values()) {
    totalCells++

    switch (cell.mextZone) {
      case "instructional": instructionalCells++; break
      case "circulation": circulationCells++; break
      case "service": serviceCells++; break
      case "open": openCells++; break
      case "entrance": entranceCells++; break
    }

    switch (cell.stressLevel) {
      case "high": stressZones.high++; break
      case "medium": stressZones.medium++; break
      case "low": stressZones.low++; break
    }

    if (cell.tile?.typeId.startsWith("courtyard")) {
      courtyardCount++
    }
  }

  return {
    totalCells,
    instructionalCells,
    circulationCells,
    serviceCells,
    openCells,
    entranceCells,
    stressZones,
    courtyardCount,
    courtyardSizes,
    circulationRatio: totalCells > 0 ? circulationCells / totalCells : 0,
    openAreaRatio: totalCells > 0 ? openCells / totalCells : 0,
  }
}

function generateMEXTReport(grid: LayoutGrid): MEXTComplianceReport {
  const stats = grid.mextStats
  const violations: MEXTViolation[] = []

  if (stats.circulationRatio < MEXT_REGULATIONS.circulationRatio) {
    violations.push({
      type: "circulation_ratio",
      description: `Circulation ratio ${stats.circulationRatio.toFixed(2)} < ${MEXT_REGULATIONS.circulationRatio}`,
      severity: "critical",
    })
  }

  if (stats.openAreaRatio < MEXT_REGULATIONS.openAreaRatio) {
    violations.push({
      type: "open_area",
      description: `Open area ratio ${stats.openAreaRatio.toFixed(2)} < ${MEXT_REGULATIONS.openAreaRatio}`,
      severity: "critical",
    })
  }

  const courtyardRequirements: CourtyardRequirement[] = []
  if (stats.courtyardCount > 0) {
    courtyardRequirements.push({
      id: "main-courtyard",
      size: stats.courtyardCount,
      hasMinSize: stats.courtyardCount >= MEXT_REGULATIONS.minCourtyardSize,
      connected: true,
      bufferingZone: stats.stressZones.high === 0,
    })

    if (stats.courtyardCount < MEXT_REGULATIONS.minCourtyardSize) {
      violations.push({
        type: "courtyard_size",
        description: `Courtyard size ${stats.courtyardCount} < minimum ${MEXT_REGULATIONS.minCourtyardSize}`,
        severity: "warning",
      })
    }
  }

  return {
    compliant: violations.filter((v) => v.severity === "critical").length === 0,
    violations,
    circulationRatio: stats.circulationRatio,
    openAreaRatio: stats.openAreaRatio,
    courtyardRequirements,
  }
}

function applyLoopClosures(grid: LayoutGrid, random: Random.Random, bias: number): void {
  // Find dead-end corridors and attempt to connect them to nearby paths
  const deadEnds: GridCell[] = []
  const hallways: GridCell[] = []

  for (const cell of grid.cells.values()) {
    if (!cell.collapsed || !cell.tile) continue

    const tileType = getTileById(cell.tile.typeId)
    if (!tileType) continue

    if (cell.tile.typeId.includes("dead_end")) {
      deadEnds.push(cell)
    }

    if (tileType.category === "hallway" || tileType.category === "corridor") {
      hallways.push(cell)
    }
  }

  // Attempt to convert some dead-ends into loop connectors
  for (const deadEnd of deadEnds) {
    if (Math.random() > bias) continue // Only convert based on bias

    // Find nearby hallway cells that could form a loop
    const nearbyHallways = hallways.filter(h => {
      const dist = Math.abs(h.coord.x - deadEnd.coord.x) + Math.abs(h.coord.y - deadEnd.coord.y)
      return dist >= 3 && dist <= 8 // Not too close, not too far
    })

    if (nearbyHallways.length === 0) continue

    // Pick a random nearby hallway and attempt connection
    const target = nearbyHallways[Math.floor(Math.random() * nearbyHallways.length)]

    // Create a path between dead-end and target using BFS
    const path = findPathBFS(deadEnd.coord, target.coord, grid)
    if (path.length > 0) {
      // Convert path cells to loop connectors
      for (const pathCell of path) {
        const cell = grid.cells.get(cellKey(pathCell))
        if (cell && !cell.collapsed) {
          const loopTiles = [...cell.possibleTiles].filter(id =>
            id.includes("loop_connector") || id.includes("short")
          )
          if (loopTiles.length > 0) {
            const chosenId = loopTiles[Math.floor(Math.random() * loopTiles.length)]
            cell.collapsed = true
            cell.tile = { typeId: chosenId, rotation: 0, flipX: false }
            cell.mextZone = getTileById(chosenId)?.mextCompliance ?? null
            cell.stressLevel = getTileById(chosenId)?.stressLevel ?? "medium"
          }
        }
      }
    }
  }
}

function findPathBFS(start: GridCoord, end: GridCoord, grid: LayoutGrid): GridCoord[] {
  const queue: { coord: GridCoord; path: GridCoord[] }[] = [{ coord: start, path: [] }]
  const visited = new Set<string>()
  visited.add(cellKey(start))

  while (queue.length > 0) {
    const { coord, path } = queue.shift()!

    if (coord.x === end.x && coord.y === end.y) {
      return path
    }

    const dirs = [
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
    ]

    for (const dir of dirs) {
      const nx = coord.x + dir.x
      const ny = coord.y + dir.y
      const key = cellKey({ x: nx, y: ny })

      if (visited.has(key)) continue

      const cell = grid.cells.get(key)
      if (!cell) continue

      // Only traverse uncollapsed cells (can be converted)
      if (!cell.collapsed) {
        visited.add(key)
        queue.push({ coord: { x: nx, y: ny }, path: [...path, { x: nx, y: ny }] })
      }
    }
  }

  return []
}

export function runWFC(config: Partial<WFCConfig> = {}): GenerationResult {
  const cfg = { ...DEFAULT_WFC_CONFIG, ...config }
  const allTileIds = getAllTileIds()
  const random = Random.make(cfg.seed)

  const grid = createEmptyGrid(cfg.gridWidth, cfg.gridHeight, allTileIds)
  const seed = generateLayoutSeed(cfg.gridWidth, cfg.gridHeight, random)

  applySeedConstraints(grid, seed, allTileIds)

  let iterations = 0
  let backtracks = 0
  const errors: string[] = []

  while (iterations < cfg.maxIterations) {
    const cell = findLowestEntropyCell(grid, random, cfg)
    if (!cell) break

    if (!collapseCell(cell, random, cfg)) {
      backtracks++
      errors.push(`Contradiction at (${cell.coord.x}, ${cell.coord.y})`)

      if (backtracks > cfg.backtrackLimit) {
        return {
          success: false,
          grid: null,
          iterations,
          backtracks,
          errors,
          mextReport: null,
        }
      }
      continue
    }

    if (!propagateConstraints(cell, grid, allTileIds)) {
      backtracks++
      errors.push(`Propagation failed at (${cell.coord.x}, ${cell.coord.y})`)

      if (backtracks > cfg.backtrackLimit) {
        return {
          success: false,
          grid: null,
          iterations,
          backtracks,
          errors,
          mextReport: null,
        }
      }
      continue
    }

    iterations++
  }

  // Maze mode: post-process to force loop closures
  if (cfg.mazeMode && cfg.loopClosureBias) {
    applyLoopClosures(grid, random, cfg.loopClosureBias)
  }

  const mextReport = cfg.mextEnabled ? generateMEXTReport(grid) : null

  return {
    success: true,
    grid,
    iterations,
    backtracks,
    errors,
    mextReport,
  }
}

export interface ChunkGenerator {
  readonly generateChunk: (
    chunkX: number,
    chunkZ: number,
    chunkSize: number,
    mazeMode?: boolean
  ) => Effect.Effect<{
    tiles: Map<string, Tile>
    bounds: { minX: number; minZ: number; maxX: number; maxZ: number }
    seed: number
    mazeStats?: {
      branchCount: number
      deadEndCount: number
      loopCount: number
    }
  }>
  readonly getChunkSeed: (chunkX: number, chunkZ: number) => number
  readonly setGlobalSeed: (seed: number) => void
  readonly getGlobalSeed: () => number
}

export function makeChunkGenerator(globalSeed: number = 42): ChunkGenerator {
  let seed = globalSeed

  function hashCoords(x: number, z: number): number {
    let h = seed
    h = Math.imul(h ^ x, 0x5bd1e995)
    h = Math.imul(h ^ z, 0x5bd1e995)
    h = h ^ (h >>> 13)
    h = Math.imul(h, 0x5bd1e995)
    h = h ^ (h >>> 15)
    return Math.abs(h)
  }

  return {
    generateChunk: (chunkX, chunkZ, chunkSize, mazeMode = false) =>
      Effect.gen(function* () {
        const chunkSeed = hashCoords(chunkX, chunkZ) ^ seed
        const random = Random.make(chunkSeed)

        const allTileIds = getAllTileIds()

        // Use WFC for proper constraint-based generation
        const wfcConfig: Partial<WFCConfig> = {
          gridWidth: chunkSize,
          gridHeight: chunkSize,
          seed: chunkSeed,
          mazeMode,
          maxIterations: 1000,
        }

        const result = runWFC(wfcConfig)

        // Convert WFC grid to tile map with world coordinates
        const tiles = new Map<string, Tile>()
        let branchCount = 0
        let deadEndCount = 0
        let loopCount = 0

        for (const [key, cell] of (result.grid ?? { cells: new Map() }).cells) {
          if (cell.collapsed && cell.tile) {
            const worldX = chunkX * chunkSize + cell.coord.x
            const worldZ = chunkZ * chunkSize + cell.coord.y
            const worldKey = `${worldX},${worldZ}`

            tiles.set(worldKey, {
              typeId: cell.tile.typeId,
              rotation: cell.tile.rotation,
              flipX: cell.tile.flipX,
            })

            const typeId = cell.tile.typeId
            if (typeId.includes("branch")) branchCount++
            else if (typeId.includes("dead_end")) deadEndCount++
            else if (typeId.includes("loop_connector")) loopCount++
          } else {
            // Fill uncollapsed cells with a default hallway tile
            const worldX = chunkX * chunkSize + cell.coord.x
            const worldZ = chunkZ * chunkSize + cell.coord.y
            const worldKey = `${worldX},${worldZ}`
            const fallbackId = mazeMode ? "hallway_straight" : "hallway_straight"

            tiles.set(worldKey, {
              typeId: fallbackId,
              rotation: 0,
              flipX: false,
            })
          }
        }

        return {
          tiles,
          bounds: {
            minX: chunkX * chunkSize,
            minZ: chunkZ * chunkSize,
            maxX: (chunkX + 1) * chunkSize - 1,
            maxZ: (chunkZ + 1) * chunkSize - 1,
          },
          seed: chunkSeed,
          mazeStats: mazeMode ? { branchCount, deadEndCount, loopCount } : undefined,
        }
      }),

    getChunkSeed: (chunkX, chunkZ) => hashCoords(chunkX, chunkZ),

    setGlobalSeed: (newSeed) => { seed = newSeed },

    getGlobalSeed: () => seed,
  }
}

export interface PCGAssembler {
  readonly generateLayout: (config: Partial<WFCConfig>) => Effect.Effect<GenerationResult>
  readonly getChunkGenerator: () => ChunkGenerator
  readonly generateInfiniteChunk: (
    chunkX: number,
    chunkZ: number,
    chunkSize: number,
    mazeMode?: boolean
  ) => Effect.Effect<{
    tiles: Map<string, Tile>
    bounds: { minX: number; minZ: number; maxX: number; maxZ: number }
    seed: number
    mazeStats?: {
      branchCount: number
      deadEndCount: number
      loopCount: number
    }
  }>
}

export function makePCGAssembler(globalSeed: number = 42): PCGAssembler {
  const chunkGenerator = makeChunkGenerator(globalSeed)

  return {
    generateLayout: (config) => Effect.succeed(runWFC(config)),

    getChunkGenerator: () => chunkGenerator,

    generateInfiniteChunk: (chunkX, chunkZ, chunkSize, mazeMode = false) =>
      chunkGenerator.generateChunk(chunkX, chunkZ, chunkSize, mazeMode),
  }
}
