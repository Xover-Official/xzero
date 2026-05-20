import { Effect, Ref } from "effect"
import type { StudentProfile, StudentMood } from "../pcg/psychological-node.js"
import type { PsychologicalState } from "../pcg/psychological-node.js"

export interface EmotionalVisualState {
  npcId: string
  mood: StudentMood
  visualCue: VisualCue
  intensity: number
  screenPosition: { x: number; y: number }
  interactionRadius: number
  isInteractable: boolean
  helpText: string
}

export interface VisualCue {
  type: "aura" | "posture" | "particle" | "glow"
  color: [number, number, number]
  alpha: number
  scale: number
  animation: "pulse" | "shake" | "float" | "static"
  animationSpeed: number
}

export interface EmotionalDisplayConfig {
  moodToVisual: Record<StudentMood, VisualCue>
  maxDisplayDistance: number
  showHelpText: boolean
  showInteractionRadius: boolean
}

const DEFAULT_CONFIG: EmotionalDisplayConfig = {
  moodToVisual: {
    burnout: {
      type: "aura",
      color: [0.8, 0.1, 0.1],
      alpha: 0.6,
      scale: 1.5,
      animation: "shake",
      animationSpeed: 3.0,
    },
    anxious: {
      type: "particle",
      color: [1.0, 0.6, 0.0],
      alpha: 0.5,
      scale: 1.2,
      animation: "shake",
      animationSpeed: 5.0,
    },
    drowsy: {
      type: "glow",
      color: [0.4, 0.4, 0.8],
      alpha: 0.3,
      scale: 0.9,
      animation: "pulse",
      animationSpeed: 0.5,
    },
    social: {
      type: "particle",
      color: [0.2, 0.8, 0.3],
      alpha: 0.4,
      scale: 1.1,
      animation: "float",
      animationSpeed: 2.0,
    },
    avoidant: {
      type: "aura",
      color: [0.6, 0.2, 0.6],
      alpha: 0.4,
      scale: 0.8,
      animation: "pulse",
      animationSpeed: 1.5,
    },
    focused: {
      type: "glow",
      color: [0.3, 0.6, 1.0],
      alpha: 0.3,
      scale: 1.0,
      animation: "static",
      animationSpeed: 0,
    },
    relaxed: {
      type: "glow",
      color: [0.3, 0.9, 0.5],
      alpha: 0.25,
      scale: 1.0,
      animation: "pulse",
      animationSpeed: 0.8,
    },
  },
  maxDisplayDistance: 150,
  showHelpText: true,
  showInteractionRadius: true,
}

const MOOD_HELP_TEXT: Record<StudentMood, string> = {
  burnout: "[E] Help exhausted student",
  anxious: "[E] Calm anxious student",
  drowsy: "[E] Wake up drowsy student",
  social: "[E] Chat with student",
  avoidant: "[E] Approach hiding student",
  focused: "[E] Check on focused student",
  relaxed: "[E] Chat with relaxed student",
}

export interface EmotionalDisplayEngine {
  readonly getVisualState: (npc: StudentProfile, state: PsychologicalState, playerPos: { x: number; y: number; z: number }) => Effect.Effect<EmotionalVisualState>
  readonly getVisibleNPCs: (npcs: StudentProfile[], states: Map<string, PsychologicalState>, playerPos: { x: number; y: number; z: number }) => Effect.Effect<EmotionalVisualState[]>
  readonly getConfig: () => Effect.Effect<EmotionalDisplayConfig>
  readonly updateConfig: (config: Partial<EmotionalDisplayConfig>) => Effect.Effect<void>
}

export function makeEmotionalDisplayEngine(config: Partial<EmotionalDisplayConfig> = {}): Effect.Effect<EmotionalDisplayEngine> {
  return Effect.gen(function* () {
    const configRef = yield* Ref.make<EmotionalDisplayConfig>({ ...DEFAULT_CONFIG, ...config })

    function computeScreenPosition(
      npcWorldPos: { x: number; y: number; z: number },
      playerPos: { x: number; y: number; z: number },
      viewportWidth: number = 800,
      viewportHeight: number = 600
    ): { x: number; y: number } {
      const dx = npcWorldPos.x - playerPos.x
      const dz = npcWorldPos.z - playerPos.z
      return {
        x: viewportWidth / 2 + dx * 32,
        y: viewportHeight / 2 + dz * 32,
      }
    }

    function distanceToPlayer(
      npcPos: { x: number; y: number; z: number },
      playerPos: { x: number; y: number; z: number }
    ): number {
      const dx = npcPos.x - playerPos.x
      const dy = (npcPos.y || 0) - playerPos.y
      const dz = npcPos.z - playerPos.z
      return Math.sqrt(dx * dx + dy * dy + dz * dz)
    }

    function getVisualStateFn(npc: StudentProfile, state: PsychologicalState, playerPos: { x: number; y: number; z: number }) {
      return Effect.gen(function* () {
        const cfg = yield* Ref.get(configRef)
        const visual = cfg.moodToVisual[state.mood]
        const npcPos = (npc as any).currentLocationPos ?? { x: 0, y: 0, z: 0 }
        const dist = distanceToPlayer(npcPos, playerPos)
        const screenPos = computeScreenPosition(npcPos, playerPos)
        const inRange = dist < cfg.maxDisplayDistance
        const interactRange = dist < 3.0
        const intensity = state.mood === "burnout" ? state.stressLevel : state.mood === "anxious" ? state.escapeUrge : state.mood === "relaxed" ? 1 - state.stressLevel : 0.5
        return {
          npcId: npc.id, mood: state.mood,
          visualCue: { ...visual, alpha: inRange ? visual.alpha * Math.max(0, 1 - dist / cfg.maxDisplayDistance) : 0 },
          intensity, screenPosition: screenPos,
          interactionRadius: interactRange ? 1.5 : 0,
          isInteractable: interactRange && (state.mood === "burnout" || state.mood === "anxious" || state.mood === "avoidant"),
          helpText: cfg.showHelpText ? MOOD_HELP_TEXT[state.mood] : "",
        }
      }) as Effect.Effect<EmotionalVisualState>
    }

    return {
      getVisualState: getVisualStateFn,

      getVisibleNPCs: (npcs, states, playerPos) =>
        Effect.gen(function* () {
          const cfg = yield* Ref.get(configRef)
          const visible: EmotionalVisualState[] = []
          for (const npc of npcs) {
            const st = states.get(npc.id)
            if (!st) continue
            const npcPos = (npc as any).currentLocationPos ?? { x: 0, y: 0, z: 0 }
            const dist = distanceToPlayer(npcPos, playerPos)
            if (dist > cfg.maxDisplayDistance) continue
            const vs = yield* getVisualStateFn(npc, st, playerPos)
            visible.push(vs)
          }
          return visible.sort((a, b) => {
            if (a.isInteractable && !b.isInteractable) return -1
            if (!a.isInteractable && b.isInteractable) return 1
            return b.intensity - a.intensity
          })
        }) as Effect.Effect<EmotionalVisualState[]>,

      getConfig: () => Ref.get(configRef),
      updateConfig: (newConfig) => Ref.update(configRef, (c) => ({ ...c, ...newConfig })).pipe(Effect.as(void 0)),
    }
  })
}
