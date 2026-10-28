/**
 * cuid.ts — ids in the same shape Prisma's `@default(cuid())` produced, so
 * new rows look exactly like the existing ones (25 chars, leading "c"):
 *
 *   c + timestamp (8, base36) + counter (4) + fingerprint (4) + random (8)
 *
 * This is the original cuid v1 layout. Collision resistance comes from the
 * timestamp + counter + random block; the fingerprint only separates
 * processes. No cryptographic claims — it is an identifier, not a secret.
 */

const BASE = 36;
const BLOCK = 4;
const DISCRETE = BASE ** BLOCK; // 1,679,616

let counter = Math.floor(Math.random() * DISCRETE);

function pad(value: string, size: number): string {
  return value.length >= size ? value.slice(-size) : value.padStart(size, "0");
}

function randomBlock(): string {
  return pad(Math.floor(Math.random() * DISCRETE).toString(BASE), BLOCK);
}

/** Two base36 chars from a process-ish number + two from the host string. */
const FINGERPRINT = (() => {
  const g = globalThis as { process?: { pid?: number }; navigator?: { userAgent?: string } };
  const pid = g.process?.pid ?? Math.floor(Math.random() * DISCRETE);
  const host = g.navigator?.userAgent ?? "finances-os";
  let hash = host.length + BASE;
  for (const ch of host) hash += ch.charCodeAt(0);
  return pad(pid.toString(BASE), 2) + pad(hash.toString(BASE), 2);
})();

export function cuid(): string {
  const timestamp = Date.now().toString(BASE);
  counter = (counter + 1) % DISCRETE;
  const count = pad(counter.toString(BASE), BLOCK);
  return "c" + pad(timestamp, 8) + count + FINGERPRINT + randomBlock() + randomBlock();
}
