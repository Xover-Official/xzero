import { Effect, Ref, Schedule, Stream } from "effect"
import type { Vec3 } from "../renderer/types.js"

export type StudentMood =
  | "focused"
  | "drowsy"
  | "anxious"
  | "relaxed"
  | "burnout"
  | "social"
  | "avoidant"

export type TimeOfDay =
  | "early_morning"
  | "morning_class"
  | "lunch"
  | "afternoon_class"
  | "after_school"
  | "evening"

export type DayOfWeek =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"

export type LocationType =
  | "classroom"
  | "hallway"
  | "courtyard"
  | "toilet"
  | "stairwell"
  | "entrance"
  | "outdoor_path"
  | "open_space"

export interface StudentProfile {
  id: string
  name: string
  grade: number
  personality: PersonalityTraits
  stressThreshold: number
  socialNeed: number
  academicPressure: number
  sleepDebt: number
  currentMood: StudentMood
  location: Vec3
  lastMoodChange: number
  behavioralHistory: BehavioralEvent[]
}

export interface PersonalityTraits {
  introversion: number
  conscientiousness: number
  neuroticism: number
  openness: number
  agreeableness: number
}

export interface BehavioralEvent {
  type: BehavioralEventType
  timestamp: number
  location: LocationType
  intensity: number
  notes: string
}

export type BehavioralEventType =
  | "napping"
  | "studying"
  | "socializing"
  | "avoiding"
  | "crying"
  | "laughing"
  | "wandering"
  | "hiding"
  | "eating"
  | "phone_usage"

export interface PsychologicalState {
  mood: StudentMood
  stressLevel: number
  energyLevel: number
  focusLevel: number
  socialDesire: number
  escapeUrge: number
  motivation: number
}

export interface BehavioralRule {
  id: string
  name: string
  description: string
  trigger: (state: PsychologicalState, context: BehavioralContext) => boolean
  action: (state: PsychologicalState, context: BehavioralContext) => BehavioralAction
  priority: number
}

export interface BehavioralContext {
  timeOfDay: TimeOfDay
  dayOfWeek: DayOfWeek
  locationType: LocationType
  nearbyStudents: number
  nearbyTeachers: number
  noiseLevel: number
  temperature: number
  isExamPeriod: boolean
  isLunchTime: boolean
  isAfterSchool: boolean
}

export interface BehavioralAction {
  type: BehavioralEventType
  targetLocation?: LocationType
  duration: number
  intensity: number
  moodShift?: StudentMood
  notes: string
}

export const JAPANESE_STUDENT_RULES: BehavioralRule[] = [
  {
    id: "afternoon_nap",
    name: "Afternoon Classroom Napping (inemuri)",
    description: "Japanese students commonly nap during afternoon classes, especially after lunch. This is culturally tolerated.",
    trigger: (state, context) =>
      context.timeOfDay === "afternoon_class" &&
      state.energyLevel < 0.4 &&
      context.locationType === "classroom" &&
      context.nearbyTeachers > 0,
    action: (state, context) => ({
      type: "napping",
      duration: 15 + Math.floor(Math.random() * 20),
      intensity: 0.3 + state.energyLevel * 0.3,
      moodShift: "drowsy",
      notes: "inemuri detected - head on desk, culturally normalized",
    }),
    priority: 90,
  },

  {
    id: "lunch_social",
    name: "Lunchtime Socializing (kyuushoku)",
    description: "Students gather in groups during lunch. Social bonding is critical for mental health.",
    trigger: (state, context) =>
      context.isLunchTime &&
      state.socialDesire > 0.6 &&
      context.locationType !== "classroom",
    action: (state, context) => ({
      type: "socializing",
      targetLocation: "courtyard",
      duration: 30 + Math.floor(Math.random() * 15),
      intensity: 0.7 + state.socialDesire * 0.2,
      moodShift: "social",
      notes: "kyuushoku group formation - seeking social connection",
    }),
    priority: 85,
  },

  {
    id: "exam_stress",
    name: "Exam Period Anxiety (juken stress)",
    description: "During exam periods, stress spikes dramatically. Students may exhibit avoidance or burnout.",
    trigger: (state, context) =>
      context.isExamPeriod &&
      state.stressLevel > 0.7 &&
      context.timeOfDay === "morning_class",
    action: (state, context) => ({
      type: "avoiding",
      targetLocation: "toilet",
      duration: 10 + Math.floor(Math.random() * 10),
      intensity: state.stressLevel * 0.8,
      moodShift: "anxious",
      notes: "juken stress avoidance - seeking isolation",
    }),
    priority: 95,
  },

  {
    id: "burnout_collapse",
    name: "Study Burnout (benkyou burnout)",
    description: "Prolonged academic pressure leads to complete motivation collapse. Student stops engaging.",
    trigger: (state, context) =>
      state.stressLevel > 0.85 &&
      state.energyLevel < 0.2 &&
      state.motivation < 0.15,
    action: (state, context) => ({
      type: "hiding",
      targetLocation: "stairwell",
      duration: 20 + Math.floor(Math.random() * 30),
      intensity: 0.9,
      moodShift: "burnout",
      notes: "benkyou burnout - complete disengagement, seeking hidden space",
    }),
    priority: 100,
  },

  {
    id: "courtyard_escape",
    name: "Courtyard Escape (niwa escape)",
    description: "Stressed students escape to courtyards for mental reset. Low-stress zones are magnets.",
    trigger: (state, context) =>
      state.stressLevel > 0.6 &&
      context.locationType === "classroom" &&
      context.timeOfDay !== "morning_class",
    action: (state, context) => ({
      type: "wandering",
      targetLocation: "courtyard",
      duration: 10 + Math.floor(Math.random() * 15),
      intensity: 0.5,
      moodShift: "relaxed",
      notes: "niwa escape - seeking low-stress environment",
    }),
    priority: 75,
  },

  {
    id: "phone_coping",
    name: "Phone Coping (keitai coping)",
    description: "Students use phones as emotional regulation tool, especially in transitional spaces.",
    trigger: (state, context) =>
      state.stressLevel > 0.5 &&
      (context.locationType === "hallway" || context.locationType === "stairwell") &&
      context.nearbyTeachers === 0,
    action: (state, context) => ({
      type: "phone_usage",
      duration: 5 + Math.floor(Math.random() * 10),
      intensity: state.stressLevel * 0.6,
      moodShift: "avoidant",
      notes: "keitai coping - digital emotional regulation",
    }),
    priority: 70,
  },

  {
    id: "morning_focus",
    name: "Morning Focus (asa shuchu)",
    description: "Students are most focused during morning classes. Energy is highest after rest.",
    trigger: (state, context) =>
      context.timeOfDay === "morning_class" &&
      state.energyLevel > 0.6 &&
      state.stressLevel < 0.5,
    action: (state, context) => ({
      type: "studying",
      duration: 45 + Math.floor(Math.random() * 15),
      intensity: state.focusLevel * 0.9,
      moodShift: "focused",
      notes: "asa shuchu - peak academic engagement window",
    }),
    priority: 80,
  },

  {
    id: "toilet_refuge",
    name: "Toilet Refuge (toire refuge)",
    description: "Toilets serve as private refuge spaces for overwhelmed students. Especially girls' toilets.",
    trigger: (state, context) =>
      state.stressLevel > 0.7 &&
      state.socialDesire < 0.3 &&
      context.nearbyStudents > 3,
    action: (state, context) => ({
      type: "hiding",
      targetLocation: "toilet",
      duration: 10 + Math.floor(Math.random() * 15),
      intensity: 0.8,
      moodShift: "avoidant",
      notes: "toire refuge - seeking privacy from social pressure",
    }),
    priority: 88,
  },

  {
    id: "after_school_freedom",
    name: "After-School Freedom (houkago jiyuu)",
    description: "Mood dramatically improves after school ends. Students become social and relaxed.",
    trigger: (state, context) =>
      context.isAfterSchool &&
      context.timeOfDay === "after_school",
    action: (state, context) => ({
      type: "socializing",
      targetLocation: "outdoor_path",
      duration: 30 + Math.floor(Math.random() * 60),
      intensity: 0.8,
      moodShift: "relaxed",
      notes: "houkago jiyuu - post-school liberation behavior",
    }),
    priority: 60,
  },

  {
    id: "stairwell_loiter",
    name: "Stairwell Loitering (kaidan taima)",
    description: "Students linger on stairwells between classes. Transitional spaces become social zones.",
    trigger: (state, context) =>
      context.locationType === "stairwell" &&
      context.nearbyStudents >= 2 &&
      context.nearbyTeachers === 0,
    action: (state, context) => ({
      type: "socializing",
      duration: 5 + Math.floor(Math.random() * 10),
      intensity: 0.6,
      moodShift: "social",
      notes: "kaidan taima - transitional social behavior",
    }),
    priority: 65,
  },
]

export interface QuantizedLLM {
  readonly evaluateBehavior: (
    student: StudentProfile,
    context: BehavioralContext
  ) => Effect.Effect<BehavioralAction>
  readonly updateState: (
    student: StudentProfile,
    action: BehavioralAction,
    elapsedMinutes: number
  ) => Effect.Effect<StudentProfile>
  readonly getTimeOfDay: (hour: number) => TimeOfDay
  readonly getDayOfWeek: (dayIndex: number) => DayOfWeek
  readonly generateContext: (
    hour: number,
    dayIndex: number,
    locationType: LocationType,
    nearbyStudents: number,
    nearbyTeachers: number,
    isExamPeriod: boolean
  ) => BehavioralContext
}

function getTimeOfDayFromHour(hour: number): TimeOfDay {
  if (hour < 7) return "early_morning"
  if (hour < 12) return "morning_class"
  if (hour < 13) return "lunch"
  if (hour < 15) return "afternoon_class"
  if (hour < 16) return "after_school"
  return "evening"
}

export function computePsychologicalState(student: StudentProfile, context: BehavioralContext): PsychologicalState {
  let stressLevel = student.stressThreshold
  let energyLevel = 1.0 - student.sleepDebt
  let focusLevel = 0.5
  let socialDesire = student.socialNeed
  let escapeUrge = 0
  let motivation = 0.5

  switch (context.timeOfDay) {
    case "early_morning":
      energyLevel *= 0.7
      focusLevel *= 0.6
      break
    case "morning_class":
      energyLevel *= 0.9
      focusLevel *= 1.0
      motivation *= 1.2
      break
    case "lunch":
      energyLevel *= 0.6
      socialDesire *= 1.5
      focusLevel *= 0.3
      break
    case "afternoon_class":
      energyLevel *= 0.5
      focusLevel *= 0.7
      motivation *= 0.8
      break
    case "after_school":
      energyLevel *= 0.8
      stressLevel *= 0.5
      socialDesire *= 1.3
      motivation *= 0.3
      break
    case "evening":
      energyLevel *= 0.4
      stressLevel *= 0.6
      socialDesire *= 0.8
      break
  }

  if (context.isExamPeriod) {
    stressLevel *= 1.8
    motivation *= 1.5
    escapeUrge += 0.4
  }

  if (context.noiseLevel > 0.7) {
    stressLevel *= 1.2
    focusLevel *= 0.7
  }

  if (context.locationType === "courtyard" || context.locationType === "open_space") {
    stressLevel *= 0.6
    energyLevel *= 1.1
  }

  if (context.locationType === "classroom" && context.nearbyTeachers > 0) {
    escapeUrge += 0.2
    focusLevel *= 1.1
  }

  stressLevel = Math.min(1, Math.max(0, stressLevel))
  energyLevel = Math.min(1, Math.max(0, energyLevel))
  focusLevel = Math.min(1, Math.max(0, focusLevel))
  socialDesire = Math.min(1, Math.max(0, socialDesire))
  escapeUrge = Math.min(1, Math.max(0, escapeUrge))
  motivation = Math.min(1, Math.max(0, motivation))

  let mood: StudentMood = "focused"
  if (stressLevel > 0.85 && energyLevel < 0.2) mood = "burnout"
  else if (stressLevel > 0.7) mood = "anxious"
  else if (energyLevel < 0.4) mood = "drowsy"
  else if (socialDesire > 0.7) mood = "social"
  else if (escapeUrge > 0.6) mood = "avoidant"
  else if (stressLevel < 0.3) mood = "relaxed"

  return { mood, stressLevel, energyLevel, focusLevel, socialDesire, escapeUrge, motivation }
}

export function makeQuantizedLLM(): QuantizedLLM {
  const rules = [...JAPANESE_STUDENT_RULES].sort((a, b) => b.priority - a.priority)

  return {
    evaluateBehavior: (student, context) =>
      Effect.gen(function* () {
        const state = computePsychologicalState(student, context)

        for (const rule of rules) {
          if (rule.trigger(state, context)) {
            return rule.action(state, context)
          }
        }

        return {
          type: "studying",
          duration: 30,
          intensity: state.focusLevel * 0.5,
          moodShift: state.mood,
          notes: "default behavior - no specific rule triggered",
        }
      }),

    updateState: (student, action, elapsedMinutes) =>
      Effect.gen(function* () {
        const updated = { ...student }
        const decay = elapsedMinutes / 60

        switch (action.type) {
          case "napping":
            updated.sleepDebt = Math.max(0, updated.sleepDebt - decay * 0.3)
            updated.stressThreshold = Math.max(0, updated.stressThreshold - decay * 0.1)
            break
          case "studying":
            updated.stressThreshold = Math.min(1, updated.stressThreshold + decay * 0.15)
            updated.sleepDebt = Math.min(1, updated.sleepDebt + decay * 0.1)
            break
          case "socializing":
            updated.socialNeed = Math.max(0, updated.socialNeed - decay * 0.4)
            updated.stressThreshold = Math.max(0, updated.stressThreshold - decay * 0.2)
            break
          case "avoiding":
            updated.stressThreshold = Math.max(0, updated.stressThreshold - decay * 0.05)
            updated.socialNeed = Math.min(1, updated.socialNeed + decay * 0.1)
            break
          case "crying":
            updated.stressThreshold = Math.max(0, updated.stressThreshold - decay * 0.3)
            updated.socialNeed = Math.min(1, updated.socialNeed + decay * 0.2)
            break
          case "laughing":
            updated.stressThreshold = Math.max(0, updated.stressThreshold - decay * 0.25)
            updated.socialNeed = Math.max(0, updated.socialNeed - decay * 0.15)
            break
          case "wandering":
            updated.stressThreshold = Math.max(0, updated.stressThreshold - decay * 0.1)
            updated.socialNeed = Math.min(1, updated.socialNeed + decay * 0.05)
            break
          case "hiding":
            updated.stressThreshold = Math.max(0, updated.stressThreshold - decay * 0.15)
            updated.socialNeed = Math.min(1, updated.socialNeed + decay * 0.2)
            break
          case "eating":
            updated.sleepDebt = Math.max(0, updated.sleepDebt - decay * 0.1)
            updated.socialNeed = Math.max(0, updated.socialNeed - decay * 0.2)
            break
          case "phone_usage":
            updated.stressThreshold = Math.max(0, updated.stressThreshold - decay * 0.08)
            updated.socialNeed = Math.min(1, updated.socialNeed + decay * 0.1)
            break
        }

        if (action.moodShift) {
          updated.currentMood = action.moodShift
        }

        updated.lastMoodChange = Date.now()
        updated.behavioralHistory.push({
          type: action.type,
          timestamp: Date.now(),
          location: (action.targetLocation ?? "classroom") as LocationType,
          intensity: action.intensity,
          notes: action.notes,
        })

        if (updated.behavioralHistory.length > 100) {
          updated.behavioralHistory = updated.behavioralHistory.slice(-50)
        }

        return updated
      }),

    getTimeOfDay: (hour: number): TimeOfDay => {
      if (hour < 7) return "early_morning"
      if (hour < 12) return "morning_class"
      if (hour < 13) return "lunch"
      if (hour < 15) return "afternoon_class"
      if (hour < 16) return "after_school"
      return "evening"
    },

    getDayOfWeek: (dayIndex: number): DayOfWeek => {
      const days: DayOfWeek[] = ["monday", "tuesday", "wednesday", "thursday", "friday"]
      return days[Math.max(0, Math.min(4, dayIndex))]
    },

    generateContext: (hour, dayIndex, locationType, nearbyStudents, nearbyTeachers, isExamPeriod) => ({
      timeOfDay: getTimeOfDayFromHour(hour),
      dayOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"][Math.max(0, Math.min(4, dayIndex))] as DayOfWeek,
      locationType,
      nearbyStudents,
      nearbyTeachers,
      noiseLevel: nearbyStudents > 5 ? 0.8 : nearbyStudents > 2 ? 0.5 : 0.2,
      temperature: 22,
      isExamPeriod,
      isLunchTime: hour >= 12 && hour < 13,
      isAfterSchool: hour >= 15,
    }),
  }
}

export interface PsychologicalNode {
  readonly llm: QuantizedLLM
  readonly getStudents: () => Effect.Effect<StudentProfile[]>
  readonly addStudent: (student: StudentProfile) => Effect.Effect<void>
  readonly removeStudent: (studentId: string) => Effect.Effect<void>
  readonly tick: (elapsedMinutes: number) => Effect.Effect<Map<string, BehavioralAction>>
  readonly getStudentState: (studentId: string) => Effect.Effect<PsychologicalState | null>
}

export interface BatchInferenceConfig {
  readonly inferenceIntervalMs: number    // How often to run batch inference (default: 3000ms)
  readonly maxBatchSize: number           // Max NPCs to process in one batch (default: 20)
  readonly staggerOffsetMs: number        // Offset between batches to avoid spikes (default: 500ms)
}

export const DEFAULT_BATCH_CONFIG: BatchInferenceConfig = {
  inferenceIntervalMs: 3000,
  maxBatchSize: 20,
  staggerOffsetMs: 500,
}

export interface BatchInferenceScheduler {
  readonly tick: (deltaTimeMs: number) => Effect.Effect<Map<string, BehavioralAction> | null>
  readonly addStudent: (student: StudentProfile) => Effect.Effect<void>
  readonly removeStudent: (studentId: string) => Effect.Effect<void>
  readonly getStudents: () => Effect.Effect<StudentProfile[]>
  readonly getStudentState: (studentId: string) => Effect.Effect<PsychologicalState | null>
  readonly getConfig: () => BatchInferenceConfig
  readonly updateConfig: (config: Partial<BatchInferenceConfig>) => Effect.Effect<void>
  readonly getStats: () => Effect.Effect<BatchInferenceStats>
  readonly advanceTime: (minutes: number) => Effect.Effect<void>
  readonly getTimeOfDay: () => Effect.Effect<{ hour: number; dayIndex: number; timeOfDay: TimeOfDay }>
}

export interface BatchInferenceStats {
  totalInferences: number
  totalStudentsProcessed: number
  lastInferenceTime: number
  avgInferenceDurationMs: number
  skippedTicks: number
}

export function makeBatchInferenceScheduler(
  config: BatchInferenceConfig = DEFAULT_BATCH_CONFIG
): BatchInferenceScheduler {
  const llm = makeQuantizedLLM()
  const studentsRef = new Map<string, StudentProfile>()
  const configRef = { ...config }
  const statsRef: BatchInferenceStats = {
    totalInferences: 0,
    totalStudentsProcessed: 0,
    lastInferenceTime: 0,
    avgInferenceDurationMs: 0,
    skippedTicks: 0,
  }

  let accumulatedTime = 0
  let lastBatchTime = 0
  let gameHour = 8 // Start at 8 AM, advances with game time
  let gameDayIndex = 0 // Monday

  function advanceGameTime(minutes: number): void {
    gameHour += minutes / 60
    if (gameHour >= 24) {
      gameHour -= 24
      gameDayIndex = (gameDayIndex + 1) % 5
    }
    gameHour = gameHour % 24
  }

  function computeStateForStudent(student: StudentProfile, context: BehavioralContext): PsychologicalState {
    return computePsychologicalState(student, context)
  }

  function processBatch(): Effect.Effect<Map<string, BehavioralAction>> {
    return Effect.gen(function* () {
      const actions = new Map<string, BehavioralAction>()
      const allStudents = [...studentsRef.entries()]

      // Process in batches to avoid performance spikes
      const batchSize = Math.min(configRef.maxBatchSize, allStudents.length)
      const batch = allStudents.slice(0, batchSize)

      const startTime = Date.now()

      for (const [id, student] of batch) {
          const context = llm.generateContext(
            8,
            0,
            (student as any).currentLocation,
            Math.floor(Math.random() * 10),
            Math.floor(Math.random() * 2),
            false
          )

        const state = computeStateForStudent(student, context)

        // Evaluate behavior using rule-based system (quantized LLM)
        const rules = [...JAPANESE_STUDENT_RULES].sort((a, b) => b.priority - a.priority)
        let action: BehavioralAction | null = null

        for (const rule of rules) {
          if (rule.trigger(state, context)) {
            action = rule.action(state, context)
            break
          }
        }

        if (!action) {
          action = {
            type: "studying",
            duration: 30,
            intensity: state.focusLevel * 0.5,
            moodShift: state.mood,
            notes: "default behavior - no specific rule triggered",
          }
        }

        actions.set(id, action)

        // Update student state based on action
        const decay = action.duration / 60
        const updated = { ...student }

        switch (action.type) {
          case "napping":
            updated.sleepDebt = Math.max(0, updated.sleepDebt - decay * 0.3)
            updated.stressThreshold = Math.max(0, updated.stressThreshold - decay * 0.1)
            break
          case "studying":
            updated.stressThreshold = Math.min(1, updated.stressThreshold + decay * 0.15)
            updated.sleepDebt = Math.min(1, updated.sleepDebt + decay * 0.1)
            break
          case "socializing":
            updated.socialNeed = Math.max(0, updated.socialNeed - decay * 0.4)
            updated.stressThreshold = Math.max(0, updated.stressThreshold - decay * 0.2)
            break
          case "avoiding":
            updated.stressThreshold = Math.max(0, updated.stressThreshold - decay * 0.05)
            updated.socialNeed = Math.min(1, updated.socialNeed + decay * 0.1)
            break
          case "hiding":
            updated.stressThreshold = Math.max(0, updated.stressThreshold - decay * 0.15)
            updated.socialNeed = Math.min(1, updated.socialNeed + decay * 0.2)
            break
          case "phone_usage":
            updated.stressThreshold = Math.max(0, updated.stressThreshold - decay * 0.08)
            updated.socialNeed = Math.min(1, updated.socialNeed + decay * 0.1)
            break
          case "wandering":
            updated.stressThreshold = Math.max(0, updated.stressThreshold - decay * 0.1)
            updated.socialNeed = Math.min(1, updated.socialNeed + decay * 0.05)
            break
        }

        if (action.moodShift) {
          updated.currentMood = action.moodShift
        }

        updated.lastMoodChange = Date.now()
        updated.behavioralHistory.push({
          type: action.type,
          timestamp: Date.now(),
          location: (action.targetLocation ?? "classroom") as LocationType,
          intensity: action.intensity,
          notes: action.notes,
        })

        if (updated.behavioralHistory.length > 100) {
          updated.behavioralHistory = updated.behavioralHistory.slice(-50)
        }

        studentsRef.set(id, updated)
      }

      const duration = Date.now() - startTime

      // Update stats
      statsRef.totalInferences++
      statsRef.totalStudentsProcessed += batch.length
      statsRef.lastInferenceTime = Date.now()
      statsRef.avgInferenceDurationMs =
        (statsRef.avgInferenceDurationMs * (statsRef.totalInferences - 1) + duration) / statsRef.totalInferences

      lastBatchTime = Date.now()

      return actions
    })
  }

  return {
    tick: (deltaTimeMs: number) =>
      Effect.gen(function* () {
        accumulatedTime += deltaTimeMs

        // Only run inference when interval has elapsed
        if (accumulatedTime < configRef.inferenceIntervalMs) {
          statsRef.skippedTicks++
          return null
        }

        accumulatedTime = 0

        // Run batch processing (stagger is handled by caller scheduling)
        return yield* processBatch()
      }),

    addStudent: (student) =>
      Effect.sync(() => {
        studentsRef.set(student.id, student)
      }),

    removeStudent: (studentId) =>
      Effect.sync(() => {
        studentsRef.delete(studentId)
      }),

    getStudents: () =>
      Effect.succeed([...studentsRef.values()]),

    getStudentState: (studentId) =>
      Effect.gen(function* () {
        const student = studentsRef.get(studentId)
        if (!student) return null

        const context = llm.generateContext(
          14,
          0,
          "classroom",
          5,
          1,
          false
        )

        return computeStateForStudent(student, context)
      }),

    getConfig: () => ({ ...configRef }),

    updateConfig: (newConfig) =>
      Effect.sync(() => {
        Object.assign(configRef, newConfig)
      }),

    getStats: () =>
      Effect.succeed({ ...statsRef }),

    advanceTime: (minutes: number) =>
      Effect.sync(() => {
        advanceGameTime(minutes)
      }),

    getTimeOfDay: () =>
      Effect.succeed({
        hour: Math.floor(gameHour),
        dayIndex: gameDayIndex,
        timeOfDay: getTimeOfDayFromHour(Math.floor(gameHour)),
      }),
  }
}

export function makePsychologicalNode(): PsychologicalNode {
  const llm = makeQuantizedLLM()
  const studentsRef = new Map<string, StudentProfile>()

  return {
    llm,

    getStudents: () =>
      Effect.succeed([...studentsRef.values()]),

    addStudent: (student) =>
      Effect.sync(() => {
        studentsRef.set(student.id, student)
      }),

    removeStudent: (studentId) =>
      Effect.sync(() => {
        studentsRef.delete(studentId)
      }),

    tick: (elapsedMinutes) =>
      Effect.gen(function* () {
        const actions = new Map<string, BehavioralAction>()

        for (const [id, student] of studentsRef) {
        const context = llm.generateContext(
          8,
          0,
          (student as any).currentLocation,
          5,
          1,
          false
        )

          const action = yield* llm.evaluateBehavior(student, context)
          actions.set(id, action)

          const updated = yield* llm.updateState(student, action, elapsedMinutes)
          studentsRef.set(id, updated)
        }

        return actions
      }),

    getStudentState: (studentId) =>
      Effect.gen(function* () {
        const student = studentsRef.get(studentId)
        if (!student) return null

        const context = llm.generateContext(
          8,
          0,
          (student as any).currentLocation,
          5,
          1,
          false
        )

        const state = computePsychologicalState(student, context)
        return state
      }),
  }
}
