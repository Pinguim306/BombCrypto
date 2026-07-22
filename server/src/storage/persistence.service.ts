import { Injectable, Logger, OnApplicationShutdown } from "@nestjs/common";
// node:sqlite is built into Node 22+ (experimental, stable enough for dev;
// in production Phase 5 evaluates migrating to PostgreSQL — the interface already isolates this)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DatabaseSync } = require("node:sqlite");

export interface VoucherRecord {
  player: string;
  nonce: string;
  amountWei: string;
  deadline: number;
  signature: string;
  claimed: number; // 0/1
  createdAt: number;
}

/**
 * SQLite persistence (local file). Stores per-player mining state as JSON,
 * the issued vouchers, and the local dev nonces.
 */
@Injectable()
export class PersistenceService implements OnApplicationShutdown {
  private readonly logger = new Logger(PersistenceService.name);
  private db: InstanceType<typeof DatabaseSync>;

  constructor() {
    const path = process.env.DATABASE_PATH ?? "./minerblast.db";
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS players (
        address TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS vouchers (
        player TEXT NOT NULL,
        nonce TEXT NOT NULL,
        amount_wei TEXT NOT NULL,
        deadline INTEGER NOT NULL,
        signature TEXT NOT NULL,
        claimed INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (player, nonce)
      );
      CREATE TABLE IF NOT EXISTS local_nonces (
        player TEXT PRIMARY KEY,
        next_nonce TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS referral_aliases (
        alias_lower TEXT PRIMARY KEY,   -- lookup key (lowercased)
        alias TEXT NOT NULL,            -- display casing
        address TEXT NOT NULL UNIQUE,   -- one alias per address
        updated_at INTEGER NOT NULL
      );
    `);
    this.logger.log(`SQLite opened at ${path}`);
  }

  loadPlayerState(address: string): string | null {
    const row = this.db
      .prepare("SELECT state FROM players WHERE address = ?")
      .get(address.toLowerCase()) as { state: string } | undefined;
    return row?.state ?? null;
  }

  savePlayerState(address: string, stateJson: string): void {
    this.db
      .prepare(
        `INSERT INTO players (address, state, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(address) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`
      )
      .run(address.toLowerCase(), stateJson, Date.now());
  }

  /** All stored player states (for leaderboards). */
  allPlayerStates(): { address: string; state: string }[] {
    return this.db
      .prepare("SELECT address, state FROM players")
      .all() as { address: string; state: string }[];
  }

  playerCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM players").get() as { n: number };
    return row.n;
  }

  // ---- referral aliases (off-chain vanity handles) ----

  /** Resolves a referral alias to the owner's address, or null. */
  addressForAlias(alias: string): string | null {
    const row = this.db
      .prepare("SELECT address FROM referral_aliases WHERE alias_lower = ?")
      .get(alias.toLowerCase()) as { address: string } | undefined;
    return row?.address ?? null;
  }

  /** The alias currently owned by an address (display casing), or null. */
  aliasForAddress(address: string): string | null {
    const row = this.db
      .prepare("SELECT alias FROM referral_aliases WHERE address = ?")
      .get(address.toLowerCase()) as { alias: string } | undefined;
    return row?.alias ?? null;
  }

  /**
   * Claims/updates an alias for an address. Returns "ok", "taken" (alias owned
   * by a different address), or "exists" (no change). One alias per address:
   * re-claiming replaces the caller's previous alias.
   */
  setAlias(address: string, alias: string): "ok" | "taken" {
    const addr = address.toLowerCase();
    const owner = this.addressForAlias(alias);
    if (owner && owner !== addr) return "taken";
    // free the caller's previous alias, then set the new one
    this.db.prepare("DELETE FROM referral_aliases WHERE address = ?").run(addr);
    this.db
      .prepare(
        `INSERT INTO referral_aliases (alias_lower, alias, address, updated_at) VALUES (?, ?, ?, ?)`
      )
      .run(alias.toLowerCase(), alias, addr, Date.now());
    return "ok";
  }

  saveVoucher(v: VoucherRecord): void {
    this.db
      .prepare(
        `INSERT INTO vouchers (player, nonce, amount_wei, deadline, signature, claimed, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(v.player.toLowerCase(), v.nonce, v.amountWei, v.deadline, v.signature, v.claimed, v.createdAt);
  }

  unclaimedVoucher(player: string): VoucherRecord | null {
    const row = this.db
      .prepare(
        `SELECT player, nonce, amount_wei AS amountWei, deadline, signature, claimed, created_at AS createdAt
         FROM vouchers WHERE player = ? AND claimed = 0 ORDER BY created_at DESC LIMIT 1`
      )
      .get(player.toLowerCase()) as VoucherRecord | undefined;
    return row ?? null;
  }

  markClaimedBelow(player: string, nonceExclusive: bigint): void {
    // nonces are sequential: everything below the current on-chain nonce was already claimed
    const rows = this.db
      .prepare("SELECT nonce FROM vouchers WHERE player = ? AND claimed = 0")
      .all(player.toLowerCase()) as { nonce: string }[];
    const stmt = this.db.prepare("UPDATE vouchers SET claimed = 1 WHERE player = ? AND nonce = ?");
    for (const { nonce } of rows) {
      if (BigInt(nonce) < nonceExclusive) stmt.run(player.toLowerCase(), nonce);
    }
  }

  /** Timestamp (ms) of the player's most recent voucher, or null. */
  lastVoucherAt(player: string): number | null {
    const row = this.db
      .prepare("SELECT MAX(created_at) AS t FROM vouchers WHERE player = ?")
      .get(player.toLowerCase()) as { t: number | null } | undefined;
    return row?.t ?? null;
  }

  deleteVoucher(player: string, nonce: string): void {
    this.db.prepare("DELETE FROM vouchers WHERE player = ? AND nonce = ?").run(player.toLowerCase(), nonce);
  }

  voucherStats(): { issued: number; claimed: number; issuedWei: string } {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS issued, COALESCE(SUM(claimed), 0) AS claimed FROM vouchers`
      )
      .get() as { issued: number; claimed: number };
    const amounts = this.db.prepare("SELECT amount_wei AS w FROM vouchers").all() as { w: string }[];
    const total = amounts.reduce((s, r) => s + BigInt(r.w), 0n);
    return { issued: row.issued, claimed: row.claimed, issuedWei: total.toString() };
  }

  localNonce(player: string): bigint {
    const row = this.db
      .prepare("SELECT next_nonce AS n FROM local_nonces WHERE player = ?")
      .get(player.toLowerCase()) as { n: string } | undefined;
    return row ? BigInt(row.n) : 0n;
  }

  setLocalNonce(player: string, next: bigint): void {
    this.db
      .prepare(
        `INSERT INTO local_nonces (player, next_nonce) VALUES (?, ?)
         ON CONFLICT(player) DO UPDATE SET next_nonce = excluded.next_nonce`
      )
      .run(player.toLowerCase(), next.toString());
  }

  onApplicationShutdown(): void {
    this.db.close();
  }
}
