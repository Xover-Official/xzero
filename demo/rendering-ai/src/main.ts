import { Effect, Ref, Schedule, Stream, PubSub } from "effect"
import { runWFC, makePCGAssembler } from "../../src/pcg/assembler.js"
import type { Tile } from "../../src/pcg/types.js"
import { makeEmotionalDisplayEngine, type EmotionalVisualState } from "../../src/game/emotional-display.js"
import { makeDiscoveryLoopSystem, type NPCInteraction } from "../../src/game/discovery-loop.js"
import { makeRareTileEngine, type RareTileInstance, RARE_TILE_DEFINITIONS } from "../../src/game/rare-tiles.js"
import { makeStressRhythmSystem, type PlayerStressState } from "../../src/game/stress-rhythm.js"
import { makeNPCMemorySystem } from "../../src/game/npc-memory.js"
import { makeSchoolIDSystem } from "../../src/game/school-id.js"
import type { StudentProfile, PsychologicalState, StudentMood } from "../../src/pcg/psychological-node.js"

// ─── Config ───────────────────────────────────────────────────────────────
const TILE_SIZE = 32
const CHUNK_SIZE = 8
const WORLD_SEED = 42
const NPC_COUNT = 12
const VIEW_CHUNKS = 3

// ─── Canvas Setup ─────────────────────────────────────────────────────────
const canvas = document.getElementById("game") as HTMLCanvasElement
const ctx = canvas.getContext("2d")!
const minimapCanvas = document.getElementById("minimap") as HTMLCanvasElement
const minimapCtx = minimapCanvas.getContext("2d")!

function resize() {
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
}
resize()
window.addEventListener("resize", resize)

// ─── Tile Colors ──────────────────────────────────────────────────────────
const TILE_COLORS: Record<string, string> = {
  hallway_straight: "#4a4a52",
  hallway_corner: "#424248",
  hallway_branch: "#5a3a3a",
  hallway_dead_end: "#3a3040",
  hallway_cross: "#505058",
  hallway_loop_connector: "#3a5040",
  classroom: "#6a6040",
  courtyard: "#3a6040",
  entrance: "#605040",
  stairwell: "#4a4050",
  toilet: "#505a60",
  roof: "#404a5a",
  rare_locked_music_room: "#aa8833",
  rare_hidden_courtyard: "#33aa55",
  rare_teacher_free_zone: "#5588aa",
  rare_secret_passage: "#8833aa",
  rare_rooftop_garden: "#33aa88",
  rare_abandoned_clubroom: "#aa5533",
}

const DEFAULT_TILE_COLOR = "#3a3a42"
const WALL_COLOR = "#1a1a22"
const GRID_COLOR = "rgba(255,255,255,0.04)"

// ─── Mood Colors for NPC Auras ────────────────────────────────────────────
const MOOD_COLORS: Record<StudentMood, string> = {
  burnout: "#ff3333",
  anxious: "#ffaa00",
  drowsy: "#6666cc",
  social: "#33cc55",
  avoidant: "#aa44aa",
  focused: "#4488ff",
  relaxed: "#44dd88",
}

const MOOD_GLOW_INTENSITY: Record<StudentMood, number> = {
  burnout: 0.8,
  anxious: 0.6,
  drowsy: 0.3,
  social: 0.4,
  avoidant: 0.5,
  focused: 0.2,
  relaxed: 0.25,
}

// ─── Game State ───────────────────────────────────────────────────────────
interface GameState {
  playerX: number
  playerZ: number
  cameraX: number
  cameraZ: number
  zoom: number
  chunks: Map<string, Map<string, Tile>>
  npcs: StudentProfile[]
  npcStates: Map<string, PsychologicalState>
  npcPositions: Map<string, { x: number; z: number }>
  visibleNPCs: EmotionalVisualState[]
  interactableNPC: string | null
  playerStress: PlayerStressState
  schoolName: string
  schoolSeed: number
  shareCode: string
  chunksExplored: number
  npcsHelped: number
  rareDiscoveries: number
  rareTiles: RareTileInstance[]
  discoveredRareTiles: Set<string>
  transformingChunks: Set<string>
  transformAnimations: Map<string, { progress: number; reason: string }>
  keys: Set<string>
  fps: number
  frameCount: number
  lastFpsTime: number
  time: number
  gameHour: number
}

const state: GameState = {
  playerX: CHUNK_SIZE * TILE_SIZE / 2,
  playerZ: CHUNK_SIZE * TILE_SIZE / 2,
  cameraX: 0,
  cameraZ: 0,
  zoom: 1,
  chunks: new Map(),
  npcs: [],
  npcStates: new Map(),
  npcPositions: new Map(),
  visibleNPCs: [],
  interactableNPC: null,
  playerStress: {
    currentStress: 0, maxStress: 100, stressRate: 0.02, reliefRate: 0.05,
    lastZoneChange: 0, consecutiveStressZones: 0, consecutiveReliefZones: 0, isOverwhelmed: false,
  },
  schoolName: "Loading...",
  schoolSeed: WORLD_SEED,
  shareCode: "",
  chunksExplored: 0,
  npcsHelped: 0,
  rareDiscoveries: 0,
  rareTiles: [],
  discoveredRareTiles: new Set(),
  transformingChunks: new Set(),
  transformAnimations: new Map(),
  keys: new Set(),
  fps: 0,
  frameCount: 0,
  lastFpsTime: 0,
  time: 0,
  gameHour: 8,
}

// ─── Input ────────────────────────────────────────────────────────────────
window.addEventListener("keydown", (e) => {
  state.keys.add(e.code)
  if (e.code === "KeyE") handleInteract()
  if (e.code === "Tab") { e.preventDefault(); showShareCode() }
})
window.addEventListener("keyup", (e) => state.keys.delete(e.code))
canvas.addEventListener("wheel", (e) => {
  e.preventDefault()
  state.zoom = Math.max(0.3, Math.min(3, state.zoom - e.deltaY * 0.001))
})

// ─── World Generation ─────────────────────────────────────────────────────
function chunkId(x: number, z: number): string { return `${x}_${z}` }

function generateChunk(chunkX: number, chunkZ: number): Map<string, Tile> {
  const chunkSeed = Math.abs(chunkX * 73856093 ^ chunkZ * 19349663 ^ WORLD_SEED)
  const result = runWFC({
    gridWidth: CHUNK_SIZE,
    gridHeight: CHUNK_SIZE,
    seed: chunkSeed,
    mazeMode: true,
    maxIterations: 500,
  })

  const tiles = new Map<string, Tile>()
  for (const [key, cell] of result.grid.cells) {
    if (cell.collapsed && cell.tile) {
      const worldX = chunkX * CHUNK_SIZE + cell.coord.x
      const worldZ = chunkZ * CHUNK_SIZE + cell.coord.y
      tiles.set(`${worldX},${worldZ}`, {
        typeId: cell.tile.typeId,
        rotation: cell.tile.rotation,
        flipX: cell.tile.flipX,
      })
    } else {
      const worldX = chunkX * CHUNK_SIZE + cell.coord.x
      const worldZ = chunkZ * CHUNK_SIZE + cell.coord.y
      tiles.set(`${worldX},${worldZ}`, { typeId: "hallway_straight", rotation: 0, flipX: false })
    }
  }

  // Check for rare tiles
  for (const def of RARE_TILE_DEFINITIONS) {
    const rarity = ((chunkSeed * 2654435761) >>> 0) % 10000 / 10000
    if (rarity < def.rarity) {
      const rx = chunkX * CHUNK_SIZE + Math.floor((chunkSeed % CHUNK_SIZE))
      const rz = chunkZ * CHUNK_SIZE + Math.floor(((chunkSeed >> 8) % CHUNK_SIZE))
      const rareKey = `${rx},${rz}`
      if (!tiles.has(rareKey) || Math.random() < 0.5) {
        tiles.set(rareKey, { typeId: def.id, rotation: 0, flipX: false })
        state.rareTiles.push({
          ...def, worldX: rx, worldZ: rz, chunkX, chunkZ, discovered: false, seed: chunkSeed,
        })
      }
    }
  }

  return tiles
}

function ensureChunkLoaded(chunkX: number, chunkZ: number) {
  const id = chunkId(chunkX, chunkZ)
  if (!state.chunks.has(id)) {
    state.chunks.set(id, generateChunk(chunkX, chunkZ))
    state.chunksExplored++
  }
}

function loadNearbyChunks() {
  const pcx = Math.floor(state.playerX / (CHUNK_SIZE * TILE_SIZE))
  const pcz = Math.floor(state.playerZ / (CHUNK_SIZE * TILE_SIZE))
  for (let dx = -VIEW_CHUNKS; dx <= VIEW_CHUNKS; dx++) {
    for (let dz = -VIEW_CHUNKS; dz <= VIEW_CHUNKS; dz++) {
      ensureChunkLoaded(pcx + dx, pcz + dz)
    }
  }
}

// ─── NPC Spawning ─────────────────────────────────────────────────────────
const NPC_NAMES = ["Yuki", "Haruto", "Sakura", "Ren", "Hina", "Sota", "Aoi", "Riku", "Mio", "Kaito", "Yui", "Taro"]
const MOODS: StudentMood[] = ["burnout", "anxious", "drowsy", "social", "avoidant", "focused", "relaxed"]
const LOCATIONS = ["classroom", "stairwell", "courtyard", "hallway", "toilet", "roof", "corridor"]

function spawnNPCs() {
  const npcs: StudentProfile[] = []
  const states = new Map<string, PsychologicalState>()
  const positions = new Map<string, { x: number; z: number }>()

  for (let i = 0; i < NPC_COUNT; i++) {
    const mood = MOODS[i % MOODS.length]
    const location = LOCATIONS[i % LOCATIONS.length]
    const stressLevel = mood === "burnout" ? 0.9 : mood === "anxious" ? 0.7 : mood === "relaxed" ? 0.2 : 0.5
    const energyLevel = mood === "drowsy" ? 0.2 : mood === "burnout" ? 0.15 : 0.7

    // Place NPCs in the world
    const chunkX = Math.floor(WORLD_SEED * (i + 1) * 7 % 5) - 2
    const chunkZ = Math.floor(WORLD_SEED * (i + 1) * 13 % 5) - 2
    const tileX = (chunkX * CHUNK_SIZE + (i * 3 % CHUNK_SIZE)) * TILE_SIZE + TILE_SIZE / 2
    const tileZ = (chunkZ * CHUNK_SIZE + (i * 5 % CHUNK_SIZE)) * TILE_SIZE + TILE_SIZE / 2

    const npc: StudentProfile = {
      id: `npc_${i}`,
      name: NPC_NAMES[i % NPC_NAMES.length],
      stressThreshold: stressLevel,
      sleepDebt: 1 - energyLevel,
      socialNeed: mood === "social" ? 0.8 : 0.3,
      currentLocation: location,
      currentLocationPos: { x: tileX / TILE_SIZE, y: 0, z: tileZ / TILE_SIZE },
      lastMoodChange: Date.now(),
      behavioralHistory: [],
    }

    npcs.push(npc)
    states.set(npc.id, {
      mood, stressLevel, energyLevel,
      focusLevel: mood === "focused" ? 0.9 : 0.5,
      socialDesire: mood === "social" ? 0.8 : 0.3,
      escapeUrge: mood === "avoidant" ? 0.7 : 0.2,
      motivation: mood === "burnout" ? 0.1 : 0.5,
    })
    positions.set(npc.id, { x: tileX, z: tileZ })
  }

  state.npcs = npcs
  state.npcStates = states
  state.npcPositions = positions
}

// ─── Interaction ──────────────────────────────────────────────────────────
function handleInteract() {
  if (!state.interactableNPC) return

  const npc = state.npcs.find(n => n.id === state.interactableNPC)
  const npcState = state.npcStates.get(state.interactableNPC!)
  if (!npc || !npcState) return

  const prevState = npcState.mood
  let newMood: StudentMood
  switch (prevState) {
    case "burnout": newMood = "relaxed"; break
    case "anxious": newMood = "focused"; break
    case "avoidant": newMood = "social"; break
    default: return
  }

  npcState.mood = newMood
  npcState.stressLevel = Math.max(0, npcState.stressLevel - 0.4)
  npcState.energyLevel = Math.min(1, npcState.energyLevel + 0.3)

  state.npcsHelped++
  addLog(`${npc.name}: ${prevState} → ${newMood}`, "transform")

  // Trigger chunk transformation
  const pos = state.npcPositions.get(npc.id)!
  const cx = Math.floor(pos.x / (CHUNK_SIZE * TILE_SIZE))
  const cz = Math.floor(pos.z / (CHUNK_SIZE * TILE_SIZE))
  const cid = chunkId(cx, cz)

  state.transformingChunks.add(cid)
  state.transformAnimations.set(cid, { progress: 0, reason: `Helped ${npc.name} — the ${npc.currentLocation} transforms` })

  // Regenerate chunk with new seed
  setTimeout(() => {
    state.chunks.delete(cid)
    ensureChunkLoaded(cx, cz)
    addLog(`Chunk transformed: ${cid}`, "transform")
    setTimeout(() => {
      state.transformingChunks.delete(cid)
      state.transformAnimations.delete(cid)
    }, 500)
  }, 800)

  state.interactableNPC = null
  updateHelpPrompt()
}

function updateInteractableNPC() {
  const playerTileX = state.playerX / TILE_SIZE
  const playerTileZ = state.playerZ / TILE_SIZE
  let closest: string | null = null
  let closestDist = 3.0 // tiles

  for (const npc of state.npcs) {
    const pos = state.npcPositions.get(npc.id)!
    const state_ = state.npcStates.get(npc.id)
    if (!state_) continue

    const dx = pos.x / TILE_SIZE - playerTileX
    const dz = pos.z / TILE_SIZE - playerTileZ
    const dist = Math.sqrt(dx * dx + dz * dz)

    if (dist < closestDist && (state_.mood === "burnout" || state_.mood === "anxious" || state_.mood === "avoidant")) {
      closestDist = dist
      closest = npc.id
    }
  }

  state.interactableNPC = closest
  updateHelpPrompt()
}

function updateHelpPrompt() {
  const el = document.getElementById("help-prompt")!
  if (!state.interactableNPC) {
    el.style.display = "none"
    return
  }

  const npc = state.npcs.find(n => n.id === state.interactableNPC)!
  const npcState = state.npcStates.get(npc.id)!
  const messages: Record<StudentMood, string> = {
    burnout: `[E] Help ${npc.name} — they're in burnout`,
    anxious: `[E] Calm ${npc.name} — they're anxious`,
    avoidant: `[E] Approach ${npc.name} — they're hiding`,
    drowsy: "",
    social: "",
    focused: "",
    relaxed: "",
  }
  const msg = messages[npcState.mood]
  if (msg) {
    el.style.display = "block"
    el.textContent = msg
  } else {
    el.style.display = "none"
  }
}

// ─── Event Log ────────────────────────────────────────────────────────────
function addLog(text: string, type: "" | "rare" | "transform" | "stress" = "") {
  const el = document.getElementById("event-log")!
  const entry = document.createElement("div")
  entry.className = `log-entry ${type}`
  entry.textContent = text
  el.appendChild(entry)
  el.scrollTop = el.scrollHeight

  // Remove old entries
  while (el.children.length > 20) el.removeChild(el.firstChild!)
}

function showShareCode() {
  addLog(`Share code: xzero://seed-${WORLD_SEED}-helped-${state.npcsHelped}-rare-${state.rareDiscoveries}`, "rare")
}

// ─── Rendering ────────────────────────────────────────────────────────────
function worldToScreen(wx: number, wz: number): [number, number] {
  const sx = (wx - state.cameraX) * state.zoom + canvas.width / 2
  const sy = (wz - state.cameraZ) * state.zoom + canvas.height / 2
  return [sx, sy]
}

function screenToWorld(sx: number, sy: number): [number, number] {
  const wx = (sx - canvas.width / 2) / state.zoom + state.cameraX
  const wz = (sy - canvas.height / 2) / state.zoom + state.cameraZ
  return [wx, wz]
}

function drawTile(wx: number, wz: number, typeId: string, alpha: number = 1) {
  const color = TILE_COLORS[typeId] ?? DEFAULT_TILE_COLOR
  const [sx, sy] = worldToScreen(wx * TILE_SIZE, wz * TILE_SIZE)
  const size = TILE_SIZE * state.zoom

  if (sx < -size || sy < -size || sx > canvas.width + size || sy > canvas.height + size) return

  ctx.globalAlpha = alpha
  ctx.fillStyle = color
  ctx.fillRect(sx - size / 2, sy - size / 2, size, size)

  // Grid lines
  ctx.strokeStyle = GRID_COLOR
  ctx.lineWidth = 0.5
  ctx.strokeRect(sx - size / 2, sy - size / 2, size, size)

  // Rare tile indicator
  if (typeId.startsWith("rare_")) {
    ctx.fillStyle = "rgba(255, 200, 50, 0.3)"
    ctx.beginPath()
    ctx.arc(sx, sy, size * 0.3, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = "#ffcc33"
    ctx.font = `${Math.max(8, 10 * state.zoom)}px monospace`
    ctx.textAlign = "center"
    ctx.fillText("★", sx, sy + 3 * state.zoom)
  }

  ctx.globalAlpha = 1
}

function drawChunkBorder(chunkX: number, chunkZ: number) {
  const wx = chunkX * CHUNK_SIZE * TILE_SIZE
  const wz = chunkZ * CHUNK_SIZE * TILE_SIZE
  const [sx, sy] = worldToScreen(wx, wz)
  const size = CHUNK_SIZE * TILE_SIZE * state.zoom

  ctx.strokeStyle = "rgba(0, 255, 136, 0.15)"
  ctx.lineWidth = 1
  ctx.strokeRect(sx, sy, size, size)
}

function drawPlayer() {
  const [sx, sy] = worldToScreen(state.playerX, state.playerZ)

  // Outer glow
  const gradient = ctx.createRadialGradient(sx, sy, 0, sx, sy, 20 * state.zoom)
  gradient.addColorStop(0, "rgba(0, 255, 136, 0.4)")
  gradient.addColorStop(1, "rgba(0, 255, 136, 0)")
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.arc(sx, sy, 20 * state.zoom, 0, Math.PI * 2)
  ctx.fill()

  // Player dot
  ctx.fillStyle = "#00ff88"
  ctx.beginPath()
  ctx.arc(sx, sy, 5 * state.zoom, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(sx, sy, 5 * state.zoom, 0, Math.PI * 2)
  ctx.stroke()
}

function drawNPC(npc: StudentProfile, npcState: PsychologicalState, pos: { x: number; z: number }) {
  const [sx, sy] = worldToScreen(pos.x, pos.z)
  const size = TILE_SIZE * state.zoom

  if (sx < -size * 2 || sy < -size * 2 || sx > canvas.width + size * 2 || sy > canvas.height + size * 2) return

  const moodColor = MOOD_COLORS[npcState.mood]
  const glowIntensity = MOOD_GLOW_INTENSITY[npcState.mood]

  // Emotional aura
  const auraSize = (12 + glowIntensity * 15) * state.zoom
  const gradient = ctx.createRadialGradient(sx, sy, 0, sx, sy, auraSize)
  gradient.addColorStop(0, moodColor + "88")
  gradient.addColorStop(0.5, moodColor + "33")
  gradient.addColorStop(1, moodColor + "00")
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.arc(sx, sy, auraSize, 0, Math.PI * 2)
  ctx.fill()

  // Pulsing effect for distressed NPCs
  if (npcState.mood === "burnout" || npcState.mood === "anxious") {
    const pulse = Math.sin(state.time * 5) * 0.3 + 0.7
    ctx.strokeStyle = moodColor
    ctx.lineWidth = 2 * state.zoom * pulse
    ctx.beginPath()
    ctx.arc(sx, sy, (8 + glowIntensity * 8) * state.zoom, 0, Math.PI * 2)
    ctx.stroke()
  }

  // NPC dot
  ctx.fillStyle = moodColor
  ctx.beginPath()
  ctx.arc(sx, sy, 4 * state.zoom, 0, Math.PI * 2)
  ctx.fill()

  // Name tag
  ctx.fillStyle = "#ffffff"
  ctx.font = `${Math.max(8, 10 * state.zoom)}px monospace`
  ctx.textAlign = "center"
  ctx.fillText(npc.name, sx, sy - 10 * state.zoom)

  // Mood indicator
  ctx.fillStyle = moodColor
  ctx.font = `${Math.max(7, 8 * state.zoom)}px monospace`
  ctx.fillText(npcState.mood, sx, sy + 16 * state.zoom)

  // Interactable highlight
  if (npc.id === state.interactableNPC) {
    ctx.strokeStyle = "#ffffff"
    ctx.lineWidth = 2
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.arc(sx, sy, 18 * state.zoom, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
  }
}

function drawTransformAnimation(chunkX: number, chunkZ: number, anim: { progress: number; reason: string }) {
  const wx = chunkX * CHUNK_SIZE * TILE_SIZE
  const wz = chunkZ * CHUNK_SIZE * TILE_SIZE
  const [sx, sy] = worldToScreen(wx, wz)
  const size = CHUNK_SIZE * TILE_SIZE * state.zoom

  // Flash effect
  const flash = Math.sin(anim.progress * Math.PI * 4) * (1 - anim.progress)
  ctx.fillStyle = `rgba(255, 100, 100, ${flash * 0.3})`
  ctx.fillRect(sx, sy, size, size)

  // Border glow
  ctx.strokeStyle = `rgba(255, 68, 68, ${0.8 * (1 - anim.progress)})`
  ctx.lineWidth = 3
  ctx.strokeRect(sx, sy, size, size)
}

function drawMinimap() {
  const mc = minimapCtx
  const mw = minimapCanvas.width
  const mh = minimapCanvas.height

  mc.fillStyle = "#0a0a12"
  mc.fillRect(0, 0, mw, mh)

  const scale = 3
  const centerX = mw / 2
  const centerZ = mh / 2

  // Draw tiles
  for (const [cid, tiles] of state.chunks) {
    for (const [key, tile] of tiles) {
      const [tx, tz] = key.split(",").map(Number)
      const dx = (tx * TILE_SIZE - state.playerX) * scale / TILE_SIZE + centerX
      const dz = (tz * TILE_SIZE - state.playerZ) * scale / TILE_SIZE + centerZ

      if (dx < 0 || dz < 0 || dx > mw || dz > mh) continue

      const color = TILE_COLORS[tile.typeId] ?? DEFAULT_TILE_COLOR
      mc.fillStyle = color
      mc.fillRect(dx - 1, dz - 1, 2, 2)
    }
  }

  // Draw NPCs
  for (const npc of state.npcs) {
    const pos = state.npcPositions.get(npc.id)!
    const npcState = state.npcStates.get(npc.id)
    if (!npcState) continue

    const dx = (pos.x - state.playerX) * scale / TILE_SIZE + centerX
    const dz = (pos.z - state.playerZ) * scale / TILE_SIZE + centerZ

    if (dx < 0 || dz < 0 || dx > mw || dz > mh) continue

    mc.fillStyle = MOOD_COLORS[npcState.mood]
    mc.beginPath()
    mc.arc(dx, dz, 3, 0, Math.PI * 2)
    mc.fill()
  }

  // Player
  mc.fillStyle = "#00ff88"
  mc.beginPath()
  mc.arc(centerX, centerZ, 4, 0, Math.PI * 2)
  mc.fill()
  mc.strokeStyle = "#ffffff"
  mc.lineWidth = 1
  mc.beginPath()
  mc.arc(centerX, centerZ, 4, 0, Math.PI * 2)
  mc.stroke()

  // Border
  mc.strokeStyle = "#333"
  mc.lineWidth = 1
  mc.strokeRect(0, 0, mw, mh)
}

function updateStressBar() {
  const fill = document.getElementById("stress-fill")!
  const pct = (state.playerStress.currentStress / state.playerStress.maxStress) * 100
  fill.style.width = `${pct}%`

  if (pct > 80) fill.style.background = "linear-gradient(90deg, #ff4444, #ff0000)"
  else if (pct > 50) fill.style.background = "linear-gradient(90deg, #ffaa00, #ff6600)"
  else if (pct > 20) fill.style.background = "linear-gradient(90deg, #44aaff, #4488ff)"
  else fill.style.background = "linear-gradient(90deg, #44dd88, #33aa66)"
}

function updateStats() {
  document.getElementById("school-name")!.textContent = state.schoolName
  document.getElementById("school-seed")!.textContent = `Seed: ${state.schoolSeed}`
  document.getElementById("school-share")!.textContent = state.shareCode
  document.getElementById("stat-chunks")!.textContent = String(state.chunksExplored)
  document.getElementById("stat-helped")!.textContent = String(state.npcsHelped)
  document.getElementById("stat-rare")!.textContent = String(state.rareDiscoveries)
  document.getElementById("stat-npcs")!.textContent = String(state.npcs.length)
  document.getElementById("stat-fps")!.textContent = String(state.fps)
}

// ─── Game Loop ────────────────────────────────────────────────────────────
function update(dt: number) {
  state.time += dt
  state.gameHour += dt * 0.5 // 2 game hours per real minute

  // Player movement
  const speed = 120 * dt * state.zoom
  let moved = false
  if (state.keys.has("KeyW") || state.keys.has("ArrowUp")) { state.playerZ -= speed; moved = true }
  if (state.keys.has("KeyS") || state.keys.has("ArrowDown")) { state.playerZ += speed; moved = true }
  if (state.keys.has("KeyA") || state.keys.has("ArrowLeft")) { state.playerX -= speed; moved = true }
  if (state.keys.has("KeyD") || state.keys.has("ArrowRight")) { state.playerX += speed; moved = true }

  // Camera follow
  state.cameraX += (state.playerX - state.cameraX) * 0.1
  state.cameraZ += (state.playerZ - state.cameraZ) * 0.1

  // Load chunks
  loadNearbyChunks()

  // Update interactable NPC
  updateInteractableNPC()

  // Update transform animations
  for (const [cid, anim] of state.transformAnimations) {
    anim.progress += dt * 2
    if (anim.progress > 1) {
      state.transformAnimations.delete(cid)
    }
  }

  // Stress system
  const playerTileX = Math.floor(state.playerX / TILE_SIZE)
  const playerTileZ = Math.floor(state.playerZ / TILE_SIZE)
  const ck = `${playerTileX},${playerTileZ}`
  let inHighStress = false

  for (const [, tiles] of state.chunks) {
    const tile = tiles.get(ck)
    if (tile) {
      const tid = tile.typeId
      if (tid.includes("exam") || tid.includes("staff") || tid.includes("gate")) inHighStress = true
    }
  }

  if (inHighStress) {
    state.playerStress.currentStress = Math.min(100, state.playerStress.currentStress + dt * 5)
  } else {
    state.playerStress.currentStress = Math.max(0, state.playerStress.currentStress - dt * 3)
  }

  // FPS counter
  state.frameCount++
  const now = performance.now()
  if (now - state.lastFpsTime > 1000) {
    state.fps = state.frameCount
    state.frameCount = 0
    state.lastFpsTime = now
  }
}

function render() {
  ctx.fillStyle = "#0a0a12"
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // Draw tiles
  for (const [cid, tiles] of state.chunks) {
    const [cx, cz] = cid.split("_").map(Number)

    // Transform animation overlay
    const anim = state.transformAnimations.get(cid)
    if (anim) {
      drawTransformAnimation(cx, cz, anim)
    }

    for (const [key, tile] of tiles) {
      const [tx, tz] = key.split(",").map(Number)
      drawTile(tx, tz, tile.typeId)
    }

    drawChunkBorder(cx, cz)
  }

  // Draw NPCs
  for (const npc of state.npcs) {
    const pos = state.npcPositions.get(npc.id)!
    const npcState = state.npcStates.get(npc.id)
    if (npcState) drawNPC(npc, npcState, pos)
  }

  // Draw player
  drawPlayer()

  // Draw minimap
  drawMinimap()

  // Update UI
  updateStressBar()
  updateStats()
}

function gameLoop(timestamp: number) {
  const dt = Math.min(0.05, (timestamp - (gameLoop as any).lastTime || timestamp) / 1000)
  ;(gameLoop as any).lastTime = timestamp

  update(dt)
  render()

  requestAnimationFrame(gameLoop)
}

// ─── Init ─────────────────────────────────────────────────────────────────
function init() {
  // Generate initial chunk
  ensureChunkLoaded(0, 0)
  ensureChunkLoaded(-1, 0)
  ensureChunkLoaded(1, 0)
  ensureChunkLoaded(0, -1)
  ensureChunkLoaded(0, 1)

  // Spawn NPCs
  spawnNPCs()

  // Set school info
  state.schoolName = "Sakura Academy"
  state.schoolSeed = WORLD_SEED
  state.shareCode = `xzero://seed-${WORLD_SEED}`

  // Initial logs
  addLog("Welcome to Sakura Academy — explore the maze", "")
  addLog("Find distressed students and help them", "stress")
  addLog("Press E near a glowing NPC to help", "")

  // Start game loop
  requestAnimationFrame(gameLoop)
}

init()
