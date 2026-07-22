/**
 * Daily login streak — a retention loop. Claiming on consecutive days grows
 * the reward through a 7-day cycle; missing a day resets it to day 1. Rewards
 * are credited as pending BLAST (claimable through the normal voucher flow).
 *
 * Requires the player to own at least one hero, so the streak rewards active
 * miners rather than empty wallets farming free tokens.
 */
import { currentDay } from "./adventure";

/** Reward per streak day, in whole BLAST. Day 1 = 2,000, scaling to day 7. */
export const STREAK_BLAST = [2_000, 3_000, 4_000, 6_000, 8_000, 12_000, 20_000];
export const STREAK_LEN = STREAK_BLAST.length; // 7-day cycle

/** Day 7 also rolls a jackpot: a chance at a large bonus ("free chest" tier). */
export const JACKPOT_CHANCE = 0.25;
export const JACKPOT_BLAST = 40_000;

export interface StreakState {
  /** day index (currentDay) of the most recent claim */
  day: number;
  /** position in the cycle claimed that day, 1..STREAK_LEN */
  count: number;
}

export interface DailyClaim {
  count: number; // cycle day claimed (1..7)
  baseBlast: number; // guaranteed reward
  jackpot: boolean; // day-7 jackpot won?
  jackpotBlast: number; // bonus BLAST from the jackpot (0 if not won)
  totalBlast: number; // base + jackpot
  rewardMicro: number; // total in micro-BLAST (credited to pending)
}

/** The cycle position a fresh claim would land on, given the prior state. */
function nextCount(prev: StreakState | undefined, today: number): number {
  if (prev && prev.day === today - 1) {
    // consecutive day: advance, wrapping after the last day of the cycle
    return prev.count >= STREAK_LEN ? 1 : prev.count + 1;
  }
  // first claim ever, or a day was missed: restart the cycle
  return 1;
}

/** True when the player already claimed today (one claim per calendar day). */
export function claimedToday(prev: StreakState | undefined, now: number): boolean {
  return !!prev && prev.day === currentDay(now);
}

/**
 * Resolves a daily claim. `rand` (0..1) is injected for testability. Mutates
 * nothing — the caller updates the stored StreakState and pending balance
 * from the returned values.
 */
export function resolveDailyClaim(
  prev: StreakState | undefined,
  now: number,
  rand: number
): DailyClaim {
  const today = currentDay(now);
  const count = nextCount(prev, today);
  const baseBlast = STREAK_BLAST[count - 1];
  const jackpot = count === STREAK_LEN && rand < JACKPOT_CHANCE;
  const jackpotBlast = jackpot ? JACKPOT_BLAST : 0;
  const totalBlast = baseBlast + jackpotBlast;
  return {
    count,
    baseBlast,
    jackpot,
    jackpotBlast,
    totalBlast,
    rewardMicro: totalBlast * 1_000_000,
  };
}
