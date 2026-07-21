import { describe, it, expect } from "vitest";
import {
  runAdventure,
  successChance,
  STAGES,
  DAILY_ATTEMPT_LIMIT,
  AdventureTracker,
} from "./adventure";
import { EngineHero } from "./engine";

const NOW = 100 * 86_400_000; // day 100

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
  it("victory: spends full stamina and pays reward with rarity bonus", () => {
    const h = hero();
    const t = tracker();
    const stage = STAGES[0];

    const result = runAdventure(h, stage, t, 0.0, NOW); // rand 0 => always wins
    expect(result.success).toBe(true);
    expect(result.rewardMicro).toBe(Math.round(stage.rewardMicro * 1.15)); // rarity 1
    expect(h.stamina).toBe(60 - stage.staminaCost);
    expect(result.attemptsLeft).toBe(DAILY_ATTEMPT_LIMIT - 1);
  });

  it("defeat: no reward and refunds half of the stamina cost", () => {
    const h = hero();
    const stage = STAGES[0];
    const result = runAdventure(h, stage, tracker(), 0.999, NOW); // high rand => defeat
    expect(result.success).toBe(false);
    expect(result.rewardMicro).toBe(0);
    expect(h.stamina).toBe(60 - Math.ceil(stage.staminaCost / 2));
  });

  it("success chance grows with power and rarity", () => {
    const weak = successChance(hero({ power: 10, rarity: 0 }), STAGES[1]);
    const strong = successChance(hero({ power: 80, rarity: 4 }), STAGES[1]);
    expect(strong).toBeGreaterThan(weak);
    expect(weak).toBeGreaterThan(0);
    expect(strong).toBeLessThan(1);
  });

  it("blocks rarity below the minimum and insufficient stamina", () => {
    expect(() => runAdventure(hero({ rarity: 0 }), STAGES[2], tracker(), 0.5, NOW)).toThrow(
      "rarity"
    );
    expect(() => runAdventure(hero({ stamina: 2 }), STAGES[0], tracker(), 0.5, NOW)).toThrow(
      "insufficient stamina"
    );
  });

  it("enforces the daily limit and resets at the day rollover", () => {
    const t = tracker({ attemptsToday: DAILY_ATTEMPT_LIMIT });
    expect(() => runAdventure(hero(), STAGES[0], t, 0.5, NOW)).toThrow("daily adventure limit");

    // next day: counter resets
    const result = runAdventure(hero(), STAGES[0], t, 0.0, NOW + 86_400_000);
    expect(result.success).toBe(true);
    expect(t.attemptsToday).toBe(1);
  });

  it("defeat that depletes stamina puts the hero to rest", () => {
    const h = hero({ stamina: 8, mode: "work" });
    runAdventure(h, STAGES[0], tracker(), 0.999, NOW); // defeat: spends 4
    expect(h.stamina).toBe(4);
    const h2 = hero({ stamina: 8, mode: "work" });
    runAdventure(h2, STAGES[0], tracker(), 0.0, NOW); // victory: spends 8
    expect(h2.stamina).toBe(0);
    expect(h2.mode).toBe("rest");
  });
});
