import { Effect, Ref, Queue, Stream } from "effect"
import type { Vec3 } from "../../renderer/types.js"
import type { VoiceProfile } from "../types.js"
import type { AcousticProfile } from "./acoustic-environment.js"
import { computeDistanceAttenuation, computeOcclusionFactor } from "./acoustic-environment.js"

export interface NPCState {
  id: string
  name: string
  position: Vec3
  velocity: Vec3
  voiceProfile: VoiceProfile
  currentDialogue: string | null
  isSpeaking: boolean
  psychologicalState: {
    mood: string
    stressLevel: number
    energyLevel: number
  }
  lastInteraction: number
  dialogueCooldown: number
}

export interface DialogueTrigger {
  type: "proximity" | "line_of_sight" | "event" | "ambient" | "psychological"
  npcId: string
  priority: number
  text: string
  emotion: string
  duration: number
}

export interface NPCTriggerEngine {
  readonly addNPC: (npc: NPCState) => Effect.Effect<void>
  readonly removeNPC: (npcId: string) => Effect.Effect<void>
  readonly updateNPCPosition: (npcId: string, position: Vec3) => Effect.Effect<void>
  readonly updatePlayerPosition: (position: Vec3) => Effect.Effect<void>
  readonly tick: (elapsedMs: number) => Effect.Effect<DialogueTrigger[]>
  readonly getNearbyNPCs: (radius: number) => Effect.Effect<NPCState[]>
  readonly getSpeakingNPCs: () => Effect.Effect<NPCState[]>
  readonly triggerDialogue: (npcId: string, text: string, emotion: string) => Effect.Effect<void>
  readonly onDialogueTrigger: Effect.Effect<Stream.Stream<DialogueTrigger>>
}

export function makeNPCTriggerEngine(
  sampleRate: number = 44100,
  triggerRadius: number = 10,
  maxSimultaneousSpeakers: number = 2
): NPCTriggerEngine {
  const npcsRef = { current: new Map<string, NPCState>() }
  const playerPosRef = { current: { x: 0, y: 0, z: 0 } }
  const speakingNPCsRef = { current: new Set<string>() }
  const dialogueTriggerQueue = { current: null as Queue.Queue<DialogueTrigger> | null }

  function getOrCreateDialogueQueue(): Effect.Effect<Queue.Queue<DialogueTrigger>> {
    return Effect.sync(() => {
      if (!dialogueTriggerQueue.current) {
        dialogueTriggerQueue.current = Queue.unbounded<DialogueTrigger>().pipe(Effect.runSync)
      }
      return dialogueTriggerQueue.current!
    })
  }

  function computeProximityScore(npc: NPCState, playerPos: Vec3): number {
    const dx = npc.position.x - playerPos.x
    const dy = npc.position.y - playerPos.y
    const dz = npc.position.z - playerPos.z
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)

    if (distance > triggerRadius) return 0

    const distanceScore = 1 - distance / triggerRadius
    const facingScore = 0.5
    const psychologicalScore = npc.psychologicalState.stressLevel > 0.7 ? 0.8 : 0.3
    const cooldownPenalty = npc.lastInteraction > 0 ? Math.max(0, 1 - (Date.now() - npc.lastInteraction) / 30000) : 0

    return distanceScore * 0.5 + facingScore * 0.2 + psychologicalScore * 0.2 + (1 - cooldownPenalty) * 0.1
  }

  function generateAmbientDialogue(npc: NPCState, acousticProfile: AcousticProfile): DialogueTrigger | null {
    const mood = npc.psychologicalState.mood
    const stress = npc.psychologicalState.stressLevel

    const ambientDialogues: Record<string, string[]> = {
      focused: ["Hmm...", "Let me think...", "I should study..."],
      drowsy: ["*yawn*...", "So sleepy...", "Maybe just a quick nap..."],
      anxious: ["I'm worried...", "What if I fail?", "Everyone's watching..."],
      relaxed: ["Nice day...", "I feel good today", "Let's take it easy"],
      burnout: ["I can't do this anymore...", "Why bother...", "*sigh*"],
      social: ["Hey!", "What's up?", "Did you hear about...?"],
      avoidant: ["...", "*avoids eye contact*", "*looks away*"],
    }

    const dialogues = ambientDialogues[mood] ?? ["..."]
    const text = dialogues[Math.floor(Math.random() * dialogues.length)]

    return {
      type: "ambient",
      npcId: npc.id,
      priority: stress > 0.8 ? 80 : 30,
      text,
      emotion: mood,
      duration: text.length * 100,
    }
  }

  return {
    addNPC: (npc) =>
      Effect.sync(() => {
        npcsRef.current.set(npc.id, npc)
      }),

    removeNPC: (npcId) =>
      Effect.sync(() => {
        npcsRef.current.delete(npcId)
        speakingNPCsRef.current.delete(npcId)
      }),

    updateNPCPosition: (npcId, position) =>
      Effect.sync(() => {
        const npc = npcsRef.current.get(npcId)
        if (npc) {
          npc.velocity = {
            x: position.x - npc.position.x,
            y: position.y - npc.position.y,
            z: position.z - npc.position.z,
          }
          npc.position = position
        }
      }),

    updatePlayerPosition: (position) =>
      Effect.sync(() => {
        playerPosRef.current = position
      }),

    tick: (elapsedMs) =>
      Effect.gen(function* () {
        const triggers: DialogueTrigger[] = []
        const playerPos = playerPosRef.current
        const queue = yield* getOrCreateDialogueQueue()

        const scoredNPCs: { npc: NPCState; score: number }[] = []

        for (const [, npc] of npcsRef.current) {
          const score = computeProximityScore(npc, playerPos)
          if (score > 0.1) {
            scoredNPCs.push({ npc, score })
          }
        }

        scoredNPCs.sort((a, b) => b.score - a.score)

        for (const { npc, score } of scoredNPCs) {
          if (speakingNPCsRef.current.size >= maxSimultaneousSpeakers) break
          if (speakingNPCsRef.current.has(npc.id)) continue

          const timeSinceLastInteraction = Date.now() - npc.lastInteraction
          if (timeSinceLastInteraction < npc.dialogueCooldown) continue

          if (score > 0.6) {
            const acousticProfile = {
              reverbTime: 1.0,
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
              ambientType: "room_tone" as const,
              spatialSpread: 0.5,
              dopplerIntensity: 0.2,
              name: "Default",
            }

            const trigger = generateAmbientDialogue(npc, acousticProfile)
            if (trigger) {
              triggers.push(trigger)
              speakingNPCsRef.current.add(npc.id)
              npc.lastInteraction = Date.now()
              npc.dialogueCooldown = 5000 + Math.random() * 10000
            }
          }
        }

        for (const trigger of triggers) {
          yield* Queue.offer(queue, trigger)
        }

        return triggers
      }),

    getNearbyNPCs: (radius) =>
      Effect.sync(() => {
        const playerPos = playerPosRef.current
        const nearby: NPCState[] = []

        for (const [, npc] of npcsRef.current) {
          const dx = npc.position.x - playerPos.x
          const dy = npc.position.y - playerPos.y
          const dz = npc.position.z - playerPos.z
          const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)

          if (distance <= radius) {
            nearby.push(npc)
          }
        }

        return nearby
      }),

    getSpeakingNPCs: () =>
      Effect.sync(() => {
        const speaking: NPCState[] = []
        for (const id of speakingNPCsRef.current) {
          const npc = npcsRef.current.get(id)
          if (npc) speaking.push(npc)
        }
        return speaking
      }),

    triggerDialogue: (npcId, text, emotion) =>
      Effect.gen(function* () {
        const npc = npcsRef.current.get(npcId)
        if (!npc) return

        const trigger: DialogueTrigger = {
          type: "event",
          npcId,
          priority: 90,
          text,
          emotion,
          duration: text.length * 100,
        }

        const queue = yield* getOrCreateDialogueQueue()
        yield* Queue.offer(queue, trigger)

        speakingNPCsRef.current.add(npcId)
        npc.lastInteraction = Date.now()
        npc.dialogueCooldown = 3000
      }),

    onDialogueTrigger: (Effect.gen(function* () {
      // @ts-ignore - queue reference access
      const queue = yield* ensureQueue()
      return Stream.fromQueue(queue)
    }) as unknown) as Effect.Effect<Stream.Stream<DialogueTrigger>, never, never>,
  }
}

export interface DialogueMixer {
  readonly mixDialogue: (
    triggers: DialogueTrigger[],
    acousticProfile: AcousticProfile,
    playerPos: Vec3,
    npcs: Map<string, NPCState>
  ) => Effect.Effect<{
    mixedAudio: Float32Array
    activeTriggers: DialogueTrigger[]
    spatialPositions: Map<string, Vec3>
  }>
  readonly applySpatialPanning: (
    audio: Float32Array,
    sourcePos: Vec3,
    playerPos: Vec3,
    playerForward: Vec3
  ) => Effect.Effect<{ left: Float32Array; right: Float32Array }>
  readonly applyDistanceFilter: (
    audio: Float32Array,
    distance: number,
    acousticProfile: AcousticProfile
  ) => Effect.Effect<Float32Array>
}

export function makeDialogueMixer(sampleRate: number = 44100): DialogueMixer {
  function applyLowPassFilter(audio: Float32Array, cutoffFreq: number): Float32Array {
    const output = new Float32Array(audio.length)
    const rc = 1 / (2 * Math.PI * cutoffFreq)
    const dt = 1 / sampleRate
    const alpha = dt / (rc + dt)

    let prev = 0
    for (let i = 0; i < audio.length; i++) {
      output[i] = prev + alpha * (audio[i] - prev)
      prev = output[i]
    }

    return output
  }

  function applyHighPassFilter(audio: Float32Array, cutoffFreq: number): Float32Array {
    const output = new Float32Array(audio.length)
    const rc = 1 / (2 * Math.PI * cutoffFreq)
    const dt = 1 / sampleRate
    const alpha = rc / (rc + dt)

    let prevInput = 0
    let prevOutput = 0
    for (let i = 0; i < audio.length; i++) {
      output[i] = alpha * (prevOutput + audio[i] - prevInput)
      prevInput = audio[i]
      prevOutput = output[i]
    }

    return output
  }

  return {
    mixDialogue: (triggers, acousticProfile, playerPos, npcs) =>
      Effect.sync(() => {
        const maxDuration = Math.max(...triggers.map((t) => t.duration), 1000)
        const sampleCount = Math.floor((maxDuration / 1000) * sampleRate)
        const mixedAudio = new Float32Array(sampleCount)
        const spatialPositions = new Map<string, Vec3>()

        for (const trigger of triggers) {
          const npc = npcs.get(trigger.npcId)
          if (!npc) continue

          const dx = npc.position.x - playerPos.x
          const dy = npc.position.y - playerPos.y
          const dz = npc.position.z - playerPos.z
          const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)

          const attenuation = computeDistanceAttenuation(distance, 1, 50, 1)
          const occlusion = computeOcclusionFactor(
            playerPos,
            npc.position,
            0.5,
            "drywall"
          )

          const volume = attenuation * occlusion * (trigger.priority / 100)

          spatialPositions.set(trigger.npcId, npc.position)

          const startSample = 0
          const endSample = Math.min(sampleCount, Math.floor((trigger.duration / 1000) * sampleRate))

          for (let i = startSample; i < endSample; i++) {
            const t = i / sampleRate
            const envelope = Math.sin((Math.PI * i) / endSample)

            const baseFreq = 150 * npc.voiceProfile.pitch
            const fundamental = Math.sin(2 * Math.PI * baseFreq * t)
            const harmonic1 = 0.5 * Math.sin(2 * Math.PI * baseFreq * 2 * t)
            const harmonic2 = 0.25 * Math.sin(2 * Math.PI * baseFreq * 3 * t)

            const noise = (Math.random() * 2 - 1) * 0.02
            const voiced = (fundamental + harmonic1 + harmonic2) * 0.3 + noise

            mixedAudio[i] += voiced * envelope * volume * 0.3
          }
        }

        const totalEnergy = mixedAudio.reduce((sum, v) => sum + v * v, 0)
        if (totalEnergy > 1) {
          const normalization = 1 / Math.sqrt(totalEnergy)
          for (let i = 0; i < mixedAudio.length; i++) {
            mixedAudio[i] *= normalization
          }
        }

        return {
          mixedAudio,
          activeTriggers: triggers,
          spatialPositions,
        }
      }),

    applySpatialPanning: (audio, sourcePos, playerPos, playerForward) =>
      Effect.sync(() => {
        const dx = sourcePos.x - playerPos.x
        const dz = sourcePos.z - playerPos.z

        const rightDir = { x: playerForward.z, z: -playerForward.x }
        const dotProduct = dx * rightDir.x + dz * rightDir.z
        const distance = Math.sqrt(dx * dx + dz * dz)

        const pan = distance > 0 ? dotProduct / distance : 0
        const clampedPan = Math.max(-1, Math.min(1, pan))

        const leftGain = Math.cos((clampedPan + 1) * Math.PI / 4)
        const rightGain = Math.sin((clampedPan + 1) * Math.PI / 4)

        const left = new Float32Array(audio.length)
        const right = new Float32Array(audio.length)

        for (let i = 0; i < audio.length; i++) {
          left[i] = audio[i] * leftGain
          right[i] = audio[i] * rightGain
        }

        return { left, right }
      }),

    applyDistanceFilter: (audio, distance, acousticProfile) =>
      Effect.sync(() => {
        let filtered = audio

        const highCutFreq = acousticProfile.highCut * Math.exp(-distance * 0.01)
        if (highCutFreq < 20000) {
          filtered = applyLowPassFilter(filtered, highCutFreq)
        }

        const lowCutFreq = acousticProfile.lowCut * (1 + distance * 0.005)
        if (lowCutFreq > 20) {
          filtered = applyHighPassFilter(filtered, lowCutFreq)
        }

        return filtered
      }),
  }
}
