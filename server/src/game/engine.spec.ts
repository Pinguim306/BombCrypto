import { describe, it, expect } from "vitest";
import {
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
    speed: 0, // intervalo = BOMB_BASE_INTERVAL_MS exato
    staminaMax: 50,
    stamina: 50,
    mode: "work",
    simulatedTo: T0,
    ...overrides,
  };
}

describe("engine", () => {
  it("gera mapas determinísticos com dimensões corretas", () => {
    const a = generateMap(42);
    const b = generateMap(42);
    expect(a).toEqual(b);
    expect(a).toHaveLength(MAP_COLS * MAP_ROWS);
    expect(a.every((blk) => blk.hp === blk.maxHp && blk.maxHp >= 20)).toBe(true);
  });

  it("velocidade reduz o intervalo entre bombas", () => {
    expect(bombIntervalMs(hero({ speed: 0 }))).toBe(BOMB_BASE_INTERVAL_MS);
    expect(bombIntervalMs(hero({ speed: 100 }))).toBe(BOMB_BASE_INTERVAL_MS / 2);
  });

  it("herói minerando causa dano, gasta stamina e acumula recompensa", () => {
    const state = newMiningState([hero()], 1);
    const totalHpBefore = state.blocks.reduce((s, b) => s + b.hp, 0);

    advance(state, T0 + 10 * BOMB_BASE_INTERVAL_MS); // tempo para 10 bombas

    const totalHpAfter = state.blocks.reduce((s, b) => s + b.hp, 0);
    const damage = totalHpBefore - totalHpAfter;
    // 10 bombas x power 10, com possível desperdício ao destruir um bloco
    // (dano excedente não vaza para o bloco seguinte)
    expect(damage).toBeGreaterThan(0);
    expect(damage).toBeLessThanOrEqual(10 * 10);
    expect(state.heroes[0].stamina).toBe(40);
    expect(state.pendingMicroBlast).toBe(damage * REWARD_MICRO_PER_HP);
  });

  it("advance é idempotente para o mesmo timestamp", () => {
    const state = newMiningState([hero()], 1);
    advance(state, T0 + 5 * BOMB_BASE_INTERVAL_MS);
    const snapshot = JSON.parse(JSON.stringify(state));
    advance(state, T0 + 5 * BOMB_BASE_INTERVAL_MS);
    expect(JSON.parse(JSON.stringify(state))).toEqual(snapshot);
  });

  it("stamina zerada coloca o herói em descanso e recupera com o tempo", () => {
    const state = newMiningState([hero({ stamina: 3, staminaMax: 50 })], 1);
    advance(state, T0 + 100 * BOMB_BASE_INTERVAL_MS); // tempo de sobra p/ 3 bombas
    expect(state.heroes[0].mode).toBe("rest");
    expect(Math.floor(state.heroes[0].stamina)).toBeGreaterThanOrEqual(0);

    const staminaAfterMining = state.heroes[0].stamina;
    const t1 = T0 + 100 * BOMB_BASE_INTERVAL_MS;
    advance(state, t1 + REST_FULL_MS / 2); // meio descanso ≈ metade da stamina
    expect(state.heroes[0].stamina).toBeGreaterThan(staminaAfterMining + 20);

    advance(state, t1 + 2 * REST_FULL_MS); // descanso completo satura no máximo
    expect(state.heroes[0].stamina).toBe(50);
  });

  it("casa acelera a regeneração de stamina (regenBoostBps)", () => {
    const noHouse = newMiningState([hero({ stamina: 0, mode: "rest" })], 1);
    const housed = newMiningState(
      [hero({ stamina: 0, mode: "rest", regenBoostBps: 5000 })], // +50%
      1
    );
    advance(noHouse, T0 + REST_FULL_MS / 4);
    advance(housed, T0 + REST_FULL_MS / 4);

    expect(housed.heroes[0].stamina).toBeCloseTo(noHouse.heroes[0].stamina * 1.5, 5);
  });

  it("não permite voltar ao trabalho sem stamina", () => {
    const state = newMiningState([hero({ stamina: 0, mode: "rest" })], 1);
    expect(() => setHeroMode(state, "h1", "work", T0)).toThrow("stamina insuficiente");
  });

  it("mapa esgotado gera um novo mapa e conta mapsCleared", () => {
    const strong = hero({ power: 10_000, stamina: 200, staminaMax: 200 });
    const state = newMiningState([strong], 1);
    const totalBombsNeeded = state.blocks.length; // 1 bomba destrói 1 bloco
    advance(state, T0 + (totalBombsNeeded + 5) * BOMB_BASE_INTERVAL_MS);
    expect(state.mapsCleared).toBeGreaterThanOrEqual(1);
    expect(state.blocks.some((b) => b.hp > 0)).toBe(true); // novo mapa vivo
  });

  it("dois heróis mineram em paralelo de forma determinística", () => {
    const mk = () => newMiningState([hero({ id: "a" }), hero({ id: "b", power: 20 })], 7);
    const s1 = mk();
    const s2 = mk();
    advance(s1, T0 + 20 * BOMB_BASE_INTERVAL_MS);
    advance(s2, T0 + 20 * BOMB_BASE_INTERVAL_MS);
    expect(s1.pendingMicroBlast).toBe(s2.pendingMicroBlast);
    expect(s1.pendingMicroBlast).toBeGreaterThan(0);
  });
});
