/**
 * Base URL of the local API server (main/api-server.ts). The server listens
 * on the IPv4 loopback only, and the renderer names 127.0.0.1 explicitly so
 * `localhost` resolving to ::1 can never miss it. Shared by the Refine data
 * provider (app/providers.tsx) and the few raw fetches that aren't resource
 * CRUD (lib/sandbox-api.ts).
 */
export const API_URL = "http://127.0.0.1:5858/api";
