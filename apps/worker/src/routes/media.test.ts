import { env, SELF } from "cloudflare:test";
import { MEDIA_CAPS } from "@weavesteps/contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { type AuthedContext, authedContext } from "../test-support/authed-context";
import { expectIndexedQuery } from "../test-support/explain";
import { generateTestKeypair, type TestKeypair } from "../test-support/jwt";
import { applyMigrations, seedDb } from "../test-support/seed";

// ─────────────────────────────────────────────────────────────────────────
// annotation-media-embeds — the media upload/mint AUTHZ SURFACE (hard review
// gate). docs/ideas/annotation-media-embeds.md § Test plan.
//
// The object key IS the authorization scope: media/<docRef>/<annotationId>/
// <mediaId>. Mint gates on commenter+ of the docRef AND the caps; the PUT gates
// on the grant owner + commenter+; every multipart subroute repeats the FULL
// gate (never trusts the uploadId alone). Every new D1 query is EXPLAIN-indexed.
// ─────────────────────────────────────────────────────────────────────────

const DOC = "r_media";
let kp: TestKeypair;
let owner: AuthedContext;
let commenter: AuthedContext;
let viewer: AuthedContext;
let outsider: AuthedContext;

beforeAll(async () => {
  await applyMigrations();
  kp = await generateTestKeypair();
  await seedDb({
    users: [
      { id: "u_owner", displayName: "Owner", identityColor: "#111", plan: "free" },
      { id: "u_comm", displayName: "Commenter", identityColor: "#222", plan: "free" },
      { id: "u_viewer", displayName: "Viewer", identityColor: "#333", plan: "free" },
      { id: "u_outsider", displayName: "Outsider", identityColor: "#444", plan: "free" },
    ],
    docs: [
      {
        docRef: DOC,
        type: "routine",
        ownerId: "u_owner",
        doName: DOC,
        dance: "foxtrot",
        title: "T",
      },
    ],
    memberships: [
      { id: "m_comm", docRef: DOC, userId: "u_comm", role: "commenter" },
      { id: "m_viewer", docRef: DOC, userId: "u_viewer", role: "viewer" },
    ],
  });
  owner = await authedContext({ keypair: kp, userId: "u_owner", docRef: DOC, role: null });
  commenter = await authedContext({ keypair: kp, userId: "u_comm", docRef: DOC, role: null });
  viewer = await authedContext({ keypair: kp, userId: "u_viewer", docRef: DOC, role: null });
  outsider = await authedContext({ keypair: kp, userId: "u_outsider", docRef: DOC, role: null });
});

const mint = (ctx: AuthedContext | null, body: unknown, docRef = DOC) =>
  SELF.fetch(`https://x/api/docs/${docRef}/media/upload-url`, {
    method: "POST",
    headers: {
      ...(ctx ? ctx.authHeaders() : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
const imageBody = (annotationId: string, mediaId: string, sizeBytes = 1024) => ({
  annotationId,
  mediaId,
  type: "image",
  mimeType: "image/jpeg",
  sizeBytes,
});

describe("mint authz + caps", () => {
  it("403s a non-member and a viewer; 401s no token", async () => {
    expect((await mint(outsider, imageBody("a_x", "m_x"))).status).toBe(403);
    expect((await mint(viewer, imageBody("a_x", "m_x2"))).status).toBe(403);
    expect((await mint(null, imageBody("a_x", "m_x3"))).status).toBe(401);
  });

  it("mints for a commenter: objectKey is media/<docRef>/<annotationId>/<mediaId>", async () => {
    const res = await mint(commenter, imageBody("a_mint", "m_mint"));
    expect(res.status).toBe(200);
    const body = await res.json<{ objectKey: string; uploadUrl: string; maxBytes: number }>();
    expect(body.objectKey).toBe(`media/${DOC}/a_mint/m_mint`);
    expect(body.uploadUrl).toBe(`/api/media/${body.objectKey}`);
    expect(body.maxBytes).toBe(1024);
  });

  it("mints for the owner (elevated without a membership row)", async () => {
    expect((await mint(owner, imageBody("a_owner", "m_owner"))).status).toBe(200);
  });

  it("rejects an over-cap image (> 10 MB) and an over-cap video (> 300 MB or > 180 s) with 413", async () => {
    expect(
      (await mint(commenter, imageBody("a_big", "m_big", MEDIA_CAPS.imageMaxBytes + 1))).status,
    ).toBe(413);
    const bigVideo = await mint(commenter, {
      annotationId: "a_bv",
      mediaId: "m_bv",
      type: "video",
      mimeType: "video/mp4",
      sizeBytes: MEDIA_CAPS.videoMaxBytes + 1,
    });
    expect(bigVideo.status).toBe(413);
    const longVideo = await mint(commenter, {
      annotationId: "a_lv",
      mediaId: "m_lv",
      type: "video",
      mimeType: "video/mp4",
      sizeBytes: 1024,
      durationSeconds: MEDIA_CAPS.videoMaxSeconds + 1,
    });
    expect(longVideo.status).toBe(413);
  });

  it("rejects the 5th item on one annotation with 409 (posters excluded from the count)", async () => {
    for (let i = 0; i < MEDIA_CAPS.itemsPerAnnotation; i++) {
      expect((await mint(commenter, imageBody("a_cap", `m_cap${i}`))).status).toBe(200);
    }
    // A poster mint does not count toward the 4-item cap.
    const poster = await mint(commenter, {
      annotationId: "a_cap",
      mediaId: "m_cap_poster",
      type: "image",
      mimeType: "image/jpeg",
      sizeBytes: 1024,
      poster: true,
    });
    expect(poster.status).toBe(200);
    // The 5th non-poster item is refused.
    expect((await mint(commenter, imageBody("a_cap", "m_cap5"))).status).toBe(409);
  });

  it("rejects a mint that would exceed the 1 GB total with 402", async () => {
    // Seed usage near the cap with three 300 MB video mints (900 MB), then a
    // 300 MB mint (1200 MB > 1 GB) is refused.
    for (let i = 0; i < 3; i++) {
      const r = await mint(commenter, {
        annotationId: `a_quota${i}`,
        mediaId: `m_quota${i}`,
        type: "video",
        mimeType: "video/mp4",
        sizeBytes: MEDIA_CAPS.videoMaxBytes,
      });
      expect(r.status).toBe(200);
    }
    const over = await mint(commenter, {
      annotationId: "a_quota_over",
      mediaId: "m_quota_over",
      type: "video",
      mimeType: "video/mp4",
      sizeBytes: MEDIA_CAPS.videoMaxBytes,
    });
    expect(over.status).toBe(402);
  });
});

/** An ArrayBuffer of `n` bytes (a valid BodyInit; a bare Uint8Array<ArrayBufferLike>
 *  is not assignable to workerd's BodyInit/BlobPart types). */
const buf = (n: number): ArrayBuffer => new ArrayBuffer(n);

const put = (ctx: AuthedContext | null, objectKey: string, body: ArrayBuffer) =>
  SELF.fetch(`https://x/api/${objectKey === "" ? "media/" : `media/${objectKey}`}`, {
    method: "PUT",
    headers: {
      ...(ctx ? ctx.authHeaders() : {}),
      "content-type": "image/jpeg",
      "content-length": String(body.byteLength),
    },
    body,
  });

describe("single-PUT upload", () => {
  it("PUT streams the body into R2 under the minted key; a body over the grant is 413", async () => {
    const res = await mint(commenter, imageBody("a_put", "m_put", 1024));
    const { objectKey } = await res.json<{ objectKey: string }>();
    const ok = await put(commenter, objectKey, buf(1024));
    expect(ok.status).toBe(200);
    const stored = await env.MEDIA.get(objectKey);
    expect(stored).not.toBeNull();
    expect(stored?.size).toBe(1024);
    // A 2 KiB body against a 1 KiB grant is refused.
    const tooBig = await put(commenter, objectKey, buf(2048));
    expect(tooBig.status).toBe(413);
  });

  it("PUT by a non-member / another user is 403 even with a valid grant", async () => {
    const res = await mint(commenter, imageBody("a_put2", "m_put2", 1024));
    const { objectKey } = await res.json<{ objectKey: string }>();
    // The commenter minted the grant; the outsider (and the viewer) cannot PUT it.
    expect((await put(outsider, objectKey, buf(512))).status).toBe(403);
    expect((await put(viewer, objectKey, buf(512))).status).toBe(403);
    // A key with no grant at all is also 403 (the owner didn't mint it).
    expect((await put(owner, `media/${DOC}/a_nogrant/m_nogrant`, buf(4))).status).toBe(403);
  });

  it("404s a malformed key (outside the media/ namespace / wrong segment count)", async () => {
    expect((await put(commenter, "media/only/two", buf(4))).status).toBe(404);
  });
});

const mpuCreate = (ctx: AuthedContext, objectKey: string) =>
  SELF.fetch(`https://x/api/media/${objectKey}?action=mpu-create`, {
    method: "POST",
    headers: { ...ctx.authHeaders(), "content-type": "video/mp4" },
  });
const mpuPart = (
  ctx: AuthedContext,
  objectKey: string,
  uploadId: string,
  partNumber: number,
  body: ArrayBuffer,
  last = false,
) =>
  SELF.fetch(
    `https://x/api/media/${objectKey}?action=mpu-uploadpart&uploadId=${uploadId}&partNumber=${partNumber}${last ? "&last=1" : ""}`,
    {
      method: "PUT",
      headers: { ...ctx.authHeaders(), "content-length": String(body.byteLength) },
      body,
    },
  );
const mpuComplete = (
  ctx: AuthedContext,
  objectKey: string,
  uploadId: string,
  parts: Array<{ partNumber: number; etag: string }>,
) =>
  SELF.fetch(`https://x/api/media/${objectKey}?action=mpu-complete&uploadId=${uploadId}`, {
    method: "POST",
    headers: { ...ctx.authHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ parts }),
  });
const mpuAbort = (ctx: AuthedContext, objectKey: string, uploadId: string) =>
  SELF.fetch(`https://x/api/media/${objectKey}?action=mpu-abort&uploadId=${uploadId}`, {
    method: "DELETE",
    headers: ctx.authHeaders(),
  });

const FIVE_MIB = 5 * 1024 * 1024;

describe("multipart upload (videos above the body limit)", () => {
  const bigGrant = (annotationId: string, mediaId: string, sizeBytes: number) =>
    mint(commenter, {
      annotationId,
      mediaId,
      type: "video",
      mimeType: "video/mp4",
      sizeBytes,
    });

  it("mpu-create requires a grant (403 without one) and the grant's owner (403 otherwise)", async () => {
    // No grant at this key → 403.
    const noGrant = await mpuCreate(commenter, `media/${DOC}/a_mpu_ng/m_mpu_ng`);
    expect(noGrant.status).toBe(403);
    // Grant owned by the commenter; the outsider can't create against it.
    const g = await bigGrant("a_mpu_own", "m_mpu_own", FIVE_MIB * 2);
    const { objectKey } = await g.json<{ objectKey: string }>();
    expect((await mpuCreate(outsider, objectKey)).status).toBe(403);
    expect((await mpuCreate(commenter, objectKey)).status).toBe(200);
  });

  it("uploadpart rejects a part below 5 MiB (except the last) and cumulative bytes over the grant (413)", async () => {
    const g = await bigGrant("a_mpu_v", "m_mpu_v", FIVE_MIB * 2);
    const { objectKey } = await g.json<{ objectKey: string }>();
    const created = await mpuCreate(commenter, objectKey);
    const { uploadId } = await created.json<{ uploadId: string }>();
    // A non-final part below 5 MiB → 400.
    expect((await mpuPart(commenter, objectKey, uploadId, 1, buf(1024))).status).toBe(400);
    // A valid 5 MiB first part.
    const p1 = await mpuPart(commenter, objectKey, uploadId, 1, buf(FIVE_MIB));
    expect(p1.status).toBe(200);
    // Cumulative over the grant (another 5 MiB + a big final would exceed 10 MiB).
    const over = await mpuPart(commenter, objectKey, uploadId, 2, buf(FIVE_MIB + 1), true);
    expect(over.status).toBe(413);
  });

  it("mpu-complete assembles the object under the minted key; the parts round-trip via env.MEDIA.get", async () => {
    const g = await bigGrant("a_mpu_c", "m_mpu_c", FIVE_MIB * 2);
    const { objectKey } = await g.json<{ objectKey: string }>();
    const { uploadId } = await (await mpuCreate(commenter, objectKey)).json<{ uploadId: string }>();
    const p1 = await (await mpuPart(commenter, objectKey, uploadId, 1, buf(FIVE_MIB))).json<{
      partNumber: number;
      etag: string;
    }>();
    const p2 = await (await mpuPart(commenter, objectKey, uploadId, 2, buf(1024), true)).json<{
      partNumber: number;
      etag: string;
    }>();
    const done = await mpuComplete(commenter, objectKey, uploadId, [p1, p2]);
    expect(done.status).toBe(200);
    const stored = await env.MEDIA.get(objectKey);
    expect(stored?.size).toBe(FIVE_MIB + 1024);
  });

  it("mpu-abort tombstones the pending grant; completing an aborted upload is a 400", async () => {
    const g = await bigGrant("a_mpu_a", "m_mpu_a", FIVE_MIB * 2);
    const { objectKey } = await g.json<{ objectKey: string }>();
    const { uploadId } = await (await mpuCreate(commenter, objectKey)).json<{ uploadId: string }>();
    const p1 = await (await mpuPart(commenter, objectKey, uploadId, 1, buf(FIVE_MIB), true)).json<{
      partNumber: number;
      etag: string;
    }>();
    expect((await mpuAbort(commenter, objectKey, uploadId)).status).toBe(200);
    // Completing an aborted upload fails (400, never 500).
    expect((await mpuComplete(commenter, objectKey, uploadId, [p1])).status).toBe(400);
  });
});

describe("indexed counter reads", () => {
  it("counter reads are indexed (EXPLAIN, no SCAN)", async () => {
    await expectIndexedQuery(
      env.DB,
      "SELECT COUNT(*) AS n FROM media_object WHERE docRef = ? AND annotationId = ? AND poster = 0 AND deletedAt IS NULL",
      [DOC, "a_cap"],
    );
    await expectIndexedQuery(
      env.DB,
      "SELECT COALESCE(SUM(bytes), 0) AS used FROM media_object WHERE userId = ? AND deletedAt IS NULL",
      ["u_comm"],
    );
  });
});

const get = (ctx: AuthedContext | null, objectKey: string, range?: string) =>
  SELF.fetch(`https://x/api/media/${objectKey}`, {
    headers: {
      ...(ctx ? ctx.authHeaders() : {}),
      ...(range ? { Range: range } : {}),
    },
  });

// A 10-byte body ("0123456789") for the Range assertions.
const TEN_BYTES = new Uint8Array([48, 49, 50, 51, 52, 53, 54, 55, 56, 57]).buffer.slice(0);

async function arrangeServed(annotationId: string, mediaId: string): Promise<string> {
  const res = await mint(commenter, imageBody(annotationId, mediaId, 10));
  const { objectKey } = await res.json<{ objectKey: string }>();
  const put = await SELF.fetch(`https://x/api/media/${objectKey}`, {
    method: "PUT",
    headers: {
      ...commenter.authHeaders(),
      "content-type": "image/jpeg",
      "content-length": "10",
    },
    body: TEN_BYTES,
  });
  expect(put.status).toBe(200);
  return objectKey;
}

describe("stream-through serving (+ Range)", () => {
  it("streams the object to any member (viewer 200, owner 200) and 403s a non-member", async () => {
    const objectKey = await arrangeServed("a_srv", "m_srv");
    expect((await get(viewer, objectKey)).status).toBe(200);
    expect((await get(owner, objectKey)).status).toBe(200);
    expect((await get(commenter, objectKey)).status).toBe(200);
    expect((await get(outsider, objectKey)).status).toBe(403);
    expect((await get(null, objectKey)).status).toBe(401);
  });

  it("honors Range: bytes=0-3 → 206, Content-Range bytes 0-3/10, body '0123'", async () => {
    const objectKey = await arrangeServed("a_srv2", "m_srv2");
    const res = await get(viewer, objectKey, "bytes=0-3");
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 0-3/10");
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(await res.text()).toBe("0123");
  });

  it("Range: bytes=4- → 206 with the tail; an unsatisfiable range → 416", async () => {
    const objectKey = await arrangeServed("a_srv3", "m_srv3");
    const tail = await get(viewer, objectKey, "bytes=4-");
    expect(tail.status).toBe(206);
    expect(await tail.text()).toBe("456789");
    const bad = await get(viewer, objectKey, "bytes=200-");
    expect(bad.status).toBe(416);
    expect(bad.headers.get("Content-Range")).toBe("bytes */10");
  });

  it("serves a TOMBSTONED item's object to members unchanged (no CRDT check on the read path — undo must restore it)", async () => {
    const objectKey = await arrangeServed("a_srv4", "m_srv4");
    // Tombstone the grant row (undo-restorable); the object must still stream.
    await env.DB.prepare("UPDATE media_object SET deletedAt = ? WHERE objectKey = ?")
      .bind(Date.now(), objectKey)
      .run();
    expect((await get(viewer, objectKey)).status).toBe(200);
  });

  it("404s a key outside the media/ namespace and a malformed key", async () => {
    expect((await get(viewer, "notmedia/r/a/m")).status).toBe(404);
    expect((await get(viewer, "media/only/two")).status).toBe(404);
  });

  it("404s a well-formed key with no stored object (member, but nothing in R2)", async () => {
    expect((await get(viewer, `media/${DOC}/a_ghost/m_ghost`)).status).toBe(404);
  });
});

describe("youtube-thumb proxy", () => {
  const thumb = (ctx: AuthedContext | null, videoId: string, docRef: string | null) =>
    SELF.fetch(
      `https://x/api/media/youtube-thumb/${videoId}${docRef !== null ? `?docRef=${docRef}` : ""}`,
      { headers: ctx ? ctx.authHeaders() : {} },
    );

  it("401 unauthenticated; 403 non-member of ?docRef; 400 bad videoId", async () => {
    expect((await thumb(null, "dQw4w9WgXcQ", DOC)).status).toBe(401);
    expect((await thumb(outsider, "dQw4w9WgXcQ", DOC)).status).toBe(403);
    expect((await thumb(viewer, "not a video id!", DOC)).status).toBe(400);
    expect((await thumb(viewer, "dQw4w9WgXcQ", null)).status).toBe(400);
  });

  it("streams the upstream jpg with a long-lived Cache-Control (seam, vi.spyOn fetch)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array([0xff, 0xd8]).buffer, {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
    );
    try {
      const { fetchYoutubeThumb } = await import("../youtube-thumb");
      const res = await fetchYoutubeThumb("dQw4w9WgXcQ");
      expect(fetchSpy).toHaveBeenCalledWith("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
      expect(res.headers.get("cache-control")).toBe("public, max-age=604800, immutable");
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
