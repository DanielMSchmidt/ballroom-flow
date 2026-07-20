// annotation-media-embeds — worker-proxied YouTube facade thumbnail (decided
// 2026-07-15). The reader's browser only ever talks to the app; the worker
// fetches i.ytimg.com server-side and streams it back with a long-lived
// Cache-Control. This is what lets "reading a note" make NO third-party request
// — the iframe itself still loads only after an explicit tap.

/** A YouTube video id (11 chars in practice; accept the documented 6–20 range of
 *  [A-Za-z0-9_-] so a future id-length change doesn't 400 a valid video). */
export const YT_VIDEO_ID_RE = /^[A-Za-z0-9_-]{6,20}$/;

/** Fetch the hqdefault thumbnail for `videoId` from i.ytimg.com and return it as
 *  a streamed response with an immutable long-lived cache header. On an upstream
 *  failure returns a 502 (never throws). */
export async function fetchYoutubeThumb(videoId: string): Promise<Response> {
  const upstream = await fetch(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`);
  if (!upstream.ok) return Response.json({ error: "unavailable" }, { status: 502 });
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "image/jpeg",
      "cache-control": "public, max-age=604800, immutable",
    },
  });
}
