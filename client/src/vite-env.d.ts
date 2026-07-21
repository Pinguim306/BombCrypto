/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SERVER_URL?: string;
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_VAULT_ADDRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
