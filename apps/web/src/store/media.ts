// docs/ideas/annotation-media-embeds.md — media upload REST helpers (the search.ts
// pattern: thin wrappers over the rpc arm that components never call directly — the
// store/ seam is the only caller). Mint an upload grant, then push the blob through
// the worker into R2: a single PUT for small blobs, the R2 multipart Workers API for
// large videos (create → sequential uploadpart → complete; abort on error).
import type { MintMediaUpload, MintMediaUploadResponse } from "@weavesteps/contract";
import { MEDIA_CAPS, zMintMediaUploadResponse } from "@weavesteps/contract";
import { apiDelete, apiPost, apiPutBlob, apiPutBlobJson } from "../lib/rpc";

/**
 * Mint an upload grant for one media item (POST /api/docs/:docRef/media/upload-url).
 * The worker checks commenter+ membership AND the caps, then returns the object key +
 * the upload URL to PUT the blob to. Zod-parses the response so a shape drift throws
 * here, not at a later render.
 */
export async function mintMediaUpload(
  token: string | null,
  docRef: string,
  req: MintMediaUpload,
  baseUrl = "",
): Promise<MintMediaUploadResponse> {
  const raw = await apiPost<unknown>(
    `${baseUrl}/api/docs/${encodeURIComponent(docRef)}/media/upload-url`,
    token,
    req,
  );
  return zMintMediaUploadResponse.parse(raw);
}

/** ~32 MiB multipart chunk — comfortably under the Workers request-body limit and
 *  above R2's 5 MiB minimum part size, so every part but the last is uniform. */
const MPU_PART_BYTES = 32 * 1024 * 1024;

interface MpuCreated {
  uploadId: string;
}
interface MpuPart {
  partNumber: number;
  etag: string;
}

/** One R2 multipart response part, validated at the JSON boundary (no cast). */
function asPart(raw: unknown): MpuPart {
  if (
    typeof raw === "object" &&
    raw !== null &&
    "partNumber" in raw &&
    "etag" in raw &&
    typeof raw.partNumber === "number" &&
    typeof raw.etag === "string"
  ) {
    return { partNumber: raw.partNumber, etag: raw.etag };
  }
  throw new Error("malformed multipart uploadpart response");
}

function asUploadId(raw: unknown): string {
  if (
    typeof raw === "object" &&
    raw !== null &&
    "uploadId" in raw &&
    typeof raw.uploadId === "string"
  ) {
    return raw.uploadId;
  }
  throw new Error("malformed multipart create response");
}

/**
 * Upload a media blob to its minted `uploadUrl`. A single worker PUT when the blob
 * fits under {@link MEDIA_CAPS.singlePutMaxBytes}; otherwise the R2 multipart flow
 * (create → uniform ~32 MiB parts, sequential, `last=1` on the final part →
 * complete), aborting the multipart upload if any part fails so no orphan lingers.
 */
export async function uploadMedia(
  token: string | null,
  uploadUrl: string,
  blob: Blob,
  mimeType: string,
  baseUrl = "",
): Promise<void> {
  const url = `${baseUrl}${uploadUrl}`;
  if (blob.size <= MEDIA_CAPS.singlePutMaxBytes) {
    await apiPutBlob(url, token, blob, mimeType);
    return;
  }

  const sep = url.includes("?") ? "&" : "?";
  const created: MpuCreated = {
    uploadId: asUploadId(await apiPost<unknown>(`${url}${sep}action=mpu-create`, token, {})),
  };
  const uploadId = encodeURIComponent(created.uploadId);
  try {
    const parts: MpuPart[] = [];
    const total = Math.ceil(blob.size / MPU_PART_BYTES);
    for (let i = 0; i < total; i += 1) {
      const start = i * MPU_PART_BYTES;
      const chunk = blob.slice(start, start + MPU_PART_BYTES);
      const partNumber = i + 1;
      const last = partNumber === total ? "&last=1" : "";
      const partUrl = `${url}${sep}action=mpu-uploadpart&uploadId=${uploadId}&partNumber=${partNumber}${last}`;
      // Each part is a PUT with the chunk as its body; the worker returns { partNumber, etag }.
      parts.push(asPart(await apiPutBlobJson<unknown>(partUrl, token, chunk, mimeType)));
    }
    await apiPost<unknown>(`${url}${sep}action=mpu-complete&uploadId=${uploadId}`, token, {
      parts,
    });
  } catch (err) {
    await apiDelete<unknown>(`${url}${sep}action=mpu-abort&uploadId=${uploadId}`, token).catch(
      () => {},
    );
    throw err;
  }
}
