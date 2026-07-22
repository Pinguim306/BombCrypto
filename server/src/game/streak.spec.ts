import { describe, it, expect } from "vitest";
import {
  resolveDailyClaim,
  claimedToday,
  StreakState,
  STREAK_BLAST,
  STREAK_LEN,
  JACKPOT_BLAST,
} from "./streak";

const DAY = 86_400_000;
const NOW = 100 * DAY + 12 * 3_600_000; // midday of day 100

describe("daily streak", () => {
  it("first claim lands on day 1 and rewards 2,000 BLAST", () => {
    const c = resolveDailyClaim(undefined, NOW, 0.99);
    expect(c.count).toBe(1);
    expect(c.baseBlast).toBe(2_000);
    expect(c.totalBlast).toBe(2_000);
    expect(c.rewardMicro).toBe(2_000 * 1_000_000);
  });

  it("consecutive days advance through the cycle", () => {
    let prev: StreakState = { day: 99, count: 3 };
    const c = resolveDailyClaim(prev, NOW, 0.99);
    expect(c.count).toBe(4);
    expect(c.baseBlast).toBe(STREAK_BLAST[3]);
  });

  it("a missed day resets the streak to day 1", () => {
    const prev: StreakState = { day: 97, count: 5 }; // 3 days ago
    const c = resolveDailyClaim(prev, NOW, 0.99);
    expect(c.count).toBe(1);
  });

  it("wraps from day 7 back to day 1 on the next day", () => {
    const prev: StreakState = { day: 99, count: STREAK_LEN };
    const c = resolveDailyClaim(prev, NOW, 0.99);
    expect(c.count).toBe(1);
  });

  it("day 7 pays the jackpot when the roll wins", () => {
    const prev: StreakState = { day: 99, count: STREAK_LEN - 1 };
    const won = resolveDailyClaim(prev, NOW, 0.0); // rand < 0.25 → win
    expect(won.count).toBe(STREAK_LEN);
    expect(won.jackpot).toBe(true);
    expect(won.jackpotBlast).toBe(JACKPOT_BLAST);
    expect(won.totalBlast).toBe(STREAK_BLAST[STREAK_LEN - 1] + JACKPOT_BLAST);
  });

  it("day 7 without a jackpot pays only the base reward", () => {
    const prev: StreakState = { day: 99, count: STREAK_LEN - 1 };
    const lost = resolveDailyClaim(prev, NOW, 0.99); // rand ≥ 0.25 → no jackpot
    expect(lost.jackpot).toBe(false);
    expect(lost.totalBlast).toBe(STREAK_BLAST[STREAK_LEN - 1]);
  });

  it("the jackpot only ever rolls on day 7", () => {
    const prev: StreakState = { day: 99, count: 2 };
    const c = resolveDailyClaim(prev, NOW, 0.0);
    expect(c.jackpot).toBe(false);
  });

  it("claimedToday is true only for a claim made the same calendar day", () => {
    expect(claimedToday({ day: 100, count: 1 }, NOW)).toBe(true);
    expect(claimedToday({ day: 99, count: 1 }, NOW)).toBe(false);
    expect(claimedToday(undefined, NOW)).toBe(false);
  });
});
