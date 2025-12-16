export enum Owner {
  PLAYER = 'PLAYER',
  AI = 'AI',
  NEUTRAL = 'NEUTRAL',
}

export enum EntityType {
  WORKER = 'WORKER',
  MARINE = 'MARINE',
  MEDIC = 'MEDIC',
  BASE = 'BASE',
  BARRACKS = 'BARRACKS',
  BUNKER = 'BUNKER',
  SUPPLY_DEPOT = 'SUPPLY_DEPOT',
  MINERAL = 'MINERAL',
  MOUNTAIN = 'MOUNTAIN',
  WATER = 'WATER',
}

export enum Difficulty {
    EASY = 'EASY',
    MEDIUM = 'MEDIUM',
    HARD = 'HARD'
}

export interface Vector2 {
  x: number;
  y: number;
}

export interface Effect {
  id: string;
  type: 'EXPLOSION' | 'BLOOD' | 'BUILDING_EXPLOSION' | 'HEAL';
  position: Vector2;
  life: number;
  maxLife: number;
  scale: number;
}

export interface Marker {
  id: string;
  position: Vector2;
  type: 'MOVE' | 'ATTACK' | 'LOAD';
  life: number;
  maxLife: number;
}

export interface Notification {
    id: string;
    text: string;
    life: number;
}

export interface Entity {
  id: string;
  type: EntityType;
  owner: Owner;
  position: Vector2;
  radius: number;
  hp: number;
  maxHp: number;
  targetId: string | null;
  targetPosition: Vector2 | null;
  state: 'IDLE' | 'MOVING' | 'ATTACKING' | 'GATHERING' | 'RETURNING' | 'BUILDING' | 'ENTERING' | 'GARRISONED' | 'HEALING';
  cooldown: number;
  resourceAmount?: number; // For minerals or carrying
  constructionProgress?: number; // 0-100
  trainQueue?: EntityType[];
  trainProgress?: number;
  rallyPoint?: Vector2 | null;
  rallyTargetId?: string | null;
  lastAttackerId?: string | null; // For retaliation
  garrison?: string[]; // IDs of units inside (for Bunker)
  containerId?: string | null; // ID of entity this unit is inside
}

export interface GameState {
  entities: Map<string, Entity>;
  effects: Effect[];
  markers: Marker[];
  notifications: Notification[];
  soundEvents: string[];
  resources: {
    [Owner.PLAYER]: number;
    [Owner.AI]: number;
  };
  supply: {
    [Owner.PLAYER]: { used: number; max: number };
    [Owner.AI]: { used: number; max: number };
  };
  selection: string[];
  camera: Vector2;
  victory?: Owner;
  gameTime: number;
  difficulty: Difficulty;
  paused: boolean;
}

export interface UnitStats {
  cost: number;
  hp: number;
  damage: number;
  range: number;
  vision: number;
  speed: number;
  attackSpeed: number;
  buildTime: number;
  width: number;
  height: number;
  supplyCost: number;
  supplyProvided: number;
  healRate?: number; // For Medics
}