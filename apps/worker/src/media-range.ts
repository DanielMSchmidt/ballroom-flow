// annotation-media-embeds — HTTP Range → R2Range for the stream-through media
// serving path. Native <video>/<img> element fetches issue single-range
// `bytes=` requests; we translate them to R2's `get(key, { range })` shape.
// Multi-range and malformed headers fall back to a full-object serve (null);
// a range wholly past the object end is unsatisfiable (the route returns 416).

/** Parse a single-range `bytes=` header against the object's total `size`.
 *  Returns an R2Range (offset/length or suffix), null (serve the whole object),
 *  or "unsatisfiable" (416). */
export function parseRange(
  header: string | undefined,
  size: number,
): R2Range | null | "unsatisfiable" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null; // not a single bytes= range (incl. multi-range) → serve full
  const [, startRaw, endRaw] = m;
  if (startRaw === "" && endRaw === "") return null;

  // Suffix range: bytes=-N (the last N bytes).
  if (startRaw === "") {
    const suffix = Number(endRaw);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    return { suffix: Math.min(suffix, size) };
  }

  const offset = Number(startRaw);
  if (!Number.isFinite(offset) || offset < 0) return null;
  if (offset >= size) return "unsatisfiable";

  // Open-ended range: bytes=START-.
  if (endRaw === "") return { offset };

  // Closed range: bytes=START-END (inclusive).
  const end = Number(endRaw);
  if (!Number.isFinite(end) || end < offset) return null;
  if (end >= size) return "unsatisfiable";
  return { offset, length: end - offset + 1 };
}

/** Resolve an R2Range against the object's total `size` to the absolute
 *  offset/length needed for the `Content-Range` + `Content-Length` headers. */
export function resolveRange(range: R2Range, size: number): { offset: number; length: number } {
  if ("suffix" in range) {
    const length = Math.min(range.suffix, size);
    return { offset: size - length, length };
  }
  const offset = range.offset ?? 0;
  const length = range.length ?? size - offset;
  return { offset, length };
}
