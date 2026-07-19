// docs/ideas/annotation-media-embeds.md — the media_object upload-grant + usage
// counter (migration 0020). D1 stays a pure index: this table holds the granted
// byte size + accounting only; the bytes themselves live in R2.
//
// The row is minted at upload-URL time (reserving the annotation's item slot and
// the user's byte budget for a concurrent mint) and re-checked against the real
// Content-Length at the PUT. Soft-delete only (abort/undo tombstones; the R2
// object is kept — GC is deferred debt).

/** One media_object row to insert at mint. */
export interface MediaObjectInsert {
  objectKey: string;
  docRef: string;
  annotationId: string;
  userId: string;
  bytes: number;
  poster: boolean;
}

/** The upload grant a PUT verifies: who reserved the key and for how many bytes. */
export interface MediaGrant {
  userId: string;
  bytes: number;
  /** Cumulative bytes accepted so far (multipart running total; 0 for single-PUT). */
  uploadedBytes: number;
  deletedAt: number | null;
}

/** Insert a media_object grant row (mint). No upsert — the mediaId is a fresh
 *  client ULID, so a collision is a real bug, not a benign re-mint. */
export async function insertMediaObject(db: D1Database, row: MediaObjectInsert): Promise<void> {
  await db
    .prepare(
      "INSERT INTO media_object (objectKey, docRef, annotationId, userId, bytes, poster, createdAt, deletedAt) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)",
    )
    .bind(
      row.objectKey,
      row.docRef,
      row.annotationId,
      row.userId,
      row.bytes,
      row.poster ? 1 : 0,
      Date.now(),
    )
    .run();
}

/** The grant for `objectKey` (PK lookup), or null if unminted. Includes
 *  tombstoned rows so an aborted/undone grant is distinguishable from an
 *  unminted key at the PUT. */
export async function mediaObjectFor(
  db: D1Database,
  objectKey: string,
): Promise<MediaGrant | null> {
  const row = await db
    .prepare("SELECT userId, bytes, uploadedBytes, deletedAt FROM media_object WHERE objectKey = ?")
    .bind(objectKey)
    .first<{ userId: string; bytes: number; uploadedBytes: number; deletedAt: number | null }>();
  return row
    ? {
        userId: row.userId,
        bytes: row.bytes,
        uploadedBytes: row.uploadedBytes,
        deletedAt: row.deletedAt,
      }
    : null;
}

/** Add `delta` bytes to a grant's multipart running total (each accepted part). */
export async function addUploadedBytes(
  db: D1Database,
  objectKey: string,
  delta: number,
): Promise<void> {
  await db
    .prepare("UPDATE media_object SET uploadedBytes = uploadedBytes + ? WHERE objectKey = ?")
    .bind(delta, objectKey)
    .run();
}

/** Live item count on one annotation (poster- and tombstone-excluded) — the
 *  4-items-per-annotation cap. */
export async function annotationMediaCount(
  db: D1Database,
  docRef: string,
  annotationId: string,
): Promise<number> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM media_object WHERE docRef = ? AND annotationId = ? AND poster = 0 AND deletedAt IS NULL",
    )
    .bind(docRef, annotationId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Total live bytes a user has stored — the 1 GB per-user cap. */
export async function userMediaBytes(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare(
      "SELECT COALESCE(SUM(bytes), 0) AS used FROM media_object WHERE userId = ? AND deletedAt IS NULL",
    )
    .bind(userId)
    .first<{ used: number }>();
  return row?.used ?? 0;
}

/** Tombstone a grant row (multipart abort). Soft-delete only. */
export async function softDeleteMediaObject(db: D1Database, objectKey: string): Promise<void> {
  await db
    .prepare("UPDATE media_object SET deletedAt = ? WHERE objectKey = ? AND deletedAt IS NULL")
    .bind(Date.now(), objectKey)
    .run();
}
