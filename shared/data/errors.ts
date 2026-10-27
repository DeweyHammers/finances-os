/**
 * errors.ts — the failures the data layer reports. The HTTP layer maps them
 * (a missing row on a read → 404; everything else → 500, exactly as the
 * Prisma client's errors surfaced before); the phone will map them to toasts.
 */
export type DataErrorCode =
  | "NOT_FOUND" // update/delete of a missing row (Prisma P2025)
  | "VALIDATION" // bad column, bad value, bad sort order (Prisma validation)
  | "CORRUPT"; // a stored value the reader can't interpret

export class DataError extends Error {
  constructor(
    public readonly code: DataErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DataError";
  }
}
