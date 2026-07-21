import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import {
  EngineHero,
  HeroMode,
  MiningState,
  advance,
  bombIntervalMs,
  newMiningState,
  setHeroMode,
  rng,
} from "./engine";
import { PersistenceService } from "../storage/persistence.service";
import { ChainService, ChainHouse } from "./chain.service";
import { AdventureTracker, STAGES, currentDay, runAdventure } from "./adventure";
import { MIN_CLAIM_BLAST, CLAIM_COOLDOWN_HOURS } from "../config";
import { randomInt } from "node:crypto";

export interface PlayerState {
  address: string;
  mining: MiningState;
  houses: ChainHouse[];
  adventure: AdventureTracker;
  /** last on-chain sync (ms) */
  syncedAt: number;
}

const CHAIN_SYNC_INTERVAL_MS = 60_000;

/** Basic dev house when no chain is configured. */
const DEV_HOUSE: ChainHouse = { id: "dev-house", rarity: 0, capacity: 2, regenBoostBps: 2000 };

@Injectable()
export class GameService {
  private players = new Map<string, PlayerState>();
  private seedCounter = 1;

  constructor(
    private readonly persistence: PersistenceService,
    private readonly chain: ChainService
  ) {}

  private async getOrCreate(address: string): Promise<PlayerState> {
    const key = address.toLowerCase();
    let player = this.players.get(key);

    if (!player) {
      const saved = this.persistence.loadPlayerState(key);
      if (saved) {
        player = JSON.parse(saved) as PlayerState;
        // migration for states saved before Adventure mode
        player.adventure ??= { day: currentDay(Date.now()), attemptsToday: 0 };
      } else {
        const seed = this.seedCounter++;
        player = {
          address,
          mining: newMiningState(
            this.chain.enabled ? [] : this.devHeroes(seed),
            seed * 1000 + Date.now() % 997
          ),
          houses: this.chain.enabled ? [] : [DEV_HOUSE],
          adventure: { day: currentDay(Date.now()), attemptsToday: 0 },
          syncedAt: 0,
        };
      }
      this.players.set(key, player);
    }

    if (this.chain.enabled && Date.now() - player.syncedAt > CHAIN_SYNC_INTERVAL_MS) {
      await this.syncFromChain(player);
    }
    return player;
  }

  /** Merges on-chain heroes/houses, preserving stamina and mode of known ones. */
  private async syncFromChain(player: PlayerState): Promise<void> {
    const now = Date.now();
    const [chainHeroes, chainHouses] = await Promise.all([
      this.chain.heroesOf(player.address, now),
      this.chain.housesOf(player.address),
    ]);

    const known = new Map(player.mining.heroes.map((h) => [h.id, h]));
    player.mining.heroes = chainHeroes.map((fresh) => {
      const existing = known.get(fresh.id);
      if (!existing) return fresh;
      // attributes come from the chain (upgrades are reflected); local progress is preserved
      return {
        ...fresh,
        stamina: Math.min(existing.stamina, fresh.staminaMax),
        mode: existing.mode,
        simulatedTo: existing.simulatedTo,
        houseId: existing.houseId,
        regenBoostBps: existing.regenBoostBps,
      };
    });
    player.houses = chainHouses;
    this.reconcileHousing(player);
    player.syncedAt = now;
  }

  /** Unhouses heroes whose house disappeared or exceeded capacity. */
  private reconcileHousing(player: PlayerState): void {
    const capacity = new Map(player.houses.map((h) => [h.id, h.capacity]));
    const used = new Map<string, number>();
    for (const hero of player.mining.heroes) {
      if (!hero.houseId) continue;
      const cap = capacity.get(hero.houseId);
      const u = used.get(hero.houseId) ?? 0;
      if (cap === undefined || u >= cap) {
        hero.houseId = null;
        hero.regenBoostBps = 0;
      } else {
        used.set(hero.houseId, u + 1);
      }
    }
  }

  private persist(player: PlayerState): void {
    this.persistence.savePlayerState(player.address, JSON.stringify(player));
  }

  /** State advanced up to now, in a serializable format for the client. */
  async state(address: string, now = Date.now()) {
    const player = await this.getOrCreate(address);
    advance(player.mining, now);
    this.persist(player);
    const m = player.mining;
    return {
      pendingBlast: (m.pendingMicroBlast / 1_000_000).toFixed(6),
      mapsCleared: m.mapsCleared,
      chainSync: this.chain.enabled,
      claimRules: { minBlast: MIN_CLAIM_BLAST, cooldownHours: CLAIM_COOLDOWN_HOURS },
      adventure: {
        attemptsToday: player.adventure.day === currentDay(now) ? player.adventure.attemptsToday : 0,
        stages: STAGES.map((s) => ({
          id: s.id,
          name: s.name,
          staminaCost: s.staminaCost,
          minRarity: s.minRarity,
          rewardBlast: (s.rewardMicro / 1_000_000).toFixed(2),
        })),
      },
      blocks: m.blocks.map((b) => ({ hp: b.hp, maxHp: b.maxHp })),
      houses: player.houses.map((h) => ({
        ...h,
        occupants: m.heroes.filter((x) => x.houseId === h.id).length,
      })),
      heroes: m.heroes.map((h) => ({
        id: h.id,
        rarity: h.rarity,
        power: h.power,
        speed: h.speed,
        stamina: Math.floor(h.stamina),
        staminaMax: h.staminaMax,
        mode: h.mode,
        houseId: h.houseId ?? null,
        bombIntervalMs: Math.round(bombIntervalMs(h)),
      })),
    };
  }

  async setMode(address: string, heroId: string, mode: HeroMode) {
    const player = await this.getOrCreate(address);
    try {
      setHeroMode(player.mining, heroId, mode, Date.now());
    } catch (err) {
      if ((err as Error).message === "hero not found") throw new NotFoundException();
      throw new BadRequestException((err as Error).message);
    }
    this.persist(player);
    return this.state(address);
  }

  /** Houses (or unhouses with houseId=null) a hero in one of the player's houses. */
  async setHouse(address: string, heroId: string, houseId: string | null) {
    const player = await this.getOrCreate(address);
    advance(player.mining, Date.now());

    const hero = player.mining.heroes.find((h) => h.id === heroId);
    if (!hero) throw new NotFoundException("hero not found");

    if (houseId === null) {
      hero.houseId = null;
      hero.regenBoostBps = 0;
    } else {
      const house = player.houses.find((h) => h.id === houseId);
      if (!house) throw new NotFoundException("house not found");
      const occupants = player.mining.heroes.filter(
        (h) => h.houseId === houseId && h.id !== heroId
      ).length;
      if (occupants >= house.capacity) throw new BadRequestException("house is full");
      hero.houseId = houseId;
      hero.regenBoostBps = house.regenBoostBps;
    }
    this.persist(player);
    return this.state(address);
  }

  /** Sends a hero to an adventure stage; resolution is 100% server-side. */
  async goAdventure(address: string, heroId: string, stageId: number) {
    const player = await this.getOrCreate(address);
    const now = Date.now();
    advance(player.mining, now);

    const hero = player.mining.heroes.find((h) => h.id === heroId);
    if (!hero) throw new NotFoundException("hero not found");
    const stage = STAGES.find((s) => s.id === stageId);
    if (!stage) throw new NotFoundException("stage not found");

    try {
      // randomInt from node:crypto — randomness not predictable by the client
      const rand = randomInt(1_000_000) / 1_000_000;
      const result = runAdventure(hero, stage, player.adventure, rand, now);
      player.mining.pendingMicroBlast += result.rewardMicro;
      this.persist(player);
      return { ...result, state: await this.state(address, now) };
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }

  /** Debits the pending balance when issuing a voucher. Returns the debited micro-BLAST. */
  async debitPending(address: string): Promise<number> {
    const player = await this.getOrCreate(address);
    advance(player.mining, Date.now());
    const amount = player.mining.pendingMicroBlast;
    player.mining.pendingMicroBlast = 0;
    this.persist(player);
    return amount;
  }

  /** Refunds a debit in case voucher issuance fails. */
  async refundPending(address: string, microBlast: number): Promise<void> {
    const player = await this.getOrCreate(address);
    player.mining.pendingMicroBlast += microBlast;
    this.persist(player);
  }

  totalPendingMicro(): number {
    let total = 0;
    for (const p of this.players.values()) total += p.mining.pendingMicroBlast;
    return total;
  }

  /** Three development heroes with attributes varying per account. */
  private devHeroes(seed: number): EngineHero[] {
    const rand = rng(seed);
    const rarities = [0, 1, 2 + Math.floor(rand() * 2)];
    return rarities.map((rarity, i) => {
      const base = 10 + rarity * 15;
      return {
        id: `dev-${seed}-${i}`,
        rarity,
        power: base + Math.floor(rand() * 10),
        speed: base + Math.floor(rand() * 10),
        staminaMax: (base + Math.floor(rand() * 10)) * 2,
        stamina: (base + Math.floor(rand() * 10)) * 2,
        mode: "rest" as const,
        simulatedTo: Date.now(),
      };
    });
  }
}
