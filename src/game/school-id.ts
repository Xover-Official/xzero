import { Effect, Ref } from "effect"

export interface SchoolID {
  id: string
  seed: number
  name: string
  createdAt: number
  stats: SchoolStats
  shareCode: string
}

export interface SchoolStats {
  totalChunksExplored: number
  rareTilesDiscovered: number
  npcsHelped: number
  avgPlayerStress: number
  totalPlayTimeMs: number
  transformationsTriggered: number
  deepestChunkX: number
  deepestChunkZ: number
}

export interface SchoolIDSystem {
  readonly createSchool: (seed: number, name?: string) => Effect.Effect<SchoolID>
  readonly loadSchool: (shareCode: string) => Effect.Effect<SchoolID | null>
  readonly getSchool: () => Effect.Effect<SchoolID | null>
  readonly updateStats: (updates: Partial<SchoolStats>) => Effect.Effect<void>
  readonly getShareCode: () => Effect.Effect<string>
  readonly generateShareableCard: () => Effect.Effect<SchoolCard>
}

export interface SchoolCard {
  schoolId: string
  name: string
  seed: number
  shareCode: string
  stats: SchoolStats
  asciiArt: string
  summary: string
}

function encodeShareCode(seed: number, explored: number, rare: number, helped: number): string {
  const data = `${seed}-${explored}-${rare}-${helped}`
  const base64 = Buffer.from(data).toString("base64url")
  return `xzero://${base64.slice(0, 16)}`
}

function decodeShareCode(shareCode: string): { seed: number; explored: number; rare: number; helped: number } | null {
  try {
    const prefix = "xzero://"
    if (!shareCode.startsWith(prefix)) return null
    const encoded = shareCode.slice(prefix.length)
    const decoded = Buffer.from(encoded, "base64url").toString("utf8")
    const parts = decoded.split("-")
    if (parts.length !== 4) return null
    return {
      seed: parseInt(parts[0]),
      explored: parseInt(parts[1]),
      rare: parseInt(parts[2]),
      helped: parseInt(parts[3]),
    }
  } catch {
    return null
  }
}

const SCHOOL_NAMES_PREFIX = [
  "Sakura", "Hikari", "Yuki", "Kaze", "Mizu",
  "Hana", "Tsuki", "Hoshi", "Sora", "Yama",
  "Kawa", "Umi", "Mori", "Ame", "Niji",
]

const SCHOOL_NAMES_SUFFIX = [
  "Academy", "High School", "Institute", "Seminary", "Collegium",
  "Gakuen", "Koukou", "Juku", "Senmon", "Daigaku",
]

function generateSchoolName(seed: number): string {
  const prefixIdx = Math.abs(seed) % SCHOOL_NAMES_PREFIX.length
  const suffixIdx = (Math.abs(seed) >> 8) % SCHOOL_NAMES_SUFFIX.length
  return `${SCHOOL_NAMES_PREFIX[prefixIdx]} ${SCHOOL_NAMES_SUFFIX[suffixIdx]}`
}

function generateASCIIArt(seed: number): string {
  const patterns = [
    `
  ╔══════════════════════╗
  ║  🏫 ${" ".repeat(16)} ║
  ║     S E E D          ║
  ║     ${String(seed).padEnd(16)}║
  ║                      ║
  ║  "Every hallway        ║
  ║   hides a story"      ║
  ╚══════════════════════╝`,
    `
  ┌──────────────────────┐
  │  ┌────┐  ┌────┐     │
  │  │    │  │    │     │
  │  │ ██ │  │ ██ │     │
  │  │    │  │    │     │
  │  └────┘  └────┘     │
  │    Seed: ${String(seed).padEnd(12)} │
  └──────────────────────┘`,
    `
  ╭──────────────────────╮
  │   ╱╲    ╱╲    ╱╲    │
  │  ╱  ╲  ╱  ╲  ╱  ╲   │
  │ ╱ ██ ╲╱ ██ ╲╱ ██ ╲  │
  │ ╲    ╱╲    ╱╲    ╱  │
  │  ╲  ╱  ╲  ╱  ╲  ╱   │
  │   ╲╱    ╲╱    ╲╱    │
  │   ${`#${seed}`.padEnd(20)}│
  ╰──────────────────────╯`,
  ]
  return patterns[Math.abs(seed) % patterns.length]
}

export function makeSchoolIDSystem(): Effect.Effect<SchoolIDSystem> {
  return Effect.gen(function* () {
    const currentSchool = yield* Ref.make<SchoolID | null>(null)

    return {
      createSchool: (seed, name) =>
        Effect.gen(function* () {
          const schoolName = name ?? generateSchoolName(seed)
          const now = Date.now()

          const school: SchoolID = {
            id: `school_${seed}_${now}`,
            seed,
            name: schoolName,
            createdAt: now,
            stats: {
              totalChunksExplored: 0,
              rareTilesDiscovered: 0,
              npcsHelped: 0,
              avgPlayerStress: 0,
              totalPlayTimeMs: 0,
              transformationsTriggered: 0,
              deepestChunkX: 0,
              deepestChunkZ: 0,
            },
            shareCode: encodeShareCode(seed, 0, 0, 0),
          }

          yield* Ref.set(currentSchool, school)
          console.log(`[school] Created: ${school.name} (seed: ${seed})`)
          console.log(`[school] Share: ${school.shareCode}`)
          return school
        }),

      loadSchool: (shareCode) =>
        Effect.gen(function* () {
          const decoded = decodeShareCode(shareCode)
          if (!decoded) return null

          const school: SchoolID = {
            id: `school_${decoded.seed}_loaded`,
            seed: decoded.seed,
            name: generateSchoolName(decoded.seed),
            createdAt: Date.now(),
            stats: {
              totalChunksExplored: decoded.explored,
              rareTilesDiscovered: decoded.rare,
              npcsHelped: decoded.helped,
              avgPlayerStress: 0,
              totalPlayTimeMs: 0,
              transformationsTriggered: 0,
              deepestChunkX: 0,
              deepestChunkZ: 0,
            },
            shareCode,
          }

          yield* Ref.set(currentSchool, school)
          return school
        }),

      getSchool: () =>
        Ref.get(currentSchool),

      updateStats: (updates) =>
        Effect.gen(function* () {
          const school = yield* Ref.get(currentSchool)
          if (!school) return

          const updated = {
            ...school,
            stats: { ...school.stats, ...updates },
            shareCode: encodeShareCode(
              school.seed,
              school.stats.totalChunksExplored + (updates.totalChunksExplored ?? 0),
              school.stats.rareTilesDiscovered + (updates.rareTilesDiscovered ?? 0),
              school.stats.npcsHelped + (updates.npcsHelped ?? 0)
            ),
          }

          yield* Ref.set(currentSchool, updated)
        }),

      getShareCode: () =>
        Ref.get(currentSchool).pipe(
          Effect.map((s) => s?.shareCode ?? "")
        ),

      generateShareableCard: () =>
        Effect.gen(function* () {
          const school = yield* Ref.get(currentSchool)
          if (!school) return null as unknown as SchoolCard
          const playMinutes = Math.floor(school.stats.totalPlayTimeMs / 60000)
          const summary = [
            `${school.name}`, `Seed: ${school.seed}`,
            `Chunks explored: ${school.stats.totalChunksExplored}`,
            `Rare discoveries: ${school.stats.rareTilesDiscovered}`,
            `Students helped: ${school.stats.npcsHelped}`,
            `Play time: ${playMinutes}min`,
          ].join("\n")
          return {
            schoolId: school.id, name: school.name, seed: school.seed,
            shareCode: school.shareCode, stats: school.stats,
            asciiArt: generateASCIIArt(school.seed), summary,
          }
        }),
    }
  })
}
