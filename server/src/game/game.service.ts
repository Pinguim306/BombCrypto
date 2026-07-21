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

export interface PlayerState {
  address: string;
  mining: MiningState;
  houses: ChainHouse[];
  /** última sincronização on-chain (ms) */
  syncedAt: number;
}

const CHAIN_SYNC_INTERVAL_MS = 60_000;

/** Casa básica de dev quando não há chain configurada. */
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
      } else {
        const seed = this.seedCounter++;
        player = {
          address,
          mining: newMiningState(
            this.chain.enabled ? [] : this.devHeroes(seed),
            seed * 1000 + Date.now() % 997
          ),
          houses: this.chain.enabled ? [] : [DEV_HOUSE],
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

  /** Mescla heróis/casas on-chain preservando stamina e modo dos já conhecidos. */
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
      // atributos vêm da chain (upgrades refletem); progresso local é preservado
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

  /** Remove abrigo de heróis cuja casa sumiu ou excedeu a capacidade. */
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

  /** Estado avançado até agora, em formato serializável para o cliente. */
  async state(address: string, now = Date.now()) {
    const player = await this.getOrCreate(address);
    advance(player.mining, now);
    this.persist(player);
    const m = player.mining;
    return {
      pendingBlast: (m.pendingMicroBlast / 1_000_000).toFixed(6),
      mapsCleared: m.mapsCleared,
      chainSync: this.chain.enabled,
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
      if ((err as Error).message === "heroi nao encontrado") throw new NotFoundException();
      throw new BadRequestException((err as Error).message);
    }
    this.persist(player);
    return this.state(address);
  }

  /** Abriga (ou desabriga com houseId=null) um herói numa casa do jogador. */
  async setHouse(address: string, heroId: string, houseId: string | null) {
    const player = await this.getOrCreate(address);
    advance(player.mining, Date.now());

    const hero = player.mining.heroes.find((h) => h.id === heroId);
    if (!hero) throw new NotFoundException("heroi nao encontrado");

    if (houseId === null) {
      hero.houseId = null;
      hero.regenBoostBps = 0;
    } else {
      const house = player.houses.find((h) => h.id === houseId);
      if (!house) throw new NotFoundException("casa nao encontrada");
      const occupants = player.mining.heroes.filter(
        (h) => h.houseId === houseId && h.id !== heroId
      ).length;
      if (occupants >= house.capacity) throw new BadRequestException("casa lotada");
      hero.houseId = houseId;
      hero.regenBoostBps = house.regenBoostBps;
    }
    this.persist(player);
    return this.state(address);
  }

  /** Debita o saldo pendente ao emitir um voucher. Retorna micro-BLAST debitados. */
  async debitPending(address: string): Promise<number> {
    const player = await this.getOrCreate(address);
    advance(player.mining, Date.now());
    const amount = player.mining.pendingMicroBlast;
    player.mining.pendingMicroBlast = 0;
    this.persist(player);
    return amount;
  }

  /** Estorna um débito caso a emissão do voucher falhe. */
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

  /** Três heróis de desenvolvimento com atributos variados por conta. */
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
