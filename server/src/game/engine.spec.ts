import { describe, it, expect } from "vitest";
import {
  setAllHeroesMode,
  advance,
  bombIntervalMs,
  generateMap,
  newMiningState,
  setHeroMode,
  EngineHero,
  BOMB_BASE_INTERVAL_MS,
  REST_FULL_MS,
  REWARD_MICRO_PER_HP,
  MAP_COLS,
  MAP_ROWS,
} from "./engine";

const T0 = 1_000_000;

function hero(overrides: Partial<EngineHero> = {}): EngineHero {
  return {
    id: "h1",
    rarity: 0,
    power: 10,
    speed: 0, // interval = exactly BOMB_BASE_INTERVAL_MS
    staminaMax: 50,
    stamina: 50,
    mode: "work",
    simulatedTo: T0,
    ...overrides,
  };
}

describe("engine", () => {
  it("setAllHeroesMode puts every rested hero to work, skipping the exhausted", () => {
    const heroes = [
      hero({ id: "a", mode: "rest", stamina: 10 }),
      hero({ id: "b", mode: "rest", stamina: 0 }), // exhausted: must be skipped
      hero({ id: "c", mode: "work", stamina: 10 }), // already working: unchanged
    ];
    const state = newMiningState(heroes, 1);
    const changed = setAllHeroesMode(state, "work", T0);
    expect(changed).toBe(1);
    expect(state.heroes.find((h) => h.id === "a")!.mode).toBe("work");
    expect(state.heroes.find((h) => h.id === "b")!.mode).toBe("rest");
    expect(state.heroes.find((h) => h.id === "c")!.mode).toBe("work");
  });

  it("generates deterministic maps with correct dimensions", () => {
    const a = generateMap(42);
    const b = generateMap(42);
    expect(a).toEqual(b);
    expect(a).toHaveLength(MAP_COLS * MAP_ROWS);
    expect(a.every((blk) => blk.hp === blk.maxHp && blk.maxHp >= 20)).toBe(true);
  });

  it("speed reduces the interval between bombs", () => {
    expect(bombIntervalMs(hero({ speed: 0 }))).toBe(BOMB_BASE_INTERVAL_MS);
    expect(bombIntervalMs(hero({ speed: 100 }))).toBe(BOMB_BASE_INTERVAL_MS / 2);
  });

  it("mining hero deals damage, spends stamina and accrues reward", () => {
    const state = newMiningState([hero()], 1);
    const totalHpBefore = state.blocks.reduce((s, b) => s + b.hp, 0);

    advance(state, T0 + 10 * BOMB_BASE_INTERVAL_MS); // time for 10 bombs

    const totalHpAfter = state.blocks.reduce((s, b) => s + b.hp, 0);
    const damage = totalHpBefore - totalHpAfter;
    // 10 bombs x power 10, with possible waste when destroying a block
    // (excess damage does not spill over to the next block)
    expect(damage).toBeGreaterThan(0);
    expect(damage).toBeLessThanOrEqual(10 * 10);
    expect(state.heroes[0].stamina).toBe(40);
    expect(state.pendingMicroBlast).toBe(damage * REWARD_MICRO_PER_HP);
  });

  it("advance is idempotent for the same timestamp", () => {
    const state = newMiningState([hero()], 1);
    advance(state, T0 + 5 * BOMB_BASE_INTERVAL_MS);
    const snapshot = JSON.parse(JSON.stringify(state));
    advance(state, T0 + 5 * BOMB_BASE_INTERVAL_MS);
    expect(JSON.parse(JSON.stringify(state))).toEqual(snapshot);
  });

  it("depleted stamina puts the hero to rest and recovers over time", () => {
    const state = newMiningState([hero({ stamina: 3, staminaMax: 50 })], 1);
    advance(state, T0 + 100 * BOMB_BASE_INTERVAL_MS); // plenty of time for 3 bombs
    expect(state.heroes[0].mode).toBe("rest");
    expect(Math.floor(state.heroes[0].stamina)).toBeGreaterThanOrEqual(0);

    const staminaAfterMining = state.heroes[0].stamina;
    const t1 = T0 + 100 * BOMB_BASE_INTERVAL_MS;
    advance(state, t1 + REST_FULL_MS / 2); // half rest ≈ half the stamina
    expect(state.heroes[0].stamina).toBeGreaterThan(staminaAfterMining + 20);

    advance(state, t1 + 2 * REST_FULL_MS); // full rest saturates at max
    expect(state.heroes[0].stamina).toBe(50);
  });

  it("house speeds up stamina regeneration (regenBoostBps)", () => {
    const noHouse = newMiningState([hero({ stamina: 0, mode: "rest" })], 1);
    const housed = newMiningState(
      [hero({ stamina: 0, mode: "rest", regenBoostBps: 5000 })], // +50%
      1
    );
    advance(noHouse, T0 + REST_FULL_MS / 4);
    advance(housed, T0 + REST_FULL_MS / 4);

    expect(housed.heroes[0].stamina).toBeCloseTo(noHouse.heroes[0].stamina * 1.5, 5);
  });

  it("does not allow going back to work without stamina", () => {
    const state = newMiningState([hero({ stamina: 0, mode: "rest" })], 1);
    expect(() => setHeroMode(state, "h1", "work", T0)).toThrow("insufficient stamina");
  });

  it("exhausted map generates a new map and counts mapsCleared", () => {
    const strong = hero({ power: 10_000, stamina: 200, staminaMax: 200 });
    const state = newMiningState([strong], 1);
    const totalBombsNeeded = state.blocks.length; // 1 bomb destroys 1 block
    advance(state, T0 + (totalBombsNeeded + 5) * BOMB_BASE_INTERVAL_MS);
    expect(state.mapsCleared).toBeGreaterThanOrEqual(1);
    expect(state.blocks.some((b) => b.hp > 0)).toBe(true); // new map alive
  });

  it("two heroes mine in parallel deterministically", () => {
    const mk = () => newMiningState([hero({ id: "a" }), hero({ id: "b", power: 20 })], 7);
    const s1 = mk();
    const s2 = mk();
    advance(s1, T0 + 20 * BOMB_BASE_INTERVAL_MS);
    advance(s2, T0 + 20 * BOMB_BASE_INTERVAL_MS);
    expect(s1.pendingMicroBlast).toBe(s2.pendingMicroBlast);
    expect(s1.pendingMicroBlast).toBeGreaterThan(0);
  });
});
