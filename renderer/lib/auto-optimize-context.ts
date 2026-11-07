"use client";

/**
 * What the automatic re-plan (lib/auto-optimize.tsx) tells the rest of the
 * renderer. Kept apart from the runner so a component can read it without
 * pulling in Refine: the Overview uses it to hold back its "Bills were added
 * or updated." alert while a re-plan is already on its way, and the lock-in
 * tests render the Overview with no provider at all (the default below says
 * "idle", so nothing changes for them).
 */
import { createContext, useContext } from "react";

export interface AutoOptimizeState {
  /** An input was written; the debounced run has not started yet. */
  pending: boolean;
  /** A run is fetching, planning or writing right now. */
  running: boolean;
  /** `pending || running` — a re-plan will land shortly. */
  busy: boolean;
}

export const IDLE_AUTO_OPTIMIZE: AutoOptimizeState = { pending: false, running: false, busy: false };

export const AutoOptimizeContext = createContext<AutoOptimizeState>(IDLE_AUTO_OPTIMIZE);

/** The runner's state; idle outside an `AutoOptimizeProvider`. */
export function useAutoOptimize(): AutoOptimizeState {
  return useContext(AutoOptimizeContext);
}
