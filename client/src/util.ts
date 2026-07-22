/** Small shared helpers for the UI scenes. */

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Wallet/RPC errors (viem) carry multi-line, several-hundred-char messages
 * that overflow any fixed text area. Prefer the on-chain revert reason
 * (viem puts it on the line AFTER "...reverted with the following reason:"),
 * falling back to the first line. Capped either way.
 */
export function shortError(err: unknown, max = 90): string {
  const lines = String((err as Error)?.message ?? err ?? "unknown error")
    .split("\n")
    .map((l) => l.trim());
  const at = lines.findIndex((l) => l.endsWith("reason:"));
  const reasonLine = at >= 0 ? lines.slice(at + 1).find(Boolean) : undefined;
  const first = lines.find(Boolean) ?? "unknown error";
  const out = reasonLine ? `${first.replace(/reverted.*$/, "reverted:")} ${reasonLine}` : first;
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}
