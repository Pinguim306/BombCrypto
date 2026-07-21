import { SERVER_URL } from "../config";

let jwt: string | null = sessionStorage.getItem("mb.jwt");

export function setToken(token: string) {
  jwt = token;
  sessionStorage.setItem("mb.jwt", token);
}

export function hasToken(): boolean {
  return jwt !== null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      ...init.headers,
    },
  });
  if (res.status === 401) {
    jwt = null;
    sessionStorage.removeItem("mb.jwt");
    throw new Error("sessao expirada");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export interface HeroDto {
  id: string;
  rarity: number;
  power: number;
  speed: number;
  stamina: number;
  staminaMax: number;
  mode: "work" | "rest";
  houseId: string | null;
  bombIntervalMs: number;
}

export interface HouseDto {
  id: string;
  rarity: number;
  capacity: number;
  regenBoostBps: number;
  occupants: number;
}

export interface StageDto {
  id: number;
  name: string;
  staminaCost: number;
  minRarity: number;
  rewardBlast: string;
}

export interface GameStateDto {
  pendingBlast: string;
  mapsCleared: number;
  chainSync: boolean;
  adventure: { attemptsToday: number; stages: StageDto[] };
  blocks: { hp: number; maxHp: number }[];
  houses: HouseDto[];
  heroes: HeroDto[];
}

export interface AdventureResultDto {
  success: boolean;
  stage: string;
  rewardMicro: number;
  staminaSpent: number;
  attemptsLeft: number;
  successChance: number;
  state: GameStateDto;
}

export interface VoucherDto {
  amount: string;
  nonce: string;
  deadline: number;
  signature: string;
  vault: string;
  chainId: number;
}

export const api = {
  nonce: (address: string) =>
    request<{ nonce: string }>("/auth/nonce", { method: "POST", body: JSON.stringify({ address }) }),
  verify: (message: string, signature: string) =>
    request<{ token: string; address: string }>("/auth/verify", {
      method: "POST",
      body: JSON.stringify({ message, signature }),
    }),
  state: () => request<GameStateDto>("/game/state"),
  setMode: (heroId: string, mode: "work" | "rest") =>
    request<GameStateDto>(`/game/heroes/${heroId}/mode`, {
      method: "POST",
      body: JSON.stringify({ mode }),
    }),
  adventure: (heroId: string, stageId: number) =>
    request<AdventureResultDto>(`/game/heroes/${heroId}/adventure`, {
      method: "POST",
      body: JSON.stringify({ stageId }),
    }),
  setHouse: (heroId: string, houseId: string | null) =>
    request<GameStateDto>(`/game/heroes/${heroId}/house`, {
      method: "POST",
      body: JSON.stringify({ houseId }),
    }),
  voucher: () => request<VoucherDto>("/rewards/voucher", { method: "POST" }),
};
