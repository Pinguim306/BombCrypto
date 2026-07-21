import { describe, it, expect } from "vitest";
import {
  runAdventure,
  successChance,
  STAGES,
  DAILY_ATTEMPT_LIMIT,
  AdventureTracker,
} from "./adventure";
import { EngineHero } from "./engine";

const NOW = 100 * 86_400_000; // dia 100

function hero(overrides: Partial<EngineHero> = {}): EngineHero {
  return {
    id: "h1",
    rarity: 1,
    power: 30,
    speed: 20,
    staminaMax: 60,
    stamina: 60,
    mode: "rest",
    simulatedTo: NOW,
    ...overrides,
  };
}

function tracker(overrides: Partial<AdventureTracker> = {}): AdventureTracker {
  return { day: 100, attemptsToday: 0, ...overrides };
}

describe("adventure", () => {
  it("vitória: gasta stamina cheia e paga recompensa com bônus de raridade", () => {
    const h = hero();
    const t = tracker();
    const stage = STAGES[0];

    const result = runAdventure(h, stage, t, 0.0, NOW); // rand 0 => sempre vence
    expect(result.success).toBe(true);
    expect(result.rewardMicro).toBe(Math.round(stage.rewardMicro * 1.15)); // raridade 1
    expect(h.stamina).toBe(60 - stage.staminaCost);
    expect(result.attemptsLeft).toBe(DAILY_ATTEMPT_LIMIT - 1);
  });

  it("derrota: sem recompensa e devolve metade do custo de stamina", () => {
    const h = hero();
    const stage = STAGES[0];
    const result = runAdventure(h, stage, tracker(), 0.999, NOW); // rand alto => derrota
    expect(result.success).toBe(false);
    expect(result.rewardMicro).toBe(0);
    expect(h.stamina).toBe(60 - Math.ceil(stage.staminaCost / 2));
  });

  it("chance de sucesso cresce com poder e raridade", () => {
    const fraco = successChance(hero({ power: 10, rarity: 0 }), STAGES[1]);
    const forte = successChance(hero({ power: 80, rarity: 4 }), STAGES[1]);
    expect(forte).toBeGreaterThan(fraco);
    expect(fraco).toBeGreaterThan(0);
    expect(forte).toBeLessThan(1);
  });

  it("bloqueia raridade abaixo do mínimo e stamina insuficiente", () => {
    expect(() => runAdventure(hero({ rarity: 0 }), STAGES[2], tracker(), 0.5, NOW)).toThrow(
      "raridade"
    );
    expect(() => runAdventure(hero({ stamina: 2 }), STAGES[0], tracker(), 0.5, NOW)).toThrow(
      "stamina insuficiente"
    );
  });

  it("aplica limite diário e reseta na virada do dia", () => {
    const t = tracker({ attemptsToday: DAILY_ATTEMPT_LIMIT });
    expect(() => runAdventure(hero(), STAGES[0], t, 0.5, NOW)).toThrow("limite diario");

    // dia seguinte: contador zera
    const result = runAdventure(hero(), STAGES[0], t, 0.0, NOW + 86_400_000);
    expect(result.success).toBe(true);
    expect(t.attemptsToday).toBe(1);
  });

  it("derrota que zera a stamina coloca o herói em descanso", () => {
    const h = hero({ stamina: 8, mode: "work" });
    runAdventure(h, STAGES[0], tracker(), 0.999, NOW); // derrota: gasta 4
    expect(h.stamina).toBe(4);
    const h2 = hero({ stamina: 8, mode: "work" });
    runAdventure(h2, STAGES[0], tracker(), 0.0, NOW); // vitória: gasta 8
    expect(h2.stamina).toBe(0);
    expect(h2.mode).toBe("rest");
  });
});
