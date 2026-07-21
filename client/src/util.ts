/** Small shared helpers for the UI scenes. */

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Wallet/RPC errors (viem) carry multi-line, several-hundred-char messages
 * that overflow any fixed text area. Keep the first line, capped.
 */
export function shortError(err: unknown, max = 90): string {
  const first = String((err as Error)?.message ?? err ?? "unknown error").split("\n")[0].trim();
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}
