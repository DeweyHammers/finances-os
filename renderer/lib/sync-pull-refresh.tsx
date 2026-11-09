"use client";

/**
 * SyncPullRefresh — reloads the page's data after a sync pulled another
 * device's changes (Nov 9 2026, for the phone app; plans/phone-app.md).
 *
 * Why it exists: a pull changes the database UNDER an open page. Until the
 * phone, this PC was the only writer, so every change to the data went
 * through Refine and Refine reloaded what it touched. A row the phone wrote
 * arrives through the main process's sync instead, and no query knows. In the
 * phone spike's live run the row was in this PC's database within a minute
 * while the open Payees list kept showing the old one — the user had to leave
 * the page and come back.
 *
 * How: the sync status (`GET /api/sync`, read by the one poller in
 * lib/use-connection-status.ts) carries `remoteChanges`, a counter the main
 * process raises only when a sync brought in rows this PC did not write
 * (main/sync.ts → dataVersion). When it rises, every ACTIVE Refine query is
 * invalidated and refetches; inactive ones refetch when their page opens.
 * This PC's own saves never raise it, so nothing here fires after a save.
 *
 * The first value seen is only remembered (the page loaded its data after
 * it), as is a LOWER one (the API restarted and counts from zero again).
 *
 * An open edit form: the edit modals re-hydrate from their record's query,
 * and React Query keeps the same object when a refetch returns equal data —
 * so a refetch only resets a form whose own record was changed on the other
 * device, which is the right thing to show.
 *
 * Renders nothing. Mounted once in app/providers.tsx, inside Refine and
 * SyncStatusProvider.
 */
import { useEffect, useRef } from "react";
import { useInvalidate } from "@refinedev/core";
import { useConnectionStatus } from "./use-connection-status";

export function SyncPullRefresh(): null {
  const { status } = useConnectionStatus();
  const invalidate = useInvalidate();
  // Refine hands back a new function on every render; keep the latest in a
  // ref so the effect below depends on the counter alone.
  const invalidateRef = useRef(invalidate);
  invalidateRef.current = invalidate;

  const remoteChanges = typeof status?.remoteChanges === "number" ? status.remoteChanges : null;
  const seen = useRef<number | null>(null);

  useEffect(() => {
    if (remoteChanges === null) return; // no answer from the server yet
    const before = seen.current;
    seen.current = remoteChanges;
    if (before === null || remoteChanges <= before) return;
    void invalidateRef.current({ invalidates: ["all"] });
  }, [remoteChanges]);

  return null;
}
