// docs/ideas/annotation-media-embeds.md — the media object key IS the
// authorization scope. A key names exactly one media object and carries its
// docRef in the prefix, so the serving/upload routes derive membership from the
// key alone (never from anything else the client supplies).

export interface MediaKey {
  docRef: string;
  annotationId: string;
  mediaId: string;
}

/** Parse + validate a media object key: media/<docRef>/<annotationId>/<mediaId>
 *  — exactly four slash-free segments under the `media/` namespace. Anything
 *  else (a key outside the namespace, a traversal attempt, a poster subkey with
 *  extra segments) is rejected → the route treats it as not-found. */
export function parseMediaKey(objectKey: string): MediaKey | null {
  const m = /^media\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(objectKey);
  if (!m) return null;
  const [, docRef, annotationId, mediaId] = m;
  if (!docRef || !annotationId || !mediaId) return null;
  return { docRef, annotationId, mediaId };
}
