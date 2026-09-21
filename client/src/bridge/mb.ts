import {
  api,
  hasToken,
  clearToken,
  tokenAddress,
  type GameStateDto,
  type AdventureResultDto,
  type DailyStatusDto,
  type VoucherDto,
} from "../net/api";
import {
  connectWallet,
  signIn as walletSignIn,
  reconnectSilently,
  connectedAddress,
  claimVoucher,
  MOBILE_WALLET_ENABLED,
  type WalletKind,
} from "../web3/wallet";
import { waitForClaim, type ClaimReceipt } from "../web3/tx";
import { SERVER_URL, CHAIN_ID, RPC_URL, EXPLORER_URL, VAULT_ADDRESS } from "../config";
import { mapError, VOUCHER_CHAIN_MISMATCH, NO_SUCH_METHOD_PREFIX, type Envelope } from "./envelope";

/*
 * `window.mb` — the host-page bridge the Godot client talks to
 * (docs/godot-v2-design.md, Appendix A). Everything that crosses to GDScript
 * is a primitive or a JSON string, because JavaScriptBridge turns any object
 * argument into `undefined`; and every async call goes through `invoke`, whose
 * callback fires exactly once, asynchronously, and never throws into Godot.
 */

export type MbMethod =
  | "connect" | "signIn" | "reconnect" | "disconnect"
  | "apiState" | "apiSetMode" | "apiSetTeamMode" | "apiSetHouse"
  | "apiAdventure" | "apiDailyStatus" | "apiVoucher" | "claim";

const METHODS: ReadonlySet<string> = new Set<MbMethod>([
  "connect", "signIn", "reconnect", "disconnect",
  "apiState", "apiSetMode", "apiSetTeamMode", "apiSetHouse",
  "apiAdventure", "apiDailyStatus", "apiVoucher", "claim",
]);

export interface MbConfig {
  serverUrl: string;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  vaultAddress: string;
  mobileWalletEnabled: boolean;
  networkName: string;
  mock: boolean;
  reducedMotion: boolean;
  buildId: string;
}

export interface MbSession {
  hasToken: boolean;
  tokenAddress: string | null;
  walletAddress: string | null;
  walletKind: WalletKind | null;
  loggedIn: boolean;
}

export type SessionReason = "login" | "expired" | "disconnect" | "reconnect";
export type ClaimStep = "voucher" | "wallet" | "sent" | "receipt";

/** Host → Godot pushes, delivered to the single listener as JSON strings. */
export type MbEvent =
  | { type: "session"; loggedIn: boolean; address: string | null; reason: SessionReason }
  | { type: "wallet"; address: string }
  | { type: "nav"; target: string }
  | { type: "visibility"; hidden: boolean }
  | { type: "online"; online: boolean }
  | { type: "claim"; step: ClaimStep; hash?: string };

export interface MbBridge {
  readonly version: 1;

  // ---- sync ----
  configJson(): string;
  sessionJson(): string;

  // ---- the one async entry point used by GDScript ----
  invoke(reqId: string, method: MbMethod, argsJson: string, cb: (reqId: string, envelopeJson: string) => void): void;

  // ---- async methods (dispatched by invoke; also usable by the page) ----
  connect(a: { kind: WalletKind }): Promise<{ address: string }>;
  signIn(a: {}): Promise<{ address: string }>;
  reconnect(a: {}): Promise<{ walletAddress: string | null; tokenAddress: string | null; loggedIn: boolean; mismatch: boolean }>;
  disconnect(a: {}): Promise<{}>;
  apiState(a: {}): Promise<GameStateDto>;
  apiSetMode(a: { heroId: string; mode: "work" | "rest" }): Promise<GameStateDto>;
  apiSetTeamMode(a: { mode: "work" | "rest" }): Promise<GameStateDto & { changed: number }>;
  apiSetHouse(a: { heroId: string; houseId: string }): Promise<GameStateDto>;
  apiAdventure(a: { heroId: string; stageId: number }): Promise<AdventureResultDto>;
  apiDailyStatus(a: {}): Promise<DailyStatusDto>;
  apiVoucher(a: {}): Promise<VoucherDto>;
  claim(a: { waitForReceipt: boolean }): Promise<{ hash: string; amountWei: string; receipt: ClaimReceipt | "not_awaited" }>;

  // ---- Godot → host, sync void ----
  ready(): void;
  nav(target: string): void;
  openExplorer(hash: string): void;
  setListener(cb: (jsonEvent: string) => void): void;
}

declare global {
  interface Window {
    mb: MbBridge;
    /** Playwright hook: merged over `window.mb` right after install (play2.ts). */
    __mbTestOverrides?: Partial<MbBridge>;
  }
}

/** Page-side hooks for the Godot → host calls that touch the DOM. */
export interface BridgeHost {
  /** Godot's main scene is up: hide the loader, show the connect overlay if needed. */
  onReady(): void;
  /** Godot asks for the login UI (`nav("login")`). */
  showLogin(): void;
}

export interface BridgeOptions {
  mock: boolean;
  networkName: string;
  /** Mutable on purpose: play2.ts fills it in once the manifest is fetched. */
  buildId: string;
  host: BridgeHost;
}

function walletKindOf(walletAddress: string | null): WalletKind | null {
  if (!walletAddress) return null;
  // wallet.ts keeps the active provider kind private, but persists it here
  // on connect and clears it on disconnect — the same source of truth.
  try {
    return localStorage.getItem("mb.provider") === "walletconnect" ? "walletconnect" : "injected";
  } catch {
    return "injected";
  }
}

function sessionState(): MbSession {
  const token = tokenAddress();
  const wallet = connectedAddress();
  // A locked wallet (null address) with a live JWT is a valid view-only
  // session; a wallet on a different account than the JWT's is not.
  const loggedIn = hasToken() && (wallet == null || (token != null && wallet.toLowerCase() === token.toLowerCase()));
  return { hasToken: hasToken(), tokenAddress: token, walletAddress: wallet, walletKind: walletKindOf(wallet), loggedIn };
}

export function createBridge(opts: BridgeOptions): MbBridge {
  let listener: ((jsonEvent: string) => void) | null = null;
  let lastSession: Extract<MbEvent, { type: "session" }> | null = null;

  const emit = (ev: MbEvent) => {
    if (ev.type === "session") lastSession = ev;
    if (!listener) return;
    try {
      listener(JSON.stringify(ev));
    } catch (err) {
      // a throw inside Godot's callback must never unwind into the wallet flow
      console.warn("[mb] listener threw", err);
    }
  };

  const sessionEvent = (reason: SessionReason): Extract<MbEvent, { type: "session" }> => {
    const s = sessionState();
    return { type: "session", loggedIn: s.loggedIn, address: s.tokenAddress ?? s.walletAddress, reason };
  };

  // Browser/page events Godot cannot observe from inside the canvas.
  window.addEventListener("mb-wallet", (e) => emit({ type: "wallet", address: String((e as CustomEvent<string>).detail) }));
  window.addEventListener("mb-nav", (e) => emit({ type: "nav", target: String((e as CustomEvent<string>).detail) }));
  document.addEventListener("visibilitychange", () => emit({ type: "visibility", hidden: document.hidden }));
  window.addEventListener("online", () => emit({ type: "online", online: true }));
  window.addEventListener("offline", () => emit({ type: "online", online: false }));

  const bridge: MbBridge = {
    version: 1,

    configJson() {
      const cfg: MbConfig = {
        serverUrl: SERVER_URL,
        chainId: CHAIN_ID,
        rpcUrl: RPC_URL,
        explorerUrl: EXPLORER_URL,
        vaultAddress: VAULT_ADDRESS,
        mobileWalletEnabled: MOBILE_WALLET_ENABLED,
        networkName: opts.networkName,
        mock: opts.mock,
        reducedMotion: typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches,
        buildId: opts.buildId,
      };
      return JSON.stringify(cfg);
    },

    sessionJson() {
      return JSON.stringify(sessionState());
    },

    invoke(reqId, method, argsJson, cb) {
      // Dispatch through window.mb (not `bridge`) so test overrides merged
      // over the installed object are honoured, exactly as the contract shows.
      Promise.resolve()
        .then(() => {
          const f = (window.mb as any)[method];
          if (typeof f !== "function" || !METHODS.has(method)) throw new Error(`${NO_SUCH_METHOD_PREFIX}${method}`);
          return f.call(window.mb, JSON.parse(argsJson || "{}"));
        })
        .then(
          (data) => cb(reqId, JSON.stringify({ ok: true, data: data ?? null } satisfies Envelope<unknown>)),
          (e) => {
            const m = mapError(e);
            if (m.code === "session_expired") emit({ type: "session", loggedIn: false, address: null, reason: "expired" });
            cb(reqId, JSON.stringify({ ok: false, ...m } satisfies Envelope<never>));
          }
        );
    },

    async connect({ kind }) {
      const address = await connectWallet(kind);
      return { address };
    },

    async signIn() {
      await walletSignIn();
      const address = tokenAddress() ?? connectedAddress() ?? "";
      emit({ type: "session", loggedIn: true, address, reason: "login" });
      return { address };
    },

    async reconnect() {
      let walletAddress: string | null = null;
      let mismatch = false;
      try {
        if (hasToken()) {
          walletAddress = await reconnectSilently();
          const sessionAddr = tokenAddress();
          // ConnectScene rule: never enter the game with a wallet on another
          // account than the JWT's — purchases would go out from one account
          // while the game shows another one's heroes.
          if (walletAddress && sessionAddr && walletAddress.toLowerCase() !== sessionAddr.toLowerCase()) {
            clearToken();
            mismatch = true;
          }
        }
      } catch {
        /* reconnect never throws: a failed re-attach is simply "not logged in" */
      }
      const s = sessionState();
      emit(sessionEvent("reconnect"));
      return { walletAddress, tokenAddress: s.tokenAddress, loggedIn: s.loggedIn, mismatch };
    },

    async disconnect() {
      // Godot hears about it before the page handler tears everything down
      // and reloads (main.ts semantics, duplicated in play2.ts).
      emit({ type: "session", loggedIn: false, address: null, reason: "disconnect" });
      window.dispatchEvent(new Event("mb-disconnect"));
      return {};
    },

    apiState: () => api.state(),
    apiSetMode: ({ heroId, mode }) => api.setMode(heroId, mode),
    apiSetTeamMode: ({ mode }) => api.setTeamMode(mode),
    apiSetHouse: ({ heroId, houseId }) => api.setHouse(heroId, houseId === "" ? null : houseId),
    apiAdventure: ({ heroId, stageId }) => api.adventure(heroId, Number(stageId)),
    apiDailyStatus: () => api.dailyStatus(),
    apiVoucher: () => api.voucher(),

    async claim({ waitForReceipt }) {
      emit({ type: "claim", step: "voucher" });
      const voucher = await window.mb.apiVoucher({});
      // The vault signature is chain-bound; a voucher for another chain would
      // only burn gas, so refuse before the wallet ever opens.
      if (Number(voucher.chainId) !== CHAIN_ID) throw new Error(VOUCHER_CHAIN_MISMATCH);
      emit({ type: "claim", step: "wallet" });
      const hash = await claimVoucher(voucher);
      emit({ type: "claim", step: "sent", hash });
      let receipt: ClaimReceipt | "not_awaited" = "not_awaited";
      if (waitForReceipt) {
        receipt = await waitForClaim(hash);
        emit({ type: "claim", step: "receipt", hash });
      }
      return { hash, amountWei: voucher.amount, receipt };
    },

    ready() {
      opts.host.onReady();
    },

    nav(target) {
      if (target === "login") opts.host.showLogin();
      else if (target !== "play" && target !== "mining") location.href = "/";
    },

    openExplorer(hash) {
      // only meaningful from an input callback: window.open needs user activation
      window.open(`${EXPLORER_URL}/tx/${hash}`, "_blank", "noopener");
    },

    setListener(cb) {
      listener = cb;
      // Replay the current session so a login (or reconnect) that finished
      // before Godot booted is not missed; before any event was emitted the
      // snapshot of the stored JWT is the best answer.
      emit(lastSession ?? sessionEvent("reconnect"));
    },
  };

  return bridge;
}
