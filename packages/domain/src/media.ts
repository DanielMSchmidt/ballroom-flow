// docs/ideas/annotation-media-embeds.md — inline media embedding.
//
// A media item is placed in an annotation's plain text by an id token
// `![media:<mediaId>]`. This module is the pure renderer half: split the text
// into ordered parts (text / media / removed stub). CRDT semantics stay trivial
// (append + tombstone list; the text field's merge behavior is untouched) — the
// attach/tombstone ops live in doc-routine.ts.
import type { MediaItem } from "./doc-types";

export type MediaPart =
  | { kind: "text"; text: string }
  | { kind: "media"; item: MediaItem }
  | { kind: "removed"; mediaId: string };

/** The inline token that places media item `mediaId` in an annotation's text. */
export const mediaToken = (mediaId: string): string => `![media:${mediaId}]`;

const TOKEN_RE = /!\[media:([A-Za-z0-9]+)\]/g;

/**
 * Split an annotation's plain text into ordered text/media parts.
 * Live item → embed; tombstoned or unknown id → a quiet "removed" stub; a live
 * item referenced nowhere (a concurrent text edit ate its token) is appended
 * after the text — nothing is silently lost.
 */
export function splitMediaParts(text: string, media?: MediaItem[]): MediaPart[] {
  const byId = new Map((media ?? []).map((m) => [m.id, m]));
  const referenced = new Set<string>();
  const parts: MediaPart[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN_RE)) {
    const token = match[0];
    const id = match[1];
    if (id === undefined) continue;
    if (match.index > last) parts.push({ kind: "text", text: text.slice(last, match.index) });
    last = match.index + token.length;
    referenced.add(id);
    const item = byId.get(id);
    if (item && item.deletedAt == null) parts.push({ kind: "media", item });
    else parts.push({ kind: "removed", mediaId: id });
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  for (const item of media ?? []) {
    if (!referenced.has(item.id) && item.deletedAt == null) parts.push({ kind: "media", item });
  }
  return parts;
}
