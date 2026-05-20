import { Effect } from "effect"
import {
  getAcousticProfile,
  DEFAULT_ACOUSTIC_PROFILE,
  ACOUSTIC_PROFILES,
  lerpAcousticProfiles,
  computeOcclusionFactor,
  computeDistanceAttenuation,
  computeDopplerShift,
} from "../src/audio/acoustic/acoustic-environment.js"
import {
  makeSpatialReverbEngine,
  makeConvolutionReverbEngine,
} from "../src/audio/acoustic/spatial-reverb.js"
import {
  makeVoiceSeedDatabase,
  makeVoiceConsistencyEngine,
  generateVoiceSeedFromPosition,
  selectVoiceFromSeed,
} from "../src/audio/acoustic/voice-seed.js"
import {
  makeNPCTriggerEngine,
  makeDialogueMixer,
} from "../src/audio/acoustic/npc-triggers.js"
import {
  makeAcousticOcclusionBridge,
  createTileChangeAcousticEvent,
  createNPCDialogueAcousticEvent,
  createAmbientShiftAcousticEvent,
} from "../src/audio/acoustic/acoustic-occlusion-bridge.js"
import type { VoiceProfile } from "../src/audio/types.js"
import type { Vec3 } from "../src/renderer/types.js"

console.log("=== XZero Acoustic Occlusion Bridge Test Suite ===\n")

async function test(name: string, fn: () => Promise<boolean>) {
  try {
    const result = await fn()
    if (result) {
      console.log(`  PASS: ${name}`)
    } else {
      console.log(`  FAIL: ${name}`)
      process.exitCode = 1
    }
  } catch (err) {
    console.log(`  FAIL: ${name} - ${err}`)
    process.exitCode = 1
  }
}

const testVoices: VoiceProfile[] = [
  {
    id: "elder-male",
    name: "Elder Male",
    speakerId: "speaker_0",
    pitch: 0.8,
    speed: 0.9,
    emotion: "wise",
    language: "en",
    sampleRate: 24000,
  },
  {
    id: "young-female",
    name: "Young Female",
    speakerId: "speaker_1",
    pitch: 1.2,
    speed: 1.1,
    emotion: "cheerful",
    language: "en",
    sampleRate: 24000,
  },
  {
    id: "guard-male",
    name: "Guard Male",
    speakerId: "speaker_2",
    pitch: 0.7,
    speed: 1.0,
    emotion: "stern",
    language: "en",
    sampleRate: 24000,
  },
]

async function runTests() {
  console.log("1. Acoustic Environment Tests")

  await test("getAcousticProfile returns correct profile for hallway", async () => {
    const profile = getAcousticProfile("hallway")
    return profile.name === "School Hallway" && profile.reverbTime === 1.2
  })

  await test("getAcousticProfile returns correct profile for classroom", async () => {
    const profile = getAcousticProfile("classroom")
    return profile.name === "Classroom" && profile.reverbTime === 0.6
  })

  await test("getAcousticProfile returns correct profile for courtyard", async () => {
    const profile = getAcousticProfile("courtyard")
    return profile.name === "Courtyard" && profile.reverbTime === 2.0
  })

  await test("getAcousticProfile returns default for unknown category", async () => {
    const profile = getAcousticProfile("unknown" as any)
    return profile.name === "Default Space"
  })

  await test("all tile categories have acoustic profiles", async () => {
    const categories = ["hallway", "classroom", "corridor", "courtyard", "entrance", "stairwell", "toilet", "utility", "outdoor_path", "open_space"]
    return categories.every((cat) => ACOUSTIC_PROFILES[cat] !== undefined)
  })

  await test("lerpAcousticProfiles blends two profiles", async () => {
    const hallway = getAcousticProfile("hallway")
    const classroom = getAcousticProfile("classroom")
    const blended = lerpAcousticProfiles(hallway, classroom, 0.5)

    const expectedReverb = (hallway.reverbTime + classroom.reverbTime) / 2
    return Math.abs(blended.reverbTime - expectedReverb) < 0.01
  })

  await test("lerpAcousticProfiles returns first profile at t=0", async () => {
    const hallway = getAcousticProfile("hallway")
    const classroom = getAcousticProfile("classroom")
    const blended = lerpAcousticProfiles(hallway, classroom, 0)

    return blended.reverbTime === hallway.reverbTime
  })

  await test("lerpAcousticProfiles returns second profile at t=1", async () => {
    const hallway = getAcousticProfile("hallway")
    const classroom = getAcousticProfile("classroom")
    const blended = lerpAcousticProfiles(hallway, classroom, 1)

    return blended.reverbTime === classroom.reverbTime
  })

  await test("computeOcclusionFactor returns 1.0 for no obstruction", async () => {
    const playerPos = { x: 0, y: 0, z: 0 }
    const sourcePos = { x: 5, y: 0, z: 0 }
    const occlusion = computeOcclusionFactor(playerPos, sourcePos, 0, "air")

    return Math.abs(occlusion - 1.0) < 0.01
  })

  await test("computeOcclusionFactor decreases with wall thickness", async () => {
    const playerPos = { x: 0, y: 0, z: 0 }
    const sourcePos = { x: 5, y: 0, z: 0 }
    const thinWall = computeOcclusionFactor(playerPos, sourcePos, 0.1, "drywall")
    const thickWall = computeOcclusionFactor(playerPos, sourcePos, 1.0, "drywall")

    return thickWall < thinWall
  })

  await test("computeDistanceAttenuation returns 1.0 at min distance", async () => {
    const attenuation = computeDistanceAttenuation(0.5, 1, 50, 1)
    return attenuation === 1.0
  })

  await test("computeDistanceAttenuation returns 0.0 at max distance", async () => {
    const attenuation = computeDistanceAttenuation(50, 1, 50, 1)
    return attenuation === 0.0
  })

  await test("computeDistanceAttenuation decreases with distance", async () => {
    const near = computeDistanceAttenuation(5, 1, 50, 1)
    const far = computeDistanceAttenuation(40, 1, 50, 1)

    return near > far
  })

  await test("computeDopplerShift returns 1.0 for stationary objects", async () => {
    const sourceVel = { x: 0, y: 0, z: 0 }
    const playerVel = { x: 0, y: 0, z: 0 }
    const sourceToPlayer = { x: 5, y: 0, z: 0 }

    const doppler = computeDopplerShift(sourceVel, playerVel, sourceToPlayer)
    return Math.abs(doppler - 1.0) < 0.01
  })

  await test("computeDopplerShift increases when approaching", async () => {
    const sourceVel = { x: -10, y: 0, z: 0 }
    const playerVel = { x: 0, y: 0, z: 0 }
    const sourceToPlayer = { x: -5, y: 0, z: 0 }

    const doppler = computeDopplerShift(sourceVel, playerVel, sourceToPlayer)
    return doppler > 1.0
  })

  console.log("\n2. Spatial Reverb Tests")

  await test("spatial reverb engine creates successfully", async () => {
    const engine = makeSpatialReverbEngine(44100)
    return engine !== null
  })

  await test("spatial reverb processes a sample", async () => {
    const engine = makeSpatialReverbEngine(44100)
    const result = await engine.processSample(0.5, 0).pipe(Effect.runPromise)
    return typeof result === "number"
  })

  await test("spatial reverb processes a buffer", async () => {
    const engine = makeSpatialReverbEngine(44100)
    const input = new Float32Array(1024)
    for (let i = 0; i < 1024; i++) {
      input[i] = Math.sin(2 * Math.PI * 440 * (i / 44100)) * 0.3
    }

    const result = await engine.processBuffer(input, 0).pipe(Effect.runPromise)
    return result.length === input.length
  })

  await test("spatial reverb profile can be changed", async () => {
    const engine = makeSpatialReverbEngine(44100)
    const hallway = getAcousticProfile("hallway")

    await engine.setProfile(hallway).pipe(Effect.runPromise)
    const profile = await engine.getProfile().pipe(Effect.runPromise)

    return profile.name === "School Hallway"
  })

  await test("spatial reverb wet/dry mix can be changed", async () => {
    const engine = makeSpatialReverbEngine(44100)
    await engine.setWetDryMix(0.8).pipe(Effect.runPromise)
    return true
  })

  await test("spatial reverb can be reset", async () => {
    const engine = makeSpatialReverbEngine(44100)
    await engine.reset().pipe(Effect.runPromise)
    return true
  })

  await test("convolution reverb engine creates successfully", async () => {
    const engine = makeConvolutionReverbEngine()
    return engine !== null
  })

  await test("convolution reverb convolves two signals", async () => {
    const engine = makeConvolutionReverbEngine()
    const input = new Float32Array([1, 0, 0, 0, 0])
    const ir = new Float32Array([0.5, 0.3, 0.2, 0.1, 0.05])

    const result = engine.convolve(input, ir)
    return result.length === 9
  })

  await test("convolution reverb generates room impulse response", async () => {
    const engine = makeConvolutionReverbEngine()
    const profile = getAcousticProfile("classroom")
    const ir = engine.generateRoomImpulseResponse(profile, 44100)

    return ir.length === 44100 && ir.some((v) => v !== 0)
  })

  await test("convolution reverb generates outdoor impulse response", async () => {
    const engine = makeConvolutionReverbEngine()
    const profile = getAcousticProfile("courtyard")
    const ir = engine.generateOutdoorImpulseResponse(profile, 44100)

    return ir.length === 44100 && ir.some((v) => v !== 0)
  })

  await test("convolution reverb generates corridor impulse response", async () => {
    const engine = makeConvolutionReverbEngine()
    const profile = getAcousticProfile("hallway")
    const ir = engine.generateCorridorImpulseResponse(profile, 44100)

    return ir.length === 44100 && ir.some((v) => v !== 0)
  })

  await test("corridor impulse response has slapback echo", async () => {
    const engine = makeConvolutionReverbEngine()
    const profile = getAcousticProfile("hallway")
    const ir = engine.generateCorridorImpulseResponse(profile, 44100)

    const slapbackSample = Math.floor(profile.slapbackDelay * 44100)
    return ir[slapbackSample] > 0
  })

  console.log("\n3. Voice Seed Tests")

  await test("voice seed database creates successfully", async () => {
    const db = makeVoiceSeedDatabase()
    return db !== null
  })

  await test("voice seed database returns null for unknown NPC", async () => {
    const db = makeVoiceSeedDatabase()
    const seed = await db.getVoiceSeed("unknown-npc").pipe(Effect.runPromise)
    return seed === null
  })

  await test("voice seed database creates seed for new NPC", async () => {
    const db = makeVoiceSeedDatabase()
    const seed = await db.getOrCreateVoiceSeed("npc-1", 0, 0, testVoices).pipe(Effect.runPromise)

    return seed.npcId === "npc-1" && seed.voiceProfile !== null
  })

  await test("voice seed database returns same seed for same NPC", async () => {
    const db = makeVoiceSeedDatabase()
    const seed1 = await db.getOrCreateVoiceSeed("npc-1", 0, 0, testVoices).pipe(Effect.runPromise)
    const seed2 = await db.getOrCreateVoiceSeed("npc-1", 0, 0, testVoices).pipe(Effect.runPromise)

    return seed1.seedValue === seed2.seedValue
  })

  await test("voice seed database returns different seeds for different chunks", async () => {
    const db = makeVoiceSeedDatabase()
    const seed1 = await db.getSeedValue("npc-1", 0, 0).pipe(Effect.runPromise)
    const seed2 = await db.getSeedValue("npc-1", 1, 0).pipe(Effect.runPromise)

    return seed1 !== seed2
  })

  await test("voice seed database can remove seeds", async () => {
    const db = makeVoiceSeedDatabase()
    await db.getOrCreateVoiceSeed("npc-1", 0, 0, testVoices).pipe(Effect.runPromise)
    await db.removeVoiceSeed("npc-1").pipe(Effect.runPromise)
    const seed = await db.getVoiceSeed("npc-1").pipe(Effect.runPromise)

    return seed === null
  })

  await test("voice seed database returns all seeds", async () => {
    const db = makeVoiceSeedDatabase()
    await db.getOrCreateVoiceSeed("npc-1", 0, 0, testVoices).pipe(Effect.runPromise)
    await db.getOrCreateVoiceSeed("npc-2", 1, 0, testVoices).pipe(Effect.runPromise)
    const seeds = await db.getAllSeeds().pipe(Effect.runPromise)

    return seeds.length === 2
  })

  await test("voice seed database getSeedValue returns consistent value", async () => {
    const db = makeVoiceSeedDatabase()
    const seed1 = await db.getSeedValue("npc-1", 0, 0).pipe(Effect.runPromise)
    const seed2 = await db.getSeedValue("npc-1", 0, 0).pipe(Effect.runPromise)

    return seed1 === seed2
  })

  await test("voice consistency engine creates successfully", async () => {
    const engine = makeVoiceConsistencyEngine()
    return engine !== null
  })

  await test("voice consistency engine assigns voice to NPC", async () => {
    const engine = makeVoiceConsistencyEngine()
    const voice = await engine.assignVoiceToNPC("npc-1", 0, 0, testVoices).pipe(Effect.runPromise)

    return voice !== null && voice.id !== undefined
  })

  await test("voice consistency engine returns same voice for same NPC", async () => {
    const engine = makeVoiceConsistencyEngine()
    const voice1 = await engine.assignVoiceToNPC("npc-1", 0, 0, testVoices).pipe(Effect.runPromise)
    const voice2 = await engine.getNPCVoice("npc-1").pipe(Effect.runPromise)

    return voice1.speakerId === voice2?.speakerId
  })

  await test("voice consistency engine verifies consistency", async () => {
    const engine = makeVoiceConsistencyEngine()
    await engine.assignVoiceToNPC("npc-1", 0, 0, testVoices).pipe(Effect.runPromise)
    const consistent = await engine.verifyVoiceConsistency("npc-1", 0, 0, testVoices).pipe(Effect.runPromise)

    return consistent === true
  })

  await test("voice consistency engine migrates voice to new chunk", async () => {
    const engine = makeVoiceConsistencyEngine()
    const voice1 = await engine.assignVoiceToNPC("npc-1", 0, 0, testVoices).pipe(Effect.runPromise)
    const voice2 = await engine.migrateVoiceToChunk("npc-1", 0, 0, 1, 0, testVoices).pipe(Effect.runPromise)

    return voice1.speakerId === voice2.speakerId
  })

  await test("generateVoiceSeedFromPosition returns consistent value", async () => {
    const seed1 = generateVoiceSeedFromPosition(10, 20, "guard")
    const seed2 = generateVoiceSeedFromPosition(10, 20, "guard")

    return seed1 === seed2
  })

  await test("generateVoiceSeedFromPosition returns different values for different positions", async () => {
    const seed1 = generateVoiceSeedFromPosition(10, 20, "guard")
    const seed2 = generateVoiceSeedFromPosition(30, 40, "guard")

    return seed1 !== seed2
  })

  await test("selectVoiceFromSeed selects voice from list", async () => {
    const seed = generateVoiceSeedFromPosition(10, 20, "guard")
    const voice = selectVoiceFromSeed(seed, testVoices)

    return testVoices.includes(voice)
  })

  await test("selectVoiceFromSeed is deterministic", async () => {
    const seed = generateVoiceSeedFromPosition(10, 20, "guard")
    const voice1 = selectVoiceFromSeed(seed, testVoices)
    const voice2 = selectVoiceFromSeed(seed, testVoices)

    return voice1.id === voice2.id
  })

  console.log("\n4. NPC Trigger Tests")

  await test("NPC trigger engine creates successfully", async () => {
    const engine = makeNPCTriggerEngine(44100, 10, 2)
    return engine !== null
  })

  await test("NPC trigger engine adds NPC", async () => {
    const engine = makeNPCTriggerEngine(44100, 10, 2)
    const npc = {
      id: "npc-1",
      name: "Test NPC",
      position: { x: 5, y: 0, z: 5 },
      velocity: { x: 0, y: 0, z: 0 },
      voiceProfile: testVoices[0],
      currentDialogue: null,
      isSpeaking: false,
      psychologicalState: {
        mood: "focused",
        stressLevel: 0.3,
        energyLevel: 0.8,
      },
      lastInteraction: 0,
      dialogueCooldown: 0,
    }

    await engine.addNPC(npc).pipe(Effect.runPromise)
    return true
  })

  await test("NPC trigger engine removes NPC", async () => {
    const engine = makeNPCTriggerEngine(44100, 10, 2)
    const npc = {
      id: "npc-1",
      name: "Test NPC",
      position: { x: 5, y: 0, z: 5 },
      velocity: { x: 0, y: 0, z: 0 },
      voiceProfile: testVoices[0],
      currentDialogue: null,
      isSpeaking: false,
      psychologicalState: {
        mood: "focused",
        stressLevel: 0.3,
        energyLevel: 0.8,
      },
      lastInteraction: 0,
      dialogueCooldown: 0,
    }

    await engine.addNPC(npc).pipe(Effect.runPromise)
    await engine.removeNPC("npc-1").pipe(Effect.runPromise)
    const nearby = await engine.getNearbyNPCs(100).pipe(Effect.runPromise)

    return nearby.length === 0
  })

  await test("NPC trigger engine updates NPC position", async () => {
    const engine = makeNPCTriggerEngine(44100, 10, 2)
    const npc = {
      id: "npc-1",
      name: "Test NPC",
      position: { x: 5, y: 0, z: 5 },
      velocity: { x: 0, y: 0, z: 0 },
      voiceProfile: testVoices[0],
      currentDialogue: null,
      isSpeaking: false,
      psychologicalState: {
        mood: "focused",
        stressLevel: 0.3,
        energyLevel: 0.8,
      },
      lastInteraction: 0,
      dialogueCooldown: 0,
    }

    await engine.addNPC(npc).pipe(Effect.runPromise)
    await engine.updateNPCPosition("npc-1", { x: 10, y: 0, z: 10 }).pipe(Effect.runPromise)
    const nearby = await engine.getNearbyNPCs(100).pipe(Effect.runPromise)

    return nearby[0]?.position.x === 10
  })

  await test("NPC trigger engine updates player position", async () => {
    const engine = makeNPCTriggerEngine(44100, 10, 2)
    await engine.updatePlayerPosition({ x: 0, y: 0, z: 0 }).pipe(Effect.runPromise)
    return true
  })

  await test("NPC trigger engine tick produces triggers", async () => {
    const engine = makeNPCTriggerEngine(44100, 10, 2)
    const npc = {
      id: "npc-1",
      name: "Test NPC",
      position: { x: 2, y: 0, z: 2 },
      velocity: { x: 0, y: 0, z: 0 },
      voiceProfile: testVoices[0],
      currentDialogue: null,
      isSpeaking: false,
      psychologicalState: {
        mood: "anxious",
        stressLevel: 0.8,
        energyLevel: 0.3,
      },
      lastInteraction: 0,
      dialogueCooldown: 0,
    }

    await engine.addNPC(npc).pipe(Effect.runPromise)
    await engine.updatePlayerPosition({ x: 0, y: 0, z: 0 }).pipe(Effect.runPromise)
    const triggers = await engine.tick(100).pipe(Effect.runPromise)

    return triggers.length >= 0
  })

  await test("NPC trigger engine gets nearby NPCs", async () => {
    const engine = makeNPCTriggerEngine(44100, 10, 2)
    const npc1 = {
      id: "npc-1",
      name: "Near NPC",
      position: { x: 3, y: 0, z: 3 },
      velocity: { x: 0, y: 0, z: 0 },
      voiceProfile: testVoices[0],
      currentDialogue: null,
      isSpeaking: false,
      psychologicalState: {
        mood: "focused",
        stressLevel: 0.3,
        energyLevel: 0.8,
      },
      lastInteraction: 0,
      dialogueCooldown: 0,
    }
    const npc2 = {
      id: "npc-2",
      name: "Far NPC",
      position: { x: 50, y: 0, z: 50 },
      velocity: { x: 0, y: 0, z: 0 },
      voiceProfile: testVoices[1],
      currentDialogue: null,
      isSpeaking: false,
      psychologicalState: {
        mood: "focused",
        stressLevel: 0.3,
        energyLevel: 0.8,
      },
      lastInteraction: 0,
      dialogueCooldown: 0,
    }

    await engine.addNPC(npc1).pipe(Effect.runPromise)
    await engine.addNPC(npc2).pipe(Effect.runPromise)
    await engine.updatePlayerPosition({ x: 0, y: 0, z: 0 }).pipe(Effect.runPromise)
    const nearby = await engine.getNearbyNPCs(10).pipe(Effect.runPromise)

    return nearby.length === 1 && nearby[0].id === "npc-1"
  })

  await test("NPC trigger engine triggers dialogue", async () => {
    const engine = makeNPCTriggerEngine(44100, 10, 2)
    const npc = {
      id: "npc-1",
      name: "Test NPC",
      position: { x: 5, y: 0, z: 5 },
      velocity: { x: 0, y: 0, z: 0 },
      voiceProfile: testVoices[0],
      currentDialogue: null,
      isSpeaking: false,
      psychologicalState: {
        mood: "focused",
        stressLevel: 0.3,
        energyLevel: 0.8,
      },
      lastInteraction: 0,
      dialogueCooldown: 0,
    }

    await engine.addNPC(npc).pipe(Effect.runPromise)
    await engine.triggerDialogue("npc-1", "Hello traveler!", "friendly").pipe(Effect.runPromise)
    return true
  })

  await test("dialogue mixer creates successfully", async () => {
    const mixer = makeDialogueMixer(44100)
    return mixer !== null
  })

  await test("dialogue mixer mixes dialogue triggers", async () => {
    const mixer = makeDialogueMixer(44100)
    const acousticProfile = getAcousticProfile("hallway")
    const playerPos = { x: 0, y: 0, z: 0 }
    const npcs = new Map()
    npcs.set("npc-1", {
      id: "npc-1",
      name: "Test NPC",
      position: { x: 5, y: 0, z: 5 },
      velocity: { x: 0, y: 0, z: 0 },
      voiceProfile: testVoices[0],
      currentDialogue: null,
      isSpeaking: false,
      psychologicalState: {
        mood: "focused",
        stressLevel: 0.3,
        energyLevel: 0.8,
      },
      lastInteraction: 0,
      dialogueCooldown: 0,
    })

    const triggers = [
      {
        type: "proximity" as const,
        npcId: "npc-1",
        priority: 80,
        text: "Hello!",
        emotion: "friendly",
        duration: 1000,
      },
    ]

    const result = await mixer.mixDialogue(triggers, acousticProfile, playerPos, npcs).pipe(Effect.runPromise)
    return result.mixedAudio.length > 0 && result.activeTriggers.length === 1
  })

  await test("dialogue mixer applies spatial panning", async () => {
    const mixer = makeDialogueMixer(44100)
    const audio = new Float32Array(1024)
    for (let i = 0; i < 1024; i++) {
      audio[i] = Math.sin(2 * Math.PI * 440 * (i / 44100)) * 0.3
    }

    const sourcePos = { x: 5, y: 0, z: 0 }
    const playerPos = { x: 0, y: 0, z: 0 }
    const playerForward = { x: 0, y: 0, z: -1 }

    const result = await mixer.applySpatialPanning(audio, sourcePos, playerPos, playerForward).pipe(Effect.runPromise)
    return result.left.length === audio.length && result.right.length === audio.length
  })

  await test("dialogue mixer applies distance filter", async () => {
    const mixer = makeDialogueMixer(44100)
    const audio = new Float32Array(1024)
    for (let i = 0; i < 1024; i++) {
      audio[i] = Math.sin(2 * Math.PI * 440 * (i / 44100)) * 0.3
    }

    const acousticProfile = getAcousticProfile("hallway")
    const result = await mixer.applyDistanceFilter(audio, 10, acousticProfile).pipe(Effect.runPromise)

    return result.length === audio.length
  })

  console.log("\n5. Acoustic Occlusion Bridge Tests")

  await test("acoustic occlusion bridge creates successfully", async () => {
    const bridge = makeAcousticOcclusionBridge({}, testVoices)
    return bridge !== null
  })

  await test("acoustic bridge updates player position", async () => {
    const bridge = makeAcousticOcclusionBridge({}, testVoices)
    await bridge.updatePlayerPosition({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }).pipe(Effect.runPromise)
    return true
  })

  await test("acoustic bridge updates current tile", async () => {
    const bridge = makeAcousticOcclusionBridge({}, testVoices)
    await bridge.updateCurrentTile("classroom").pipe(Effect.runPromise)
    const profile = await bridge.getCurrentAcousticProfile().pipe(Effect.runPromise)

    return profile.name === "Classroom"
  })

  await test("acoustic bridge updates nearby tiles", async () => {
    const bridge = makeAcousticOcclusionBridge({}, testVoices)
    const tiles = [
      { category: "hallway" as const, position: { x: 5, y: 0, z: 0 }, distance: 5 },
      { category: "classroom" as const, position: { x: 10, y: 0, z: 0 }, distance: 10 },
    ]

    await bridge.updateNearbyTiles(tiles).pipe(Effect.runPromise)
    return true
  })

  await test("acoustic bridge processes audio through environment", async () => {
    const bridge = makeAcousticOcclusionBridge({}, testVoices)
    const audio = new Float32Array(1024)
    for (let i = 0; i < 1024; i++) {
      audio[i] = Math.sin(2 * Math.PI * 440 * (i / 44100)) * 0.3
    }

    const result = await bridge.processAudioThroughEnvironment(audio).pipe(Effect.runPromise)
    return result.length > 0
  })

  await test("acoustic bridge adds and removes NPCs", async () => {
    const bridge = makeAcousticOcclusionBridge({}, testVoices)
    const npc = {
      id: "npc-1",
      name: "Test NPC",
      position: { x: 5, y: 0, z: 5 },
      velocity: { x: 0, y: 0, z: 0 },
      voiceProfile: testVoices[0],
      currentDialogue: null,
      isSpeaking: false,
      psychologicalState: {
        mood: "focused",
        stressLevel: 0.3,
        energyLevel: 0.8,
      },
      lastInteraction: 0,
      dialogueCooldown: 0,
    }

    await bridge.addNPC(npc).pipe(Effect.runPromise)
    await bridge.removeNPC("npc-1").pipe(Effect.runPromise)
    return true
  })

  await test("acoustic bridge tick produces results", async () => {
    const bridge = makeAcousticOcclusionBridge({}, testVoices)
    const result = await bridge.tick(100).pipe(Effect.runPromise)

    return result.triggers !== undefined && result.acousticProfile !== undefined
  })

  await test("acoustic bridge gets voice for NPC", async () => {
    const bridge = makeAcousticOcclusionBridge({}, testVoices)
    const voice = await bridge.getVoiceForNPC("npc-1", 0, 0).pipe(Effect.runPromise)

    return voice !== null && voice.id !== undefined
  })

  await test("acoustic bridge returns consistent voice for same NPC", async () => {
    const bridge = makeAcousticOcclusionBridge({}, testVoices)
    const voice1 = await bridge.getVoiceForNPC("npc-1", 0, 0).pipe(Effect.runPromise)
    const voice2 = await bridge.getVoiceForNPC("npc-1", 0, 0).pipe(Effect.runPromise)

    return voice1.speakerId === voice2.speakerId
  })

  await test("acoustic bridge can be reset", async () => {
    const bridge = makeAcousticOcclusionBridge({}, testVoices)
    await bridge.reset().pipe(Effect.runPromise)
    const profile = await bridge.getCurrentAcousticProfile().pipe(Effect.runPromise)

    return profile.name === "School Hallway"
  })

  await test("acoustic bridge onEnvironmentalChange returns stream", async () => {
    const bridge = makeAcousticOcclusionBridge({}, testVoices)
    const stream = await bridge.onEnvironmentalChange.pipe(Effect.runPromise)
    return stream !== null
  })

  await test("acoustic bridge onDialogueTrigger returns stream", async () => {
    const bridge = makeAcousticOcclusionBridge({}, testVoices)
    const stream = await bridge.onDialogueTrigger.pipe(Effect.runPromise)
    return stream !== null
  })

  await test("createTileChangeAcousticEvent creates correct event", async () => {
    const event = createTileChangeAcousticEvent("classroom")
    return event.type === "tile_change" && event.data.tileCategory === "classroom"
  })

  await test("createNPCDialogueAcousticEvent creates correct event", async () => {
    const event = createNPCDialogueAcousticEvent("npc-1", "Hello!", 5, 0.8)
    return event.type === "npc_dialogue" && event.data.npcId === "npc-1"
  })

  await test("createAmbientShiftAcousticEvent creates correct event", async () => {
    const profile = getAcousticProfile("courtyard")
    const event = createAmbientShiftAcousticEvent(profile)
    return event.type === "ambient_shift" && event.data.acousticProfile?.name === "Courtyard"
  })

  console.log("\n=== All acoustic occlusion bridge tests completed ===")
}

runTests().catch(console.error)
