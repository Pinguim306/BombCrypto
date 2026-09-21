import { UserRejectedRequestError } from "viem";

/**
 * Error classes the Godot side can branch on. Only `session_expired` (and
 * `user_rejected`) drive behaviour there; the rest are informational so the
 * status bar can pick a tone. The mapping rules are the bridge contract
 * (docs/godot-v2-design.md, Appendix A) — keep both in sync.
 */
export type MbErrorCode =
  | "session_expired"
  | "user_rejected"
  | "no_wallet"
  | "wallet_not_connected"
  | "wrong_chain"
  | "mobile_unavailable"
  | "network"
  | "http"
  | "voucher_chain_mismatch"
  | "receipt_timeout"
  | "reverted"
  | "unknown";

/** What every `invoke` callback receives, as a JSON string. */
export type Envelope<T> = { ok: true; data: T } | { ok: false; error: string; code: MbErrorCode };

export interface MappedError {
  error: string;
  code: MbErrorCode;
}

/** Error strings thrown by the host modules that the mapping relies on. */
export const VOUCHER_CHAIN_MISMATCH = "voucher chain mismatch";
export const NO_SUCH_METHOD_PREFIX = "no such bridge method: ";
const RECEIPT_TIMEOUT_TEXT = "taking long to confirm";
const RECEIPT_REVERTED_TEXT = "reverted on-chain";

/**
 * First line of the most specific message, capped so Godot's status bar
 * never has to wrap a viem stack dump. viem errors carry `shortMessage`;
 * everything else falls back to `message`, then to String(e).
 */
export function errorText(e: unknown): string {
  const any = e as { shortMessage?: unknown; message?: unknown } | null;
  const raw =
    typeof any?.shortMessage === "string" ? any.shortMessage
    : typeof any?.message === "string" ? any.message
    : String(e);
  return raw.split("\n")[0].slice(0, 120);
}

/**
 * viem wraps a wallet rejection several `cause` levels deep (e.g.
 * TransactionExecutionError → UserRejectedRequestError), and raw EIP-1193
 * providers throw `{ code: 4001 }` — so walk the chain instead of looking at
 * the top error only.
 */
function isUserRejected(e: unknown): boolean {
  let cur: any = e;
  for (let depth = 0; cur && depth < 8; depth++, cur = cur.cause) {
    if (cur instanceof UserRejectedRequestError) return true;
    if (cur.name === "UserRejectedRequestError" || cur.code === 4001) return true;
  }
  return false;
}

/** Server messages arrive as bare `Error`s from api.ts; viem/DOM errors are subclasses. */
function isPlainError(e: unknown): boolean {
  return e instanceof Error && Object.getPrototypeOf(e) === Error.prototype;
}

export function mapError(e: unknown): MappedError {
  const error = errorText(e);
  return { error, code: classify(e, error) };
}

function classify(e: unknown, text: string): MbErrorCode {
  if (text === "session expired") return "session_expired";
  if (isUserRejected(e)) return "user_rejected";
  if (text.startsWith("No wallet found")) return "no_wallet";
  if (text === "wallet not connected") return "wallet_not_connected";
  if (text.includes("Robinhood Chain")) return "wrong_chain";
  if (text === "Mobile wallet is not configured yet.") return "mobile_unavailable";
  if (e instanceof TypeError && /Failed to fetch|NetworkError|Load failed/.test(text)) return "network";
  if (text === VOUCHER_CHAIN_MISMATCH) return "voucher_chain_mismatch";
  if (text.includes(RECEIPT_TIMEOUT_TEXT)) return "receipt_timeout";
  if (text.includes(RECEIPT_REVERTED_TEXT)) return "reverted";
  if (text.startsWith(NO_SUCH_METHOD_PREFIX)) return "unknown";
  // api.ts throws `new Error(body.message ?? `HTTP ${status}`)`: any bare
  // Error left at this point is a server message passing through verbatim.
  if (/^HTTP \d+$/.test(text) || isPlainError(e)) return "http";
  return "unknown";
}
