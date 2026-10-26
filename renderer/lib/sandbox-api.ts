/**
 * Renderer side of Sandbox mode (main/sandbox.ts). These are the only calls
 * that don't go through Refine: the sandbox isn't a resource, it's a switch
 * on which database file every resource reads from.
 */
import { API_URL } from "./api-url";

export interface SandboxStatus {
  active: boolean;
  /** ISO timestamp of when the sandbox was entered; null when inactive. */
  enteredAt: string | null;
  /** Transactions recorded since entering — what Discard would throw away. */
  transactionsAdded: number;
}

export type SandboxAction = "enter" | "discard" | "keep";

async function parse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as any)?.error || `${res.status} ${res.statusText}`);
  }
  return body as T;
}

export async function fetchSandboxStatus(): Promise<SandboxStatus> {
  return parse<SandboxStatus>(await fetch(`${API_URL}/sandbox`));
}

export async function runSandboxAction(action: SandboxAction): Promise<SandboxStatus> {
  return parse<SandboxStatus>(
    await fetch(`${API_URL}/sandbox/${action}`, { method: "POST" }),
  );
}
