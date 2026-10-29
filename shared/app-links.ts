/**
 * app-links.ts — the project's public addresses and the GitHub Release lookup.
 *
 * Shared by the desktop (main/meta.ts, main/updates.ts) and the Android app
 * (renderer/lib/local-api), which has no server to ask: the phone's Settings
 * page calls GitHub from the WebView itself. No Node imports, so the renderer
 * bundle can include it.
 */

export const GITHUB_REPO = "DeweyHammers/finances-os";
export const REPO_URL = `https://github.com/${GITHUB_REPO}`;
export const RELEASES_URL = `${REPO_URL}/releases`;
export const ISSUES_URL = `${REPO_URL}/issues`;
/** The picture tour (docs/ → GitHub Pages). */
export const DOCS_URL = "https://deweyhammers.github.io/finances-os/";

/** Numeric dotted compare ("1.2.0" vs "1.10.0"); a leading "v" is ignored. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .replace(/^v/i, "")
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export interface LatestRelease {
  /** Version without the leading "v". */
  latest: string;
  /** The Release page. */
  url: string;
  /** GitHub's `published_at`, when it sent one. */
  releaseDate: string | null;
}

/**
 * Asks GitHub for the latest Release of this repo. Network failures throw —
 * the caller turns them into a 502 / an "error" status the Settings page can
 * show. The timeout keeps a dead network from hanging the button. (Browsers
 * drop the User-Agent header silently; Node sends it, as GitHub asks.)
 */
export async function fetchLatestRelease(
  fetchImpl: typeof fetch,
  currentVersion: string,
  timeoutMs = 6000,
): Promise<LatestRelease> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `finances-os/${currentVersion}`,
      },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const json = (await res.json()) as { tag_name?: string; html_url?: string; published_at?: string };
    const latest = String(json.tag_name ?? "").replace(/^v/i, "");
    if (!latest) throw new Error("No release found");
    return { latest, url: json.html_url ?? RELEASES_URL, releaseDate: json.published_at ?? null };
  } finally {
    clearTimeout(timer);
  }
}
