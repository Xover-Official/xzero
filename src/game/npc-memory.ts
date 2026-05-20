import { Effect, Ref } from "effect"
import type { StudentMood } from "../pcg/psychological-node.js"

export interface PlayerAction {
  type: "helped" | "ignored" | "talked" | "gave_item" | "scared" | "followed"
  timestamp: number
  chunkX: number
  chunkZ: number
  details: Record<string, unknown>
}

export interface NPCMemoryEntry {
  npcId: string
  actions: PlayerAction[]
  relationshipScore: number
  lastInteraction: number
  moodOnFirstMeeting: StudentMood
  currentMood: StudentMood
  greetingVariant: GreetingVariant
  trustLevel: TrustLevel
}

export type GreetingVariant =
  | "avoidant"
  | "neutral"
  | "friendly"
  | "grateful"
  | "warm"
  | "secret_sharer"

export type TrustLevel = "stranger" | "acquaintance" | "friend" | "trusted" | "confidant"

export interface NPCMemorySystem {
  readonly recordInteraction: (npcId: string, action: PlayerAction) => Effect.Effect<void>
  readonly getMemory: (npcId: string) => Effect.Effect<NPCMemoryEntry | null>
  readonly getGreeting: (npcId: string) => Effect.Effect<GreetingVariant>
  readonly getTrustLevel: (npcId: string) => Effect.Effect<TrustLevel>
  readonly getRelationshipScore: (npcId: string) => Effect.Effect<number>
  readonly getAllMemories: () => Effect.Effect<Map<string, NPCMemoryEntry>>
  readonly getGreetingText: (npcId: string, npcName: string) => Effect.Effect<string>
}

const GREETING_TEXTS: Record<GreetingVariant, string[]> = {
  avoidant: [
    "...",
    "*avoids eye contact*",
    "*steps back*",
    "...do you need something?",
  ],
  neutral: [
    "Oh, hi.",
    "Hey.",
    "What's up?",
    "...yeah?",
  ],
  friendly: [
    "Hey! Good to see you.",
    "Oh, it's you! Hi!",
    "What's going on?",
    "Hey there!",
  ],
  grateful: [
    "Hey... thanks for before. Really.",
    "I haven't forgotten what you did. Thank you.",
    "You're one of the good ones.",
    "I... I wanted to say thanks. For helping me.",
  ],
  warm: [
    "Hey! I was hoping I'd run into you.",
    "There you are! How've you been?",
    "Always nice to see you around here.",
    "You know, this place feels a bit better when you're around.",
  ],
  secret_sharer: [
    "Psst... come here. I found something.",
    "I don't tell everyone this, but...",
    "There's a place I want to show you. Can you keep a secret?",
    "You're the only one I trust with this...",
  ],
}

export function makeNPCMemorySystem(): Effect.Effect<NPCMemorySystem> {
  return Effect.gen(function* () {
    const memories = yield* Ref.make<Map<string, NPCMemoryEntry>>(new Map())

    function computeTrustLevel(score: number): TrustLevel {
      if (score >= 50) return "confidant"
      if (score >= 30) return "trusted"
      if (score >= 15) return "friend"
      if (score >= 5) return "acquaintance"
      return "stranger"
    }

    function computeGreetingVariant(score: number, hasHelped: boolean, hasIgnored: boolean): GreetingVariant {
      if (score >= 50 && hasHelped) return "secret_sharer"
      if (score >= 30 && hasHelped) return "warm"
      if (hasHelped) return "grateful"
      if (score >= 15) return "friendly"
      if (hasIgnored && score < 0) return "avoidant"
      return "neutral"
    }

    return {
      recordInteraction: (npcId, action) =>
        Effect.gen(function* () {
          const memMap = yield* Ref.get(memories)
          let entry = memMap.get(npcId)

          if (!entry) {
            entry = {
              npcId,
              actions: [],
              relationshipScore: 0,
              lastInteraction: 0,
              moodOnFirstMeeting: "neutral" as StudentMood,
              currentMood: "neutral" as StudentMood,
              greetingVariant: "neutral",
              trustLevel: "stranger",
            }
          }

          let scoreDelta = 0
          switch (action.type) {
            case "helped": scoreDelta = 10; break
            case "talked": scoreDelta = 2; break
            case "gave_item": scoreDelta = 8; break
            case "ignored": scoreDelta = -3; break
            case "scared": scoreDelta = -8; break
            case "followed": scoreDelta = -2; break
          }

          entry.actions.push(action)
          entry.relationshipScore += scoreDelta
          entry.lastInteraction = action.timestamp
          entry.trustLevel = computeTrustLevel(entry.relationshipScore)

          const hasHelped = entry.actions.some(a => a.type === "helped")
          const hasIgnored = entry.actions.some(a => a.type === "ignored")
          entry.greetingVariant = computeGreetingVariant(entry.relationshipScore, hasHelped, hasIgnored)

          const updated = new Map(memMap)
          updated.set(npcId, entry)
          yield* Ref.set(memories, updated)
        }),

      getMemory: (npcId) =>
        Ref.get(memories).pipe(
          Effect.map((m) => m.get(npcId) ?? null)
        ),

      getGreeting: (npcId) =>
        Ref.get(memories).pipe(
          Effect.map((m) => m.get(npcId)?.greetingVariant ?? "neutral")
        ),

      getTrustLevel: (npcId) =>
        Ref.get(memories).pipe(
          Effect.map((m) => m.get(npcId)?.trustLevel ?? "stranger")
        ),

      getRelationshipScore: (npcId) =>
        Ref.get(memories).pipe(
          Effect.map((m) => m.get(npcId)?.relationshipScore ?? 0)
        ),

      getAllMemories: () =>
        Ref.get(memories),

      getGreetingText: (npcId, npcName) =>
        Effect.gen(function* () {
          const memMap = yield* Ref.get(memories)
          const entry = memMap.get(npcId)
          const variant = entry?.greetingVariant ?? "neutral"
          const texts = GREETING_TEXTS[variant]
          const idx = Math.floor(Math.random() * texts.length)
          return `${npcName}: "${texts[idx]}"`
        }),
    }
  })
}
