/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SERVER_URL?: string;
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_RPC_URL?: string;
  readonly VITE_VAULT_ADDRESS?: string;
  readonly VITE_TOKEN_ADDRESS?: string;
  readonly VITE_MARKET_ADDRESS?: string;
  readonly VITE_HEROES_ADDRESS?: string;
  readonly VITE_HOUSES_ADDRESS?: string;
  readonly VITE_GACHA_ADDRESS?: string;
  readonly VITE_BLAST_CA?: string;
  readonly VITE_NETWORK_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
