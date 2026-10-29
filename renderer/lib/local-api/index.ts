/**
 * local-api — the Android app's in-process replacement for the loopback API
 * (Phase C of plans/phone-app-and-sync.md). Two doors, both behind the ONE
 * runtime switch in lib/platform.ts:
 *
 *   apiFetch(url, init)   drop-in for `fetch` in lib/meta-api.ts,
 *                         sandbox-api.ts and sync-api.ts: in a browser or
 *                         the Electron renderer it IS fetch; in the app it
 *                         answers from LocalApi and wraps the answer in a
 *                         Response, so the callers' parsing is unchanged.
 *   localHttpClient       the axios-shaped client @refinedev/simple-rest
 *                         accepts in place of its own axios instance, so the
 *                         provider keeps building today's URLs and the store
 *                         sees today's ListQuery objects (app/providers.tsx).
 *
 * The store opens on the first request (openPhoneDatabase → DataStore), and
 * the store's own first-use hook applies the schema to an empty database —
 * the same createDatabase / prepareDatabase the desktop and the installer's
 * template.db use. A failed open is retried on the next request.
 */
import pkg from "../../../package.json";
import { DataStore } from "../../../shared/data/store";
import { DOCS_URL, ISSUES_URL, RELEASES_URL, REPO_URL } from "../../../shared/app-links";
import type { AppMeta } from "../meta-api";
import { isNativeApp, platformName } from "../platform";
import { LocalApi, type LocalResponse } from "./router";

export { isNativeApp } from "../platform";
export { LocalApi, NOT_ON_PHONE, PHONE_MESSAGES } from "./router";

/** `<name>SQLite.db` is how @capacitor-community/sqlite names the file. */
const PHONE_DATABASE = "finances-os";

let storePromise: Promise<DataStore> | null = null;

/** The phone's DataStore, opened on first use (shared by every request). */
export function getPhoneStore(): Promise<DataStore> {
  if (!storePromise) {
    // Lazy import: the plugin and its web engine stay out of the desktop bundle.
    storePromise = import("./capacitor-sqlite")
      .then(({ openPhoneDatabase }) => openPhoneDatabase(PHONE_DATABASE))
      .then((connection) => new DataStore(connection))
      .catch((error) => {
        storePromise = null; // try again on the next request
        throw error;
      });
  }
  return storePromise;
}

/** The app facts Settings → General / Data show on the phone. */
export function phoneMeta(): AppMeta {
  return {
    version: pkg.version,
    mode: "android",
    platform: platformName(),
    databasePath: `${PHONE_DATABASE}SQLite.db (this app's private storage)`,
    repoUrl: REPO_URL,
    releasesUrl: RELEASES_URL,
    issuesUrl: ISSUES_URL,
    docsUrl: DOCS_URL,
  };
}

let api: LocalApi | null = null;
function localApi(): LocalApi {
  api ??= new LocalApi({ store: getPhoneStore, meta: phoneMeta });
  return api;
}

/** Parse a fetch-style body the way express.json() would (a JSON string → object; bytes stay bytes). */
function requestBody(init?: RequestInit): unknown {
  const body = init?.body;
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }
  return body;
}

function toResponse(answer: LocalResponse): Response {
  return new Response(answer.body === null || answer.body === undefined ? null : JSON.stringify(answer.body), {
    status: answer.status,
    headers: { "content-type": "application/json", ...answer.headers },
  });
}

/**
 * `fetch` for the renderer's non-resource calls: the real thing everywhere a
 * server exists, the in-process API in the app.
 */
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  if (!isNativeApp()) return fetch(input, init);
  const method = (init?.method ?? "GET").toUpperCase();
  return toResponse(await localApi().handle(method, input, requestBody(init)));
}

/** What simple-rest reads off an axios error. */
export interface LocalHttpError {
  message: string;
  statusCode: number;
  response: { status: number; data: unknown };
}

export interface LocalHttpResponse {
  data: unknown;
  headers: Record<string, string>;
  status: number;
}

/** The axios-shaped surface @refinedev/simple-rest calls. */
export interface LocalHttpClient {
  get(url: string, config?: unknown): Promise<LocalHttpResponse>;
  post(url: string, data?: unknown, config?: unknown): Promise<LocalHttpResponse>;
  patch(url: string, data?: unknown, config?: unknown): Promise<LocalHttpResponse>;
  put(url: string, data?: unknown, config?: unknown): Promise<LocalHttpResponse>;
  delete(url: string, config?: { data?: unknown }): Promise<LocalHttpResponse>;
}

/**
 * Build the client over an API. A failed answer rejects with what
 * simple-rest's axios interceptor would have produced (`message`,
 * `statusCode`), so Refine's error toasts behave as on the desktop. `config`
 * (headers) is ignored: there is no network to carry them on.
 */
export function createLocalHttpClient(api: () => LocalApi): LocalHttpClient {
  const request = async (method: string, url: string, data?: unknown): Promise<LocalHttpResponse> => {
    const answer = await api().handle(method, url, data);
    if (answer.status >= 400) {
      const body = (answer.body ?? {}) as { message?: string; error?: string };
      const error: LocalHttpError = {
        message: body.message ?? body.error ?? `Request failed with status ${answer.status}`,
        statusCode: answer.status,
        response: { status: answer.status, data: answer.body },
      };
      throw error;
    }
    return { data: answer.body, headers: answer.headers, status: answer.status };
  };
  return {
    get: (url) => request("GET", url),
    post: (url, data) => request("POST", url, data),
    patch: (url, data) => request("PATCH", url, data),
    put: (url, data) => request("PUT", url, data),
    delete: (url, config) => request("DELETE", url, config?.data),
  };
}

/** The client handed to @refinedev/simple-rest in the app (app/providers.tsx). */
export const localHttpClient: LocalHttpClient = createLocalHttpClient(localApi);
