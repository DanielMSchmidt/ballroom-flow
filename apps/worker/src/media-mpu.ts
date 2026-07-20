// docs/ideas/annotation-media-embeds.md (plan discrepancy 1) — R2 multipart
// upload helpers. Videos above MEDIA_CAPS.singlePutMaxBytes can't fit in one
// Workers request body, so they go through the R2 multipart Workers API behind
// the SAME upload grant + authz gate. Parts must be uniform and ≥ 5 MiB (R2's
// minimum, except the final part); per-part upload also gives the in-app retry
// its resume points, and R2 auto-aborts an incomplete MPU after 7 days.

/** R2's minimum non-final part size. */
export const R2_MIN_PART_BYTES = 5 * 1024 * 1024;

/** A part number must be a positive integer (R2 accepts 1..10000). */
export function parsePartNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : null;
}

/**
 * Is this part's byte length acceptable? Every part except the last must be
 * ≥ 5 MiB (R2 rejects a smaller non-final part at complete time; we reject early
 * so the client gets a clear error). `isLast` is the client's declared final
 * flag — the last part may be any positive size.
 */
export function isValidPartSize(bytes: number, isLast: boolean): boolean {
  if (!Number.isFinite(bytes) || bytes <= 0) return false;
  return isLast || bytes >= R2_MIN_PART_BYTES;
}
