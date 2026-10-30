/**
 * libsql-sync-server-child.ts — runs a LibsqlSyncServer in its OWN PROCESS.
 *
 * Two ways in:
 *   - forked by `startSyncServerProcess` (libsql-sync-server.ts), driven over
 *     IPC — what the tests use;
 *   - started by hand for a browser check of the Settings flow:
 *       npx tsx tests/helpers/libsql-sync-server-child.ts --port 18081
 *     then paste http://127.0.0.1:18081 as the database URL (any token).
 *
 * Why a separate process: libsql bootstraps a synced database INSIDE the
 * synchronous `new Database()` (block_on on the JS thread), so a server
 * living on the same event loop could never answer — the open would
 * deadlock. In its own process the mock answers while the app sits in the
 * native call, exactly like a real server.
 */
import { LibsqlSyncServer } from "./libsql-sync-server";

interface Call {
  id: number;
  op: string;
  args: unknown[];
}

let server: LibsqlSyncServer | null = null;

async function dispatch(op: string, args: unknown[]): Promise<unknown> {
  if (op === "start") {
    const [options] = args as [{ base?: string; port?: number }];
    server = await LibsqlSyncServer.start({
      base: options?.base ? Buffer.from(options.base, "base64") : undefined,
      port: options?.port,
    });
    return server.url;
  }
  if (!server) throw new Error("server not started");
  switch (op) {
    case "exec":
      return server.exec(args[0] as string, args[1] as any);
    case "batch":
      await server.batch(args[0] as any);
      return null;
    case "set": {
      const [key, value] = args as [string, unknown];
      (server as any)[key] = value;
      if (key === "hang" && value === false) server.releaseHung();
      return null;
    }
    case "reset":
      server.reset();
      return null;
    case "snapshot":
      return server.snapshot();
    case "clearRequests":
      server.requests.length = 0;
      return null;
    case "materialize":
      return server.materialize().toString("base64");
    case "newGeneration":
      server.newGeneration();
      return null;
    case "close":
      await server.close();
      server = null;
      return null;
    default:
      throw new Error(`unknown op ${op}`);
  }
}

const portArg = process.argv.indexOf("--port");
if (portArg >= 0) {
  // Standalone: a fixed port, logs to the console, Ctrl+C to stop.
  LibsqlSyncServer.start({ port: Number(process.argv[portArg + 1]) }).then((s) => {
    server = s;
    console.log(`libsql sync mock listening at ${s.url} (offline-writes protocol + Hrana v2)`);
    setInterval(() => {
      const snap = s.snapshot();
      if (snap.requests.length) {
        console.log(snap.requests.join("\n"));
        s.requests.length = 0;
      }
    }, 1000).unref();
    process.stdin.resume();
  });
} else {
  process.on("message", (call: Call) => {
    dispatch(call.op, call.args).then(
      (result) => process.send!({ id: call.id, result }),
      (e: any) => process.send!({ id: call.id, error: e?.message ?? String(e) }),
    );
  });
}
