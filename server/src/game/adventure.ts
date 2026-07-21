/**
 * Modo Aventura do MinerBlast — resolução server-side de expedições.
 *
 * O jogador envia um herói a um estágio; o resultado é sorteado no servidor
 * (o cliente nunca decide). A chance de sucesso cresce com o poder efetivo
 * do herói contra a dificuldade do estágio, e há um limite diário de
 * tentativas por jogador para conter farming.
 */
import { EngineHero } from "./engine";

export interface AdventureStage {
  id: number;
  name: string;
  difficulty: number; // comparado ao poder efetivo do herói
  staminaCost: number;
  rewardMicro: number; // recompensa base em micro-BLAST
  minRarity: number; // raridade mínima do herói
}

export const STAGES: AdventureStage[] = [
  { id: 0, name: "Caverna Rasa", difficulty: 25, staminaCost: 8, rewardMicro: 2_500_000, minRarity: 0 },
  { id: 1, name: "Mina Profunda", difficulty: 60, staminaCost: 14, rewardMicro: 7_000_000, minRarity: 1 },
  { id: 2, name: "Núcleo Vulcânico", difficulty: 120, staminaCost: 22, rewardMicro: 18_000_000, minRarity: 3 },
];

export const DAILY_ATTEMPT_LIMIT = 10;
/** Em caso de derrota, devolve-se metade do custo de stamina. */
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
  successChance: number; // % exibida ao jogador (transparência)
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
 * Resolve uma aventura. `rand` é injetado (0..1) para testabilidade;
 * em produção vem de crypto/aleatoriedade do servidor.
 * Lança Error com mensagem amigável quando os requisitos falham.
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
    throw new Error("limite diario de aventuras atingido");
  }
  if (hero.rarity < stage.minRarity) {
    throw new Error(`estagio exige raridade ${stage.minRarity}+`);
  }
  if (hero.stamina < stage.staminaCost) {
    throw new Error("stamina insuficiente para a aventura");
  }

  tracker.attemptsToday += 1;
  const chance = successChance(hero, stage);
  const success = rand < chance;

  const staminaSpent = success
    ? stage.staminaCost
    : Math.ceil(stage.staminaCost * (1 - DEFEAT_STAMINA_REFUND));
  hero.stamina -= staminaSpent;
  if (hero.stamina < 1) hero.mode = "rest";

  // bônus de raridade na recompensa (mesma curva do poder efetivo)
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
