/**
 * Motor de mineração do MinerBlast — roda exclusivamente no servidor.
 *
 * A simulação é "lazy": nada roda em intervalos; `advance(state, now)` avança
 * o estado até `now` de forma determinística. Isso torna o motor barato
 * (só simula quando alguém observa) e totalmente testável.
 */

export type HeroMode = "work" | "rest";

export interface EngineHero {
  id: string;
  rarity: number; // 0..5
  power: number; // dano por bomba
  speed: number; // reduz o intervalo entre bombas
  staminaMax: number;
  stamina: number; // fracionária durante o descanso
  mode: HeroMode;
  /** timestamp (ms) até onde este herói já foi simulado */
  simulatedTo: number;
  /** id da casa que abriga o herói (null = ao relento) */
  houseId?: string | null;
  /** bônus de regeneração da casa (bps; 10000 = +100%) */
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
  /** BLAST acumulado ainda não sacado (unidades inteiras * 1e6 p/ precisão) */
  pendingMicroBlast: number;
}

// ---- parâmetros de balanceamento (virão do GDD; ajustáveis) ----
export const BOMB_BASE_INTERVAL_MS = 4_000; // intervalo base entre bombas
export const REST_FULL_MS = 20 * 60_000; // descanso completo em 20 min
export const MAP_COLS = 8;
export const MAP_ROWS = 5;
export const REWARD_MICRO_PER_HP = 20_000; // 0.02 BLAST por ponto de HP minerado

/** PRNG determinístico (mulberry32) para geração de mapas reproduzível. */
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
    // HP entre 20 e 120, com blocos mais duros mais raros
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
 * Avança um herói até `now`, aplicando dano ao mapa e acumulando recompensa.
 * Retorna os micro-BLAST ganhos no período.
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
    // sem stamina: entra em descanso automaticamente
    hero.mode = "rest";
  }
  hero.simulatedTo = now;
  return earned;
}

/** Avança o estado inteiro até `now`. Idempotente para o mesmo `now`. */
export function advance(state: MiningState, now: number): MiningState {
  // ordem estável (por id) para determinismo independente da origem da lista
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
  if (!hero) throw new Error("heroi nao encontrado");
  if (mode === "work" && hero.stamina < 1) throw new Error("stamina insuficiente");
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
