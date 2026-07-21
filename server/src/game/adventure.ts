/**
 * MinerBlast Adventure Mode — server-side resolution of expeditions.
 *
 * The player sends a hero to a stage; the outcome is rolled on the server
 * (the client never decides). The success chance grows with the hero's
 * effective power against the stage difficulty, and there is a daily limit
 * of attempts per player to curb farming.
 */
import { EngineHero } from "./engine";

export interface AdventureStage {
  id: number;
  name: string;
  difficulty: number; // compared against the hero's effective power
  staminaCost: number;
  rewardMicro: number; // base reward in micro-BLAST
  minRarity: number; // minimum hero rarity
}

export const STAGES: AdventureStage[] = [
  { id: 0, name: "Shallow Cavern", difficulty: 25, staminaCost: 8, rewardMicro: 18_750_000, minRarity: 0 },
  { id: 1, name: "Deep Mine", difficulty: 60, staminaCost: 14, rewardMicro: 52_500_000, minRarity: 1 },
  { id: 2, name: "Volcanic Core", difficulty: 120, staminaCost: 22, rewardMicro: 135_000_000, minRarity: 3 },
];

export const DAILY_ATTEMPT_LIMIT = 10;
/** On defeat, half of the stamina cost is refunded. */
const DEFEAT_STAMINA_REFUND = 0.5;

export interface AdventureTracker {
  day: number;
  attemptsToday: number;
}

export interface AdventureResult {
  success: boolean;
  stage: string;
  rewardMicro: number;
  staminaSpent: number;
  attemptsLeft: number;
  successChance: number; // % shown to the player (transparency)
}

export function effectivePower(hero: EngineHero): number {
  return hero.power * (1 + hero.rarity * 0.15);
}

export function successChance(hero: EngineHero, stage: AdventureStage): number {
  const p = effectivePower(hero);
  return p / (p + stage.difficulty);
}

export function currentDay(now: number): number {
  return Math.floor(now / 86_400_000);
}

/**
 * Resolves an adventure. `rand` is injected (0..1) for testability;
 * in production it comes from crypto/server-side randomness.
 * Throws Error with a friendly message when requirements are not met.
 */
export function runAdventure(
  hero: EngineHero,
  stage: AdventureStage,
  tracker: AdventureTracker,
  rand: number,
  now: number
): AdventureResult {
  const day = currentDay(now);
  if (tracker.day !== day) {
    tracker.day = day;
    tracker.attemptsToday = 0;
  }
  if (tracker.attemptsToday >= DAILY_ATTEMPT_LIMIT) {
    throw new Error("daily adventure limit reached");
  }
  if (hero.rarity < stage.minRarity) {
    throw new Error(`stage requires rarity ${stage.minRarity}+`);
  }
  if (hero.stamina < stage.staminaCost) {
    throw new Error("insufficient stamina for the adventure");
  }

  tracker.attemptsToday += 1;
  const chance = successChance(hero, stage);
  const success = rand < chance;

  const staminaSpent = success
    ? stage.staminaCost
    : Math.ceil(stage.staminaCost * (1 - DEFEAT_STAMINA_REFUND));
  hero.stamina -= staminaSpent;
  if (hero.stamina < 1) hero.mode = "rest";

  // rarity bonus on the reward (same curve as effective power)
  const rewardMicro = success ? Math.round(stage.rewardMicro * (1 + hero.rarity * 0.15)) : 0;

  return {
    success,
    stage: stage.name,
    rewardMicro,
    staminaSpent,
    attemptsLeft: DAILY_ATTEMPT_LIMIT - tracker.attemptsToday,
    successChance: Math.round(chance * 100),
  };
}
