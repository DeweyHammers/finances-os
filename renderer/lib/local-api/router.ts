/**
 * router.ts — the Android app's answer to every URL the renderer would send
 * to main/api-server.ts, served in-process (Phase C of
 * plans/phone-app-and-sync.md).
 *
 * It is deliberately shaped like the Express API — method + URL + body in,
 * status + headers + JSON body out — so that:
 *   - @refinedev/simple-rest keeps building the exact same URLs and query
 *     strings it sends over HTTP today (`?accountId=…&_sort=date&_order=desc`),
 *     and `DataStore.list` receives the same ListQuery objects;
 *   - lib/meta-api.ts, sandbox-api.ts and sync-api.ts keep their fetch-shaped
 *     code and only swap `fetch` for `apiFetch` (index.ts);
 *   - the route tests' scenarios run against it unchanged (router.test.ts).
 *
 * Status codes mirror api-server.ts: 404 for an unknown resource or a missing
 * row on GET, 500 for what the data layer rejects (bad values, a missing row
 * on PATCH/DELETE, a unique-constraint hit), 200 + `x-total-count` on lists.
 * One deliberate addition: write failures also carry `message`, the field
 * simple-rest reads into the error toast, so the phone shows the real reason
 * where the desktop shows a generic one.
 *
 * What the phone does NOT have in this phase answers honestly instead of
 * failing: meta says mode "android"; the update check asks GitHub from the
 * WebView and offers the Release page (no in-app install); sandbox, backups,
 * export/import and sync report "not on the phone yet" as 409s with code
 * NOT_ON_PHONE, and Settings hides their controls (SettingsPage.tsx keys off
 * `meta.mode`).
 */
import { DataError } from "../../../shared/data/errors";
import { SCHEMA_VERSION } from "../../../shared/data/schema";
import type { DataStore, ListQuery } from "../../../shared/data/store";
import { fetchLatestRelease, compareVersions, RELEASES_URL } from "../../../shared/app-links";
import type { AppMeta, UpdateStatus } from "../meta-api";
import type { SandboxStatus } from "../sandbox-api";
import type { SyncStatus } from "../sync-api";

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE" | "OPTIONS" | "HEAD";

export interface LocalResponse {
  status: number;
  /** Lower-case header names, like a fetch Response / axios would expose them. */
  headers: Record<string, string>;
  body: unknown;
}

export interface LocalApiOptions {
  /** The phone's store (opened lazily; the first call creates the schema). */
  store: () => Promise<DataStore>;
  /** The app facts (version, platform, where the database is). */
  meta: () => AppMeta;
  /** For the GitHub Release lookup; tests hand in a fake. */
  fetchImpl?: typeof fetch;
}

/** The `code` of every "this isn't on the phone yet" answer. */
export const NOT_ON_PHONE = "NOT_ON_PHONE";

/** The sentences Settings shows for the desktop-only features. */
export const PHONE_MESSAGES = {
  sandbox: "The sandbox is a desktop feature; it isn't available on the phone yet.",
  backups: "Backups aren't available on the phone yet. Your data stays in the app's own storage.",
  sync: "Syncing this phone with your PC comes in a later version. Your data stays on this phone for now.",
  transfer: "Export and import arrive together with phone sync in a later version.",
  updates: "This app can't update itself. Download the new APK from the Release page and install it over this one; your data stays on the phone.",
} as const;

function json(status: number, body: unknown, headers: Record<string, string> = {}): LocalResponse {
  return { status, headers, body };
}

/** What a JSON round trip over HTTP would have done: Dates → ISO strings, undefined dropped. */
function wire<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function refused(message: string, code = NOT_ON_PHONE): LocalResponse {
  // `message` too: @refinedev/simple-rest-style toasts read that field.
  return json(409, { error: message, message, code });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Split `…/api/Bill/abc?x=1` into segments + a query object the way Express does. */
export function parseRequestUrl(url: string): { segments: string[]; query: ListQuery } {
  const parsed = new URL(url, "http://local.invalid");
  let pathname = parsed.pathname;
  const apiIndex = pathname.indexOf("/api/");
  if (apiIndex >= 0) pathname = pathname.slice(apiIndex + 4);
  else if (pathname === "/api") pathname = "/";
  const segments = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  // Repeated keys become arrays (Express's query parser does the same), so
  // `?id=a&id=b` is rejected by the store exactly as the server rejects it.
  const query: ListQuery = {};
  for (const [key, value] of parsed.searchParams) {
    const previous = query[key];
    query[key] = previous === undefined ? value : Array.isArray(previous) ? [...previous, value] : [previous, value];
  }
  return { segments, query };
}

export class LocalApi {
  private updates: UpdateStatus;
  private checking: Promise<UpdateStatus> | null = null;

  constructor(private readonly options: LocalApiOptions) {
    this.updates = {
      // No engine on the phone: Settings links the Release page instead.
      supported: false,
      installBlocked: null,
      state: "idle",
      current: options.meta().version,
      latest: null,
      releaseDate: null,
      releaseUrl: RELEASES_URL,
      progress: null,
      error: null,
      checkedAt: null,
    };
  }

  /** One request in, one response out. Never throws: a crash is a 500 like on the server. */
  async handle(method: string, url: string, body?: unknown): Promise<LocalResponse> {
    const verb = method.toUpperCase() as HttpMethod;
    try {
      return await this.route(verb, url, body);
    } catch (error) {
      console.error(`Local API error on ${verb} ${url}:`, error);
      return json(500, { error: errorMessage(error), message: errorMessage(error) });
    }
  }

  private async route(method: HttpMethod, url: string, body: unknown): Promise<LocalResponse> {
    const { segments, query } = parseRequestUrl(url);
    const [head, second] = segments;
    if (method === "OPTIONS" || method === "HEAD") return json(200, null);

    // Registered before the resources, as on the server, so these names are
    // never taken for model names.
    switch (head) {
      case "meta":
        if (method === "GET" && !second) return json(200, this.options.meta());
        if (method === "GET" && second === "updates") return this.legacyUpdateCheck();
        break;
      case "updates":
        if (method === "GET" && second === "status") return json(200, this.updates);
        if (method === "POST") return this.updateAction(second);
        break;
      case "backups":
        if (method === "GET") {
          return json(200, { directory: "", count: 0, lastBackupAt: null, lastBackupFile: null });
        }
        if (method === "POST") return refused(PHONE_MESSAGES.backups);
        break;
      case "sandbox":
        if (method === "GET") return json(200, this.sandboxStatus());
        if (method === "POST") {
          if (!["enter", "discard", "keep"].includes(second ?? "")) {
            return json(404, { error: `Unknown sandbox action ${String(second)}` });
          }
          return refused(PHONE_MESSAGES.sandbox);
        }
        break;
      case "sync":
        if (method === "GET" && !second) return json(200, this.syncStatus());
        if (method === "GET" && second === "export") return refused(PHONE_MESSAGES.transfer);
        if (method === "POST" && second === "import") return refused(PHONE_MESSAGES.transfer);
        if (method === "POST") return refused(PHONE_MESSAGES.sync);
        break;
    }

    if (!head) return json(404, { error: "Not found" });
    return this.resource(method, head, second, query, body);
  }

  // ── Resources: the thin wrapper over DataStore, status codes as api-server.ts ──

  private async resource(
    method: HttpMethod,
    resource: string,
    id: string | undefined,
    query: ListQuery,
    body: unknown,
  ): Promise<LocalResponse> {
    const store = await this.options.store();
    const model = store.resolveResource(resource);
    if (!model) return json(404, { error: `Model ${resource} not found` });
    const input = wire((body as Record<string, unknown> | undefined) ?? {});

    try {
      if (!id) {
        if (method === "GET") {
          const { items, total } = await store.list(model, query);
          return json(200, wire(items), { "x-total-count": String(total) });
        }
        if (method === "POST") return json(200, wire(await store.create(model, input)));
        return json(404, { error: "Not found" });
      }
      if (method === "GET") {
        const item = await store.getOne(model, id);
        return item ? json(200, wire(item)) : json(404, { error: "Not found" });
      }
      if (method === "PATCH" || method === "PUT") return json(200, wire(await store.update(model, id, input)));
      if (method === "DELETE") {
        await store.remove(model, id);
        return json(200, { success: true });
      }
      return json(404, { error: "Not found" });
    } catch (error) {
      // Everything the data layer rejects was a Prisma error → 500 before;
      // a DataError's message is what the toast should say.
      const message = errorMessage(error);
      const code = error instanceof DataError ? error.code : undefined;
      return json(500, { error: message, message, ...(code ? { code } : {}) });
    }
  }

  // ── Updates: a GitHub lookup from the WebView, no in-app install ──

  private async updateAction(action: string | undefined): Promise<LocalResponse> {
    switch (action) {
      case "check":
        return json(200, await this.checkForUpdate());
      case "download":
      case "install":
        return refused(PHONE_MESSAGES.updates, "UPDATER_UNAVAILABLE");
      default:
        return json(404, { error: `Unknown update action ${String(action)}` });
    }
  }

  /** Overlapping checks share one request, like main/updates.ts. */
  private checkForUpdate(): Promise<UpdateStatus> {
    if (this.checking) return this.checking;
    this.updates = { ...this.updates, state: "checking", error: null };
    const fetchImpl = this.options.fetchImpl ?? fetch;
    this.checking = fetchLatestRelease(fetchImpl, this.updates.current)
      .then((release) => {
        const newer = compareVersions(release.latest, this.updates.current) > 0;
        this.updates = {
          ...this.updates,
          state: newer ? "available" : "up-to-date",
          latest: release.latest,
          releaseDate: release.releaseDate,
          releaseUrl: release.url,
          error: null,
          checkedAt: new Date().toISOString(),
        };
        return this.updates;
      })
      .catch((error) => {
        this.updates = {
          ...this.updates,
          state: "error",
          error: `Could not check GitHub: ${errorMessage(error)}`,
          checkedAt: new Date().toISOString(),
        };
        return this.updates;
      })
      .finally(() => {
        this.checking = null;
      });
    return this.checking;
  }

  /** GET /api/meta/updates (the pre-electron-updater shape), kept for completeness. */
  private async legacyUpdateCheck(): Promise<LocalResponse> {
    const status = await this.checkForUpdate();
    if (status.state === "error") return json(502, { error: status.error });
    return json(200, {
      current: status.current,
      latest: status.latest,
      url: status.releaseUrl,
      updateAvailable: status.state === "available",
      checkedAt: status.checkedAt,
    });
  }

  // ── The desktop-only features, reported as absent ──

  private sandboxStatus(): SandboxStatus {
    return { active: false, enteredAt: null, transactionsAdded: 0 };
  }

  private syncStatus(): SyncStatus {
    return {
      configured: false,
      url: null,
      state: "local",
      lastSyncedAt: null,
      lastError: null,
      syncing: false,
      pausedBy: null,
      schemaGate: null,
      readOnly: false,
      writesBlocked: null,
      replicaPath: null,
      appSchemaVersion: SCHEMA_VERSION,
    };
  }
}
