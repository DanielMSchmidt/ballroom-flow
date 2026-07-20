-- docs/ideas/annotation-media-embeds.md — the media upload-grant + usage counter
-- for the media caps (enforced at mint). One row per minted R2 object; `bytes`
-- is the declared (granted) size, re-checked against Content-Length at the PUT.
-- D1 stays a pure index (no CRDT content, no bytes) — the bytes live in R2.
-- Soft-delete only; R2 GC of tombstoned objects is deferred debt.
--
-- The key IS the authorization scope: media/<docRef>/<annotationId>/<mediaId>.
-- The serving/upload routes parse the docRef out of the key prefix and gate on
-- resolveEffectiveRole — the row exists only for caps accounting + the
-- upload-grant (mediaObjectFor(objectKey) → {userId, bytes}).
CREATE TABLE IF NOT EXISTS media_object (
  objectKey    TEXT PRIMARY KEY,       -- media/<docRef>/<annotationId>/<mediaId>
  docRef       TEXT NOT NULL,
  annotationId TEXT NOT NULL,
  userId       TEXT NOT NULL,
  bytes        INTEGER NOT NULL,        -- the granted (declared) total size
  uploadedBytes INTEGER NOT NULL DEFAULT 0,  -- cumulative bytes accepted (multipart running total)
  poster       INTEGER NOT NULL DEFAULT 0,  -- 1 = a video poster frame (excluded from the 4-item count)
  createdAt    INTEGER NOT NULL,
  deletedAt    INTEGER                  -- soft-delete tombstone (undo restores; R2 object kept)
);

-- The 4-items-per-annotation cap count (poster- and tombstone-excluded).
CREATE INDEX IF NOT EXISTS media_object_annotation_idx ON media_object (docRef, annotationId);
-- The per-user 1 GB total (bytes summed over a user's live rows).
CREATE INDEX IF NOT EXISTS media_object_user_idx ON media_object (userId);

-- Journal-card media chip (plan discrepancy 3): projected live media counts so
-- the Journal card renders the chip without reading CRDT. YouTube counts as video.
ALTER TABLE journal_entry ADD COLUMN imageCount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE journal_entry ADD COLUMN videoCount INTEGER NOT NULL DEFAULT 0;
