/**
 * Base URL of the local API server (main/api-server.ts). The server listens
 * on the IPv4 loopback only, and the renderer names 127.0.0.1 explicitly so
 * `localhost` resolving to ::1 can never miss it. Shared by the Refine data
 * provider (app/providers.tsx) and the few raw fetches that aren't resource
 * CRUD (lib/sandbox-api.ts).
 */
// `NEXT_PUBLIC_API_URL` overrides the default at build time (Next inlines
// NEXT_PUBLIC_* variables). The static PROD export never sets it, so the
// installed app always talks to its own main process on 5858. The override
// lets a second renderer (e.g. the demo UI from .claude/launch.json) point at
// a demo API on another port while the installed app still owns 5858.
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:5858/api";
