/**
 * Many writes as ONE request and ONE transaction — `POST /api/batch`
 * (main/api-server.ts → DataStore.batch). The database commits once, so the
 * sync has a handful of WAL frames to push afterwards instead of a few per
 * row, and nothing can sync in the middle of the run.
 *
 * Used where the app rewrites many rows at once — Overview's Optimize sends
 * its whole 36-month BillSplit plan this way. Until Nov 6 2026 every row was
 * its own Refine mutation (one HTTP request, one commit each, ~2000 for a full
 * re-plan): the background sync kept starting mid-run, each sync holding the
 * database lock for its round trips to the cloud, which froze the app and
 * ended in a sync conflict. Everything else still goes through Refine.
 *
 * This bypasses Refine's data provider, so a caller must do what a mutation
 * hook would have done afterwards: `notifyLocalWrite()` for the sync
 * indicator and `invalidate()` for the resources it touched.
 */
import { API_URL } from "./api-url";

export type BatchOperation =
  | { op: "create"; resource: string; values: Record<string, unknown> }
  | { op: "update"; resource: string; id: string; values: Record<string, unknown> }
  | { op: "delete"; resource: string; id: string };

/** The stored row for a create / update, `{ success: true }` for a delete — one per operation, in order. */
export type BatchResult = Record<string, unknown>;

export async function applyBatch(operations: readonly BatchOperation[]): Promise<BatchResult[]> {
  const res = await fetch(`${API_URL}/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operations }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as any)?.error || `${res.status} ${res.statusText}`);
  }
  return ((body as any)?.results ?? []) as BatchResult[];
}
