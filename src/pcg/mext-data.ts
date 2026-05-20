import type { TileType, TileCategory, StressLevel, MEXTZone, ConnectivityProfile } from "./types.js"

export const TILE_DEFINITIONS: Record<string, TileType> = {
  hallway_straight: {
    id: "hallway_straight",
    name: "Straight Hallway",
    category: "hallway",
    stressLevel: "high",
    mextCompliance: "circulation",
    connectivity: {
      doors: 2,
      maxCorridorWidth: 1,
      requiredAdjacency: ["classroom", "corridor"],
      forbiddenAdjacency: ["courtyard", "outdoor_path"],
    },
    transitionWeight: 1.0,
  },

  hallway_intersection: {
    id: "hallway_intersection",
    name: "Hallway Intersection",
    category: "hallway",
    stressLevel: "high",
    mextCompliance: "circulation",
    connectivity: {
      doors: 4,
      maxCorridorWidth: 1,
      requiredAdjacency: ["hallway", "classroom"],
      forbiddenAdjacency: ["courtyard"],
    },
    transitionWeight: 1.5,
  },

  hallway_t_junction: {
    id: "hallway_t_junction",
    name: "T-Junction Corridor",
    category: "hallway",
    stressLevel: "high",
    mextCompliance: "circulation",
    connectivity: {
      doors: 3,
      maxCorridorWidth: 1,
      requiredAdjacency: ["hallway", "classroom"],
      forbiddenAdjacency: ["courtyard"],
    },
    transitionWeight: 1.3,
  },

  hallway_corner: {
    id: "hallway_corner",
    name: "Corner Hallway",
    category: "hallway",
    stressLevel: "medium",
    mextCompliance: "circulation",
    connectivity: {
      doors: 2,
      maxCorridorWidth: 1,
      requiredAdjacency: ["hallway", "classroom"],
      forbiddenAdjacency: ["courtyard"],
    },
    transitionWeight: 1.1,
  },

  classroom_standard: {
    id: "classroom_standard",
    name: "Standard Classroom",
    category: "classroom",
    stressLevel: "medium",
    mextCompliance: "instructional",
    connectivity: {
      doors: 1,
      maxCorridorWidth: 1,
      requiredAdjacency: ["hallway", "corridor"],
      forbiddenAdjacency: ["toilet", "utility", "outdoor_path"],
    },
    transitionWeight: 0.8,
  },

  classroom_large: {
    id: "classroom_large",
    name: "Large Classroom (3x3)",
    category: "classroom",
    stressLevel: "medium",
    mextCompliance: "instructional",
    connectivity: {
      doors: 2,
      maxCorridorWidth: 2,
      requiredAdjacency: ["hallway", "corridor"],
      forbiddenAdjacency: ["toilet", "utility"],
    },
    transitionWeight: 0.9,
  },

  classroom_lab: {
    id: "classroom_lab",
    name: "Science Lab",
    category: "classroom",
    stressLevel: "medium",
    mextCompliance: "instructional",
    connectivity: {
      doors: 1,
      maxCorridorWidth: 1,
      requiredAdjacency: ["hallway", "utility"],
      forbiddenAdjacency: ["courtyard"],
    },
    transitionWeight: 0.85,
  },

  classroom_music: {
    id: "classroom_music",
    name: "Music Room",
    category: "classroom",
    stressLevel: "low",
    mextCompliance: "instructional",
    connectivity: {
      doors: 1,
      maxCorridorWidth: 1,
      requiredAdjacency: ["hallway"],
      forbiddenAdjacency: ["classroom", "toilet"],
    },
    transitionWeight: 0.7,
  },

  classroom_art: {
    id: "classroom_art",
    name: "Art Room",
    category: "classroom",
    stressLevel: "low",
    mextCompliance: "instructional",
    connectivity: {
      doors: 1,
      maxCorridorWidth: 1,
      requiredAdjacency: ["hallway", "utility"],
      forbiddenAdjacency: ["toilet"],
    },
    transitionWeight: 0.7,
  },

  corridor_wide: {
    id: "corridor_wide",
    name: "Wide Corridor",
    category: "corridor",
    stressLevel: "medium",
    mextCompliance: "circulation",
    connectivity: {
      doors: 2,
      maxCorridorWidth: 2,
      requiredAdjacency: ["hallway", "classroom"],
      forbiddenAdjacency: ["outdoor_path"],
    },
    transitionWeight: 1.2,
  },

  entrance_main: {
    id: "entrance_main",
    name: "Main Entrance",
    category: "entrance",
    stressLevel: "high",
    mextCompliance: "entrance",
    connectivity: {
      doors: 3,
      maxCorridorWidth: 2,
      requiredAdjacency: ["hallway", "outdoor_path"],
      forbiddenAdjacency: ["classroom", "toilet"],
    },
    transitionWeight: 2.0,
  },

  entrance_shoe: {
    id: "entrance_shoe",
    name: "Shoe Locker Area (genkan)",
    category: "entrance",
    stressLevel: "medium",
    mextCompliance: "entrance",
    connectivity: {
      doors: 2,
      maxCorridorWidth: 1,
      requiredAdjacency: ["entrance", "hallway"],
      forbiddenAdjacency: ["classroom", "courtyard"],
    },
    transitionWeight: 1.5,
  },

  stairwell_main: {
    id: "stairwell_main",
    name: "Main Stairwell",
    category: "stairwell",
    stressLevel: "high",
    mextCompliance: "circulation",
    connectivity: {
      doors: 2,
      maxCorridorWidth: 1,
      requiredAdjacency: ["hallway"],
      forbiddenAdjacency: ["classroom", "courtyard"],
    },
    transitionWeight: 1.8,
  },

  stairwell_emergency: {
    id: "stairwell_emergency",
    name: "Emergency Stairwell",
    category: "stairwell",
    stressLevel: "medium",
    mextCompliance: "circulation",
    connectivity: {
      doors: 1,
      maxCorridorWidth: 1,
      requiredAdjacency: ["hallway"],
      forbiddenAdjacency: ["classroom"],
    },
    transitionWeight: 1.4,
  },

  toilet_boys: {
    id: "toilet_boys",
    name: "Boys Toilet",
    category: "toilet",
    stressLevel: "low",
    mextCompliance: "service",
    connectivity: {
      doors: 1,
      maxCorridorWidth: 1,
      requiredAdjacency: ["hallway"],
      forbiddenAdjacency: ["classroom", "courtyard"],
    },
    transitionWeight: 0.5,
  },

  toilet_girls: {
    id: "toilet_girls",
    name: "Girls Toilet",
    category: "toilet",
    stressLevel: "low",
    mextCompliance: "service",
    connectivity: {
      doors: 1,
      maxCorridorWidth: 1,
      requiredAdjacency: ["hallway"],
      forbiddenAdjacency: ["classroom", "courtyard"],
    },
    transitionWeight: 0.5,
  },

  toilet_multi: {
    id: "toilet_multi",
    name: "Multi-Purpose Toilet",
    category: "toilet",
    stressLevel: "low",
    mextCompliance: "service",
    connectivity: {
      doors: 1,
      maxCorridorWidth: 1,
      requiredAdjacency: ["hallway"],
      forbiddenAdjacency: ["classroom"],
    },
    transitionWeight: 0.5,
  },

  utility_storage: {
    id: "utility_storage",
    name: "Storage Room",
    category: "utility",
    stressLevel: "low",
    mextCompliance: "service",
    connectivity: {
      doors: 1,
      maxCorridorWidth: 1,
      requiredAdjacency: ["hallway"],
      forbiddenAdjacency: ["classroom", "courtyard"],
    },
    transitionWeight: 0.3,
  },

  utility_hvac: {
    id: "utility_hvac",
    name: "HVAC Room",
    category: "utility",
    stressLevel: "low",
    mextCompliance: "service",
    connectivity: {
      doors: 1,
      maxCorridorWidth: 1,
      requiredAdjacency: ["hallway", "utility"],
      forbiddenAdjacency: ["classroom", "courtyard"],
    },
    transitionWeight: 0.3,
  },

  courtyard_small: {
    id: "courtyard_small",
    name: "Small Courtyard (2x2)",
    category: "courtyard",
    stressLevel: "low",
    mextCompliance: "open",
    connectivity: {
      doors: 0,
      maxCorridorWidth: 0,
      requiredAdjacency: ["outdoor_path", "hallway"],
      forbiddenAdjacency: ["toilet", "utility"],
    },
    transitionWeight: 0.4,
  },

  courtyard_medium: {
    id: "courtyard_medium",
    name: "Medium Courtyard (4x4)",
    category: "courtyard",
    stressLevel: "low",
    mextCompliance: "open",
    connectivity: {
      doors: 0,
      maxCorridorWidth: 0,
      requiredAdjacency: ["outdoor_path"],
      forbiddenAdjacency: ["toilet", "utility"],
    },
    transitionWeight: 0.5,
  },

  courtyard_large: {
    id: "courtyard_large",
    name: "Large Courtyard (6x6)",
    category: "courtyard",
    stressLevel: "low",
    mextCompliance: "open",
    connectivity: {
      doors: 0,
      maxCorridorWidth: 0,
      requiredAdjacency: ["outdoor_path"],
      forbiddenAdjacency: ["toilet", "utility"],
    },
    transitionWeight: 0.6,
  },

  outdoor_path: {
    id: "outdoor_path",
    name: "Outdoor Walkway",
    category: "outdoor_path",
    stressLevel: "low",
    mextCompliance: "open",
    connectivity: {
      doors: 2,
      maxCorridorWidth: 1,
      requiredAdjacency: ["courtyard", "entrance"],
      forbiddenAdjacency: ["classroom", "toilet"],
    },
    transitionWeight: 0.6,
  },

  outdoor_path_garden: {
    id: "outdoor_path_garden",
    name: "Garden Path",
    category: "outdoor_path",
    stressLevel: "low",
    mextCompliance: "open",
    connectivity: {
      doors: 2,
      maxCorridorWidth: 1,
      requiredAdjacency: ["courtyard", "outdoor_path"],
      forbiddenAdjacency: ["classroom", "toilet", "utility"],
    },
    transitionWeight: 0.5,
  },

  open_space_field: {
    id: "open_space_field",
    name: "Open Field",
    category: "open_space",
    stressLevel: "low",
    mextCompliance: "open",
    connectivity: {
      doors: 0,
      maxCorridorWidth: 0,
      requiredAdjacency: ["outdoor_path"],
      forbiddenAdjacency: ["classroom", "toilet", "utility"],
    },
    transitionWeight: 0.3,
  },

  open_space_playground: {
    id: "open_space_playground",
    name: "Playground",
    category: "open_space",
    stressLevel: "low",
    mextCompliance: "open",
    connectivity: {
      doors: 0,
      maxCorridorWidth: 0,
      requiredAdjacency: ["outdoor_path"],
      forbiddenAdjacency: ["classroom", "toilet"],
    },
    transitionWeight: 0.4,
  },

  // Maze-specific tiles for tactical generation
  hallway_dead_end: {
    id: "hallway_dead_end",
    name: "Dead End Hallway",
    category: "hallway",
    stressLevel: "medium",
    mextCompliance: "circulation",
    connectivity: {
      doors: 1,
      maxCorridorWidth: 1,
      requiredAdjacency: ["hallway", "classroom"],
      forbiddenAdjacency: ["courtyard", "outdoor_path"],
    },
    transitionWeight: 0.9,
  },

  hallway_branch: {
    id: "hallway_branch",
    name: "Branching Corridor",
    category: "hallway",
    stressLevel: "high",
    mextCompliance: "circulation",
    connectivity: {
      doors: 3,
      maxCorridorWidth: 1,
      requiredAdjacency: ["hallway", "classroom"],
      forbiddenAdjacency: ["courtyard"],
    },
    transitionWeight: 1.4,
  },

  hallway_cross: {
    id: "hallway_cross",
    name: "Cross Junction",
    category: "hallway",
    stressLevel: "high",
    mextCompliance: "circulation",
    connectivity: {
      doors: 4,
      maxCorridorWidth: 1,
      requiredAdjacency: ["hallway"],
      forbiddenAdjacency: ["courtyard"],
    },
    transitionWeight: 1.6,
  },

  hallway_loop_connector: {
    id: "hallway_loop_connector",
    name: "Loop Connector",
    category: "hallway",
    stressLevel: "medium",
    mextCompliance: "circulation",
    connectivity: {
      doors: 2,
      maxCorridorWidth: 1,
      requiredAdjacency: ["hallway"],
      forbiddenAdjacency: ["courtyard", "classroom"],
    },
    transitionWeight: 1.2,
  },

  hallway_short: {
    id: "hallway_short",
    name: "Short Hallway Segment",
    category: "hallway",
    stressLevel: "medium",
    mextCompliance: "circulation",
    connectivity: {
      doors: 2,
      maxCorridorWidth: 1,
      requiredAdjacency: ["hallway", "classroom"],
      forbiddenAdjacency: ["courtyard"],
    },
    transitionWeight: 1.1,
  },
}

export const MEXT_REGULATIONS = {
  instructionalAreaPerStudent: 3.3,
  circulationAreaPerStudent: 2.0,
  minCourtyardSize: 16,
  minCourtyardBuffer: 2,
  maxClassroomSize: 9,
  minClassroomSize: 4,
  toiletSeparation: true,
  emergencyExitSpacing: 30,
  corridorMinWidth: 1.8,
  wheelchairAccess: true,
  openAreaRatio: 0.30,
  circulationRatio: 0.13,
}

export const TILE_CATEGORIES: TileCategory[] = [
  "hallway", "courtyard", "classroom", "corridor",
  "entrance", "stairwell", "toilet", "utility",
  "outdoor_path", "open_space",
]

export const STRESS_LEVELS: StressLevel[] = ["high", "medium", "low"]

export const MEXT_ZONES: MEXTZone[] = [
  "instructional", "circulation", "service", "open", "entrance",
]

export function getTilesByCategory(category: TileCategory): TileType[] {
  return Object.values(TILE_DEFINITIONS).filter((t) => t.category === category)
}

export function getTilesByStress(stress: StressLevel): TileType[] {
  return Object.values(TILE_DEFINITIONS).filter((t) => t.stressLevel === stress)
}

export function getTilesByZone(zone: MEXTZone): TileType[] {
  return Object.values(TILE_DEFINITIONS).filter((t) => t.mextCompliance === zone)
}

export function getCompatibleTiles(tileId: string): TileType[] {
  const tile = TILE_DEFINITIONS[tileId]
  if (!tile) return []

  return Object.values(TILE_DEFINITIONS).filter((other) => {
    if (tile.connectivity.forbiddenAdjacency.includes(other.category)) return false
    if (other.connectivity.forbiddenAdjacency.includes(tile.category)) return false
    return true
  })
}

export function getTileById(id: string): TileType | undefined {
  return TILE_DEFINITIONS[id]
}

export function getAllTileIds(): string[] {
  return Object.keys(TILE_DEFINITIONS)
}
