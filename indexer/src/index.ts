/**
 * Indexer de eventos do MinerBlast.
 *
 * Faz polling incremental de eventos dos contratos e grava num SQLite local,
 * que o servidor de jogo pode consultar (reconciliação de claims, histórico
 * de vendas, propriedade de NFTs) sem varrer a chain a cada request.
 *
 * Uso: RPC_URL=... VAULT_ADDRESS=... HEROES_ADDRESS=... MARKET_ADDRESS=... \
 *      DATABASE_PATH=./indexer.db node dist/index.js
 */
import { Contract, JsonRpcProvider, EventLog } from "ethers";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DatabaseSync } = require("node:sqlite");

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 15_000);
const BATCH_BLOCKS = Number(process.env.BATCH_BLOCKS ?? 5_000);

const VAULT_ABI = [
  "event RewardClaimed(address indexed player, uint256 amount, uint256 nonce)",
];
const HEROES_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
];
const MARKET_ABI = [
  "event Sold(uint256 indexed listingId, address indexed buyer, uint256 price, uint256 fee)",
];

interface Source {
  name: string;
  contract: Contract;
  eventName: string;
  toRow: (log: EventLog) => Record<string, string | number>;
}

function openDb() {
  const db = new DatabaseSync(process.env.DATABASE_PATH ?? "./indexer.db");
  db.exec(`
    CREATE TABLE IF NOT EXISTS cursor (source TEXT PRIMARY KEY, last_block INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS events (
      source TEXT NOT NULL,
      block INTEGER NOT NULL,
      tx_hash TEXT NOT NULL,
      log_index INTEGER NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (tx_hash, log_index)
    );
  `);
  return db;
}

async function main() {
  const rpc = process.env.RPC_URL;
  if (!rpc) {
    console.error("RPC_URL e obrigatorio");
    process.exit(1);
  }
  const provider = new JsonRpcProvider(rpc);
  const db = openDb();

  const sources: Source[] = [];
  if (process.env.VAULT_ADDRESS) {
    sources.push({
      name: "vault.RewardClaimed",
      contract: new Contract(process.env.VAULT_ADDRESS, VAULT_ABI, provider),
      eventName: "RewardClaimed",
      toRow: (log) => ({
        player: String(log.args[0]),
        amount: String(log.args[1]),
        nonce: String(log.args[2]),
      }),
    });
  }
  if (process.env.HEROES_ADDRESS) {
    sources.push({
      name: "heroes.Transfer",
      contract: new Contract(process.env.HEROES_ADDRESS, HEROES_ABI, provider),
      eventName: "Transfer",
      toRow: (log) => ({
        from: String(log.args[0]),
        to: String(log.args[1]),
        tokenId: String(log.args[2]),
      }),
    });
  }
  if (process.env.MARKET_ADDRESS) {
    sources.push({
      name: "market.Sold",
      contract: new Contract(process.env.MARKET_ADDRESS, MARKET_ABI, provider),
      eventName: "Sold",
      toRow: (log) => ({
        listingId: String(log.args[0]),
        buyer: String(log.args[1]),
        price: String(log.args[2]),
        fee: String(log.args[3]),
      }),
    });
  }
  if (sources.length === 0) {
    console.error("nenhum endereco de contrato configurado");
    process.exit(1);
  }

  const startBlock = Number(process.env.START_BLOCK ?? 0);
  const insert = db.prepare(
    "INSERT OR IGNORE INTO events (source, block, tx_hash, log_index, data) VALUES (?, ?, ?, ?, ?)"
  );
  const getCursor = db.prepare("SELECT last_block AS b FROM cursor WHERE source = ?");
  const setCursor = db.prepare(
    `INSERT INTO cursor (source, last_block) VALUES (?, ?)
     ON CONFLICT(source) DO UPDATE SET last_block = excluded.last_block`
  );

  console.log(`indexando ${sources.length} fontes a cada ${POLL_INTERVAL_MS}ms`);

  // loop de polling incremental com cursor por fonte
  // (simples e resiliente; reorgs profundos são tratados na Fase 5 com confirmações)
  for (;;) {
    const head = await provider.getBlockNumber();
    for (const src of sources) {
      const row = getCursor.get(src.name) as { b: number } | undefined;
      let from = row ? row.b + 1 : startBlock;
      while (from <= head) {
        const to = Math.min(from + BATCH_BLOCKS - 1, head);
        const logs = await src.contract.queryFilter(src.eventName, from, to);
        for (const log of logs) {
          const ev = log as EventLog;
          insert.run(src.name, ev.blockNumber, ev.transactionHash, ev.index, JSON.stringify(src.toRow(ev)));
        }
        setCursor.run(src.name, to);
        if (logs.length > 0) console.log(`${src.name}: +${logs.length} eventos ate o bloco ${to}`);
        from = to + 1;
      }
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
