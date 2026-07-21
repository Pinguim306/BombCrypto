import { Injectable, Logger } from "@nestjs/common";
import { Contract, JsonRpcProvider } from "ethers";
import { EngineHero } from "./engine";

const HEROES_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function attributesOf(uint256 tokenId) view returns (tuple(uint8 rarity, uint8 level, uint16 power, uint16 speed, uint16 stamina, uint8 blastRange, uint8 bombCount, uint16 abilities))",
];

const HOUSES_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function attributesOf(uint256 tokenId) view returns (tuple(uint8 rarity, uint8 capacity, uint16 regenBoostBps))",
];

export interface ChainHouse {
  id: string;
  rarity: number;
  capacity: number;
  regenBoostBps: number;
}

/**
 * Reads the player's NFTs directly from the contracts (via Enumerable).
 * Active only with RPC_URL + HEROES_ADDRESS configured; without them the game
 * runs in dev mode (development heroes, no on-chain houses).
 * Phase 4 replaces the polling with an event indexer.
 */
@Injectable()
export class ChainService {
  private readonly logger = new Logger(ChainService.name);
  private provider?: JsonRpcProvider;
  private heroes?: Contract;
  private houses?: Contract;

  constructor() {
    if (process.env.RPC_URL && process.env.HEROES_ADDRESS) {
      this.provider = new JsonRpcProvider(process.env.RPC_URL);
      this.heroes = new Contract(process.env.HEROES_ADDRESS, HEROES_ABI, this.provider);
      if (process.env.HOUSES_ADDRESS) {
        this.houses = new Contract(process.env.HOUSES_ADDRESS, HOUSES_ABI, this.provider);
      }
      this.logger.log("On-chain hero sync enabled");
    } else {
      this.logger.warn("RPC_URL/HEROES_ADDRESS missing — dev mode (local heroes)");
    }
  }

  get enabled(): boolean {
    return this.heroes !== undefined;
  }

  /** The player's on-chain heroes, converted to the engine format. */
  async heroesOf(owner: string, now: number): Promise<EngineHero[]> {
    if (!this.heroes) return [];
    const balance = Number(await this.heroes.balanceOf(owner));
    const result: EngineHero[] = [];
    for (let i = 0; i < balance; i++) {
      const tokenId = (await this.heroes.tokenOfOwnerByIndex(owner, i)) as bigint;
      const a = await this.heroes.attributesOf(tokenId);
      const levelBonus = 1 + (Number(a.level) - 1) * 0.1; // +10% attributes per level
      result.push({
        id: `chain-${tokenId}`,
        rarity: Number(a.rarity),
        power: Math.round(Number(a.power) * levelBonus),
        speed: Math.round(Number(a.speed) * levelBonus),
        staminaMax: Math.round(Number(a.stamina) * levelBonus),
        stamina: Math.round(Number(a.stamina) * levelBonus),
        mode: "rest",
        simulatedTo: now,
      });
    }
    return result;
  }

  async housesOf(owner: string): Promise<ChainHouse[]> {
    if (!this.houses) return [];
    const balance = Number(await this.houses.balanceOf(owner));
    const result: ChainHouse[] = [];
    for (let i = 0; i < balance; i++) {
      const tokenId = (await this.houses.tokenOfOwnerByIndex(owner, i)) as bigint;
      const a = await this.houses.attributesOf(tokenId);
      result.push({
        id: `house-${tokenId}`,
        rarity: Number(a.rarity),
        capacity: Number(a.capacity),
        regenBoostBps: Number(a.regenBoostBps),
      });
    }
    return result;
  }
}
