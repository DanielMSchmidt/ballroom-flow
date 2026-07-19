// biome-ignore-all lint/a11y/useValidAriaRole: `role` here is the per-document
// MEMBERSHIP role prop (editor/commenter/viewer), not an ARIA role.
//
// docs/ideas/annotation-media-embeds.md Task 5 — the six web-layer component tests:
// compose affordances (live-gated, commenter+); inline render order + facade-no-tap;
// removed stub; video poster→play; compact surfaces show a chip never media; axe.
import type { MediaItem } from "@weavesteps/domain";
import { mediaToken } from "@weavesteps/domain";
import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";
import { importComponent } from "../test-support/import-component";
import { axeCheck, renderUi, screen, userEvent } from "../test-support/render";

// createImageBitmap / canvas / <video> aren't real in jsdom — mock the browser
// media helpers so the compose test exercises the mint/upload/token flow, not
// canvas. The pure decision helpers are unit-tested in lib/media-files.test.ts.
vi.mock("../lib/media-files", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/media-files")>();
  return {
    ...actual,
    compressImage: vi.fn(async () => ({
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }),
      width: 800,
      height: 600,
    })),
    captureVideoPoster: vi.fn(async () => new Blob([new Uint8Array([9])], { type: "image/jpeg" })),
    videoDurationSeconds: vi.fn(async () => 22),
  };
});

interface AnnotationPanelModule {
  AnnotationPanel: ComponentType<Record<string, unknown>>;
}
interface MediaPartsModule {
  MediaParts: ComponentType<Record<string, unknown>>;
}
interface MediaChipModule {
  MediaChip: ComponentType<Record<string, unknown>>;
}

const imageItem = (id: string): MediaItem => ({
  id,
  type: "image",
  objectKey: `media/r1/a1/${id}`,
  mimeType: "image/jpeg",
  sizeBytes: 1000,
  width: 800,
  height: 600,
  createdAt: 1,
});

const videoItem = (id: string): MediaItem => ({
  id,
  type: "video",
  objectKey: `media/r1/a1/${id}`,
  posterKey: `media/r1/a1/${id}-poster`,
  mimeType: "video/mp4",
  sizeBytes: 2000,
  durationSeconds: 22,
  createdAt: 1,
});

const youtubeItem = (id: string, videoId: string): MediaItem => ({
  id,
  type: "youtube",
  videoId,
  url: `https://youtu.be/${videoId}`,
  createdAt: 1,
});

const tombstonedItem = (id: string): MediaItem => ({
  ...imageItem(id),
  deletedAt: 2,
});

describe("annotation media — compose (Test 1)", () => {
  it("shows photo/video/YouTube attach buttons for a commenter with live sync; pending chip clears; viewer sees none; submit passes media+token text", async () => {
    const { AnnotationPanel } = await importComponent<AnnotationPanelModule>(
      "../components/AnnotationPanel",
    );
    const onCreate = vi.fn();
    const mediaId = "m_photo";
    const mint = vi.fn(async () => ({
      objectKey: `media/r1/a1/${mediaId}`,
      uploadUrl: `/api/media/media/r1/a1/${mediaId}`,
      maxBytes: 10_000_000,
    }));
    const upload = vi.fn(async () => {});

    renderUi(
      <AnnotationPanel
        role="commenter"
        currentUserId="me"
        composeAnchor={{ type: "point", figureRef: "f1", count: 4 }}
        docRef="r1"
        mediaSyncLive={true}
        newMediaId={() => mediaId}
        onMintMediaUpload={mint}
        onUploadMedia={upload}
        onCreate={onCreate}
      />,
    );

    // Attach affordances present for commenter+ with live sync.
    const photoBtn = screen.getByRole("button", { name: /attach photo/i });
    expect(photoBtn).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /attach video/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /attach youtube/i })).toBeInTheDocument();

    // Attach a photo: hidden file input + mint + upload.
    const fileInput = screen.getByTestId("media-photo-input");
    const file = new File([new Uint8Array([1, 2, 3])], "sketch.png", { type: "image/png" });
    await userEvent.upload(fileInput, file);

    // Pending chip appears; mint + upload were called.
    expect(await screen.findByTestId("pending-media-chip")).toBeInTheDocument();
    expect(mint).toHaveBeenCalled();
    expect(upload).toHaveBeenCalled();

    // Type prose, submit — media + token text reach onCreate.
    await userEvent.type(screen.getByRole("textbox", { name: /note|comment/i }), "sketch");
    await userEvent.click(screen.getByRole("button", { name: /add|post/i }));

    expect(onCreate).toHaveBeenCalledTimes(1);
    const arg = onCreate.mock.calls[0]?.[0];
    expect(arg.text).toContain(mediaToken(mediaId));
    expect(arg.media).toHaveLength(1);
    expect(arg.media[0].id).toBe(mediaId);
  });

  it("clears a pending item via the ✕ affordance", async () => {
    const { AnnotationPanel } = await importComponent<AnnotationPanelModule>(
      "../components/AnnotationPanel",
    );
    const mediaId = "m_photo";
    renderUi(
      <AnnotationPanel
        role="commenter"
        currentUserId="me"
        docRef="r1"
        mediaSyncLive={true}
        newMediaId={() => mediaId}
        onMintMediaUpload={async () => ({
          objectKey: `media/r1/a1/${mediaId}`,
          uploadUrl: `/api/media/media/r1/a1/${mediaId}`,
          maxBytes: 10_000_000,
        })}
        onUploadMedia={async () => {}}
        onCreate={() => {}}
      />,
    );
    const file = new File([new Uint8Array([1])], "s.png", { type: "image/png" });
    await userEvent.upload(screen.getByTestId("media-photo-input"), file);
    const chip = await screen.findByTestId("pending-media-chip");
    await userEvent.click(screen.getByRole("button", { name: /clear|remove/i }));
    expect(chip).not.toBeInTheDocument();
  });

  it("offers no attach affordances to a viewer", async () => {
    const { AnnotationPanel } = await importComponent<AnnotationPanelModule>(
      "../components/AnnotationPanel",
    );
    renderUi(<AnnotationPanel role="viewer" docRef="r1" mediaSyncLive={true} />);
    expect(screen.queryByRole("button", { name: /attach photo/i })).toBeNull();
  });
});

describe("annotation media — inline render (Test 2)", () => {
  it("renders text/img/text/facade in order; NO iframe & same-origin imgs before tap; nocookie iframe after", async () => {
    const { MediaParts } = await importComponent<MediaPartsModule>("../components/MediaParts");
    const text = `watch ${mediaToken("m1")} compare ${mediaToken("m2")}`;
    const media = [imageItem("m1"), youtubeItem("m2", "dQw4w9WgXcQ")];
    const { container } = renderUi(<MediaParts text={text} media={media} docRef="r1" />);

    // Photo img present, same-origin.
    const img = container.querySelector("img[src='/api/media/media/r1/a1/m1']");
    expect(img).not.toBeNull();

    // No iframe before tap; every img[src] is same-origin /api/media/...
    expect(container.querySelector("iframe")).toBeNull();
    for (const el of container.querySelectorAll("img")) {
      expect(el.getAttribute("src")).toMatch(/^\/api\/media\//);
    }

    // Tap the facade → nocookie iframe appears.
    await userEvent.click(screen.getByRole("button", { name: /load youtube/i }));
    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("src")).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ");
  });
});

describe("annotation media — removed stub (Test 3)", () => {
  it("renders the dashed removed stub with no img/video for a tombstoned token", async () => {
    const { MediaParts } = await importComponent<MediaPartsModule>("../components/MediaParts");
    const text = `gone ${mediaToken("m1")}`;
    const { container } = renderUi(
      <MediaParts text={text} media={[tombstonedItem("m1")]} docRef="r1" />,
    );
    expect(screen.getByText(/media removed/i)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("video")).toBeNull();
  });
});

describe("annotation media — video (Test 4)", () => {
  it("shows a poster img + play button; a <video controls src=/api/media/...> exists after tap", async () => {
    const { MediaParts } = await importComponent<MediaPartsModule>("../components/MediaParts");
    const text = `clip ${mediaToken("v1")}`;
    const { container } = renderUi(
      <MediaParts text={text} media={[videoItem("v1")]} docRef="r1" />,
    );

    // Poster img (from posterKey), no <video> yet.
    expect(container.querySelector("img[src='/api/media/media/r1/a1/v1-poster']")).not.toBeNull();
    expect(container.querySelector("video")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /play video/i }));
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.getAttribute("src")).toBe("/api/media/media/r1/a1/v1");
    expect(video?.hasAttribute("controls")).toBe(true);
  });
});

describe("annotation media — compact surfaces show a chip, never media (Test 5)", () => {
  it("MediaChip renders the label and no img/video/iframe", async () => {
    const { MediaChip } = await importComponent<MediaChipModule>("../ui");
    const { container } = renderUi(<MediaChip images={1} videos={2} />);
    expect(screen.getByText("⏵2 ▣1")).toBeInTheDocument();
    expect(container.querySelectorAll("img, video, iframe")).toHaveLength(0);
  });
});

describe("annotation media — remove a posted item (Test 7)", () => {
  // A posted annotation carrying two inline photos. The author may remove an
  // individual item (soft-delete tombstone; docs/concepts/annotations.md § Media);
  // a non-author co-member may not (annotation content is edited by its author only).
  const postedAnnotation = (media: MediaItem[], authorId = "me") => ({
    id: "a1",
    authorId,
    kind: "lesson" as const,
    // One token per media item so the inline order matches the item set exactly.
    text: media.map((m) => `${m.id} ${mediaToken(m.id)}`).join(" "),
    tags: [],
    anchors: [{ type: "figure" as const, figureRef: "f1" }],
    replies: [],
    media,
    createdAt: 1,
    deletedAt: null,
  });

  it("shows a per-item remove control to the annotation's author and calls onRemoveMedia with (annotationId, mediaId)", async () => {
    const { AnnotationPanel } = await importComponent<AnnotationPanelModule>(
      "../components/AnnotationPanel",
    );
    const onRemoveMedia = vi.fn();
    renderUi(
      <AnnotationPanel
        role="commenter"
        currentUserId="me"
        docRef="r1"
        threadTitle="Feather Step · step 2"
        annotations={[postedAnnotation([imageItem("m1"), imageItem("m2")])]}
        onRemoveMedia={onRemoveMedia}
      />,
    );
    const removeButtons = screen.getAllByRole("button", { name: /remove media/i });
    expect(removeButtons).toHaveLength(2);
    const [firstRemove] = removeButtons;
    expect(firstRemove).toBeDefined();
    if (!firstRemove) throw new Error("expected a remove button");
    await userEvent.click(firstRemove);
    expect(onRemoveMedia).toHaveBeenCalledTimes(1);
    expect(onRemoveMedia).toHaveBeenCalledWith("a1", "m1");
  });

  it("offers NO remove control to a co-member who is not the annotation's author", async () => {
    const { AnnotationPanel } = await importComponent<AnnotationPanelModule>(
      "../components/AnnotationPanel",
    );
    renderUi(
      <AnnotationPanel
        role="commenter"
        currentUserId="someone_else"
        docRef="r1"
        threadTitle="Feather Step · step 2"
        annotations={[postedAnnotation([imageItem("m1")], "the_author")]}
        onRemoveMedia={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /remove media/i })).toBeNull();
    // The embed still renders for reading.
    expect(screen.getByRole("img", { name: /attachment on this note/i })).toBeInTheDocument();
  });

  it("offers no remove control when onRemoveMedia is not wired (standalone / read-only host)", async () => {
    const { AnnotationPanel } = await importComponent<AnnotationPanelModule>(
      "../components/AnnotationPanel",
    );
    renderUi(
      <AnnotationPanel
        role="commenter"
        currentUserId="me"
        docRef="r1"
        threadTitle="Feather Step · step 2"
        annotations={[postedAnnotation([imageItem("m1")])]}
      />,
    );
    expect(screen.queryByRole("button", { name: /remove media/i })).toBeNull();
  });

  it("renders the removed stub (no remove control) for an already-tombstoned item", async () => {
    const { AnnotationPanel } = await importComponent<AnnotationPanelModule>(
      "../components/AnnotationPanel",
    );
    renderUi(
      <AnnotationPanel
        role="commenter"
        currentUserId="me"
        docRef="r1"
        threadTitle="Feather Step · step 2"
        annotations={[postedAnnotation([tombstonedItem("m1")])]}
        onRemoveMedia={vi.fn()}
      />,
    );
    expect(screen.getByText(/media removed/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove media/i })).toBeNull();
  });
});

describe("annotation media — axe (Test 6)", () => {
  it("has no violations on the opened thread with all four part kinds", async () => {
    const { MediaParts } = await importComponent<MediaPartsModule>("../components/MediaParts");
    const text = `a ${mediaToken("m1")} b ${mediaToken("v1")} c ${mediaToken("y1")} d ${mediaToken("gone")}`;
    const media = [
      imageItem("m1"),
      videoItem("v1"),
      youtubeItem("y1", "dQw4w9WgXcQ"),
      tombstonedItem("gone"),
    ];
    const { container } = renderUi(<MediaParts text={text} media={media} docRef="r1" />);
    const results = await axeCheck(container);
    expect(results).toHaveNoViolations();
  });
});
