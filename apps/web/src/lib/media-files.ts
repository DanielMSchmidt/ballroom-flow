// docs/ideas/annotation-media-embeds.md — browser media helpers for the annotation
// compose flow: parse a YouTube URL to its video id, compress a picked image toward
// the ~2 MB / bounded-edge target, capture a video poster frame, and read a video's
// duration. The pure DECISION helpers (youtubeVideoId, boundedDimensions) are unit
// tested; the canvas/createImageBitmap/<video> paths aren't real under jsdom, so the
// browser helpers wrap those decisions and are exercised only in the E2E build.

/** The client image-compression target: aim the re-encoded JPEG at ~2 MB. */
export const IMAGE_TARGET_BYTES = 2 * 1024 * 1024;
/** Longest-edge bound for a compressed image (px) — keeps a phone photo legible
 *  in the thread without shipping a 12-megapixel original through the worker. */
export const IMAGE_MAX_EDGE = 1600;

/**
 * The `<video>` id of a YouTube URL, or `null` for anything that isn't one.
 * Accepts the three shapes a user actually pastes: `youtu.be/<id>`,
 * `youtube.com/watch?v=<id>` (with any extra query params), and the embed form
 * `youtube(-nocookie).com/embed/<id>`. A YouTube id is 11 URL-safe chars.
 */
export function youtubeVideoId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\./, "");
  const idOk = (id: string | null): string | null =>
    id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;

  if (host === "youtu.be") {
    return idOk(parsed.pathname.slice(1).split("/")[0] ?? null);
  }
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    if (parsed.pathname === "/watch") return idOk(parsed.searchParams.get("v"));
    const embed = parsed.pathname.match(/^\/embed\/([^/?]+)/);
    if (embed?.[1]) return idOk(embed[1]);
  }
  return null;
}

/**
 * Scale (w, h) down so the longest edge is at most `maxEdge`, preserving aspect
 * ratio and never upscaling. Pure — this is the decision the canvas draw uses, so
 * it's the part worth testing (jsdom has no real canvas).
 */
export function boundedDimensions(w: number, h: number, maxEdge: number): { w: number; h: number } {
  const longest = Math.max(w, h);
  if (longest <= maxEdge || longest === 0) return { w, h };
  const scale = maxEdge / longest;
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

/** A blob-producing canvas: the subset of HTMLCanvasElement the helpers below use. */
interface DrawTarget {
  width: number;
  height: number;
  drawImage(source: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
  toBlob(cb: (blob: Blob | null) => void, type?: string, quality?: number): void;
}

function makeCanvas(width: number, height: number): DrawTarget {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  return {
    width,
    height,
    drawImage: (source, dx, dy, dw, dh) => ctx.drawImage(source, dx, dy, dw, dh),
    toBlob: (cb, type, quality) => canvas.toBlob(cb, type, quality),
  };
}

function toBlobAsync(canvas: DrawTarget, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob produced null"))),
      type,
      quality,
    );
  });
}

/**
 * Decode a picked image, scale it under {@link IMAGE_MAX_EDGE}, and re-encode as a
 * JPEG stepping quality down until it's under ~2 MB. Returns the compressed blob
 * plus the drawn dimensions (the `MediaItem`'s width/height). Browser-only —
 * createImageBitmap/canvas don't exist in jsdom; the pure decisions it makes
 * ({@link boundedDimensions}) are what's unit-tested.
 */
export async function compressImage(
  file: File,
): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const { w, h } = boundedDimensions(bitmap.width, bitmap.height, IMAGE_MAX_EDGE);
  const canvas = makeCanvas(w, h);
  canvas.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const qualities = [0.82, 0.7, 0.6, 0.5];
  let blob = await toBlobAsync(canvas, "image/jpeg", qualities[0] ?? 0.82);
  for (let i = 1; i < qualities.length && blob.size > IMAGE_TARGET_BYTES; i += 1) {
    blob = await toBlobAsync(canvas, "image/jpeg", qualities[i] ?? 0.5);
  }
  return { blob, width: w, height: h };
}

/** Load a File into an off-DOM <video>, seeked past the first frame. */
function loadVideo(file: File): Promise<{ video: HTMLVideoElement; url: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.src = url;
    video.onloadeddata = () => resolve({ video, url });
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("video decode failed"));
    };
  });
}

/**
 * Capture a poster JPEG from ~the first visible frame of a picked video. The
 * poster is uploaded separately (`poster: true`) so the thread shows a still
 * before the viewer taps play. Browser-only.
 */
export async function captureVideoPoster(file: File): Promise<Blob> {
  const { video, url } = await loadVideo(file);
  try {
    const { w, h } = boundedDimensions(
      video.videoWidth || IMAGE_MAX_EDGE,
      video.videoHeight || IMAGE_MAX_EDGE,
      IMAGE_MAX_EDGE,
    );
    const canvas = makeCanvas(w, h);
    canvas.drawImage(video, 0, 0, w, h);
    return await toBlobAsync(canvas, "image/jpeg", 0.72);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The duration (seconds) of a picked video — enforced against the caps cap. */
export async function videoDurationSeconds(file: File): Promise<number> {
  const { video, url } = await loadVideo(file);
  try {
    return Number.isFinite(video.duration) ? video.duration : 0;
  } finally {
    URL.revokeObjectURL(url);
  }
}
