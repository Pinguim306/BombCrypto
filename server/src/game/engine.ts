/**
 * MinerBlast mining engine — runs exclusively on the server.
 *
 * The simulation is "lazy": nothing runs on intervals; `advance(state, now)`
 * advances the state up to `now` deterministically. This makes the engine cheap
 * (it only simulates when someone observes) and fully testable.
 */

export type HeroMode = "work" | "rest";

export interface EngineHero {
  id: string;
  rarity: number; // 0..5
  power: number; // damage per bomb
  speed: number; // reduces the interval between bombs
  staminaMax: number;
  stamina: number; // fractional while resting
  mode: HeroMode;
  /** timestamp (ms) up to which this hero has been simulated */
  simulatedTo: number;
  /** id of the house sheltering the hero (null = out in the open) */
  houseId?: string | null;
  /** house regeneration bonus (bps; 10000 = +100%) */
  regenBoostBps?: number;
}

export interface EngineBlock {
  hp: number;
  maxHp: number;
}

export interface MiningState {
  heroes: EngineHero[];
  blocks: EngineBlock[];
  mapSeed: number;
  mapsCleared: number;
  /** accumulated BLAST not yet claimed (integer units * 1e6 for precision) */
  pendingMicroBlast: number;
}

// ---- balancing parameters (will come from the GDD; tunable) ----
export const BOMB_BASE_INTERVAL_MS = 4_000; // base interval between bombs
export const REST_FULL_MS = 20 * 60_000; // full rest in 20 min
export const MAP_COLS = 8;
export const MAP_ROWS = 5;
// 7.5x original rate (5x ETH-pricing shift +50% boost) — recalibrate after TGE
export const REWARD_MICRO_PER_HP = 150_000; // 0.15 BLAST per mined HP point

/** Deterministic PRNG (mulberry32) for reproducible map generation. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateMap(seed: number): EngineBlock[] {
  const rand = rng(seed);
  const blocks: EngineBlock[] = [];
  for (let i = 0; i < MAP_COLS * MAP_ROWS; i++) {
    // HP between 20 and 120, with harder blocks being rarer
    const roll = rand();
    const maxHp =
      roll < 0.6
        ? 20 + Math.floor(rand() * 30)
        : roll < 0.9
          ? 50 + Math.floor(rand() * 40)
          : 90 + Math.floor(rand() * 30);
    blocks.push({ hp: maxHp, maxHp });
  }
  return blocks;
}

export function bombIntervalMs(hero: EngineHero): number {
  return BOMB_BASE_INTERVAL_MS / (1 + hero.speed / 100);
}

function firstAliveBlock(blocks: EngineBlock[]): number {
  return blocks.findIndex((b) => b.hp > 0);
}

/**
 * Advances a hero up to `now`, applying damage to the map and accruing reward.
 * Returns the micro-BLAST earned in the period.
 */
function advanceHero(hero: EngineHero, state: MiningState, now: number): number {
  let earned = 0;

  if (hero.mode === "rest") {
    const dt = now - hero.simulatedTo;
    const boost = 1 + (hero.regenBoostBps ?? 0) / 10000;
    hero.stamina = Math.min(
      hero.staminaMax,
      hero.stamina + (dt / REST_FULL_MS) * hero.staminaMax * boost
    );
    hero.simulatedTo = now;
    return 0;
  }

  // mode === "work"
  const interval = bombIntervalMs(hero);
  while (hero.simulatedTo + interval <= now && hero.stamina >= 1) {
    hero.simulatedTo += interval;
    let target = firstAliveBlock(state.blocks);
    if (target === -1) {
      state.mapsCleared += 1;
      state.mapSeed += 1;
      state.blocks = generateMap(state.mapSeed);
      target = 0;
    }
    const block = state.blocks[target];
    const damage = Math.min(hero.power, block.hp);
    block.hp -= damage;
    earned += damage * REWARD_MICRO_PER_HP;
    hero.stamina -= 1;
  }

  if (hero.stamina < 1) {
    // out of stamina: automatically switches to rest
    hero.mode = "rest";
  }
  hero.simulatedTo = now;
  return earned;
}

/** Advances the whole state up to `now`. Idempotent for the same `now`. */
export function advance(state: MiningState, now: number): MiningState {
  // stable order (by id) for determinism regardless of the list's origin
  const heroes = [...state.heroes].sort((a, b) => a.id.localeCompare(b.id));
  for (const hero of heroes) {
    if (hero.simulatedTo < now) {
      state.pendingMicroBlast += advanceHero(hero, state, now);
    }
  }
  return state;
}

export function setHeroMode(state: MiningState, heroId: string, mode: HeroMode, now: number): void {
  advance(state, now);
  const hero = state.heroes.find((h) => h.id === heroId);
  if (!hero) throw new Error("hero not found");
  if (mode === "work" && hero.stamina < 1) throw new Error("insufficient stamina");
  hero.mode = mode;
  hero.simulatedTo = now;
}

export function newMiningState(heroes: EngineHero[], seed: number): MiningState {
  return {
    heroes,
    blocks: generateMap(seed),
    mapSeed: seed,
    mapsCleared: 0,
    pendingMicroBlast: 0,
  };
}
