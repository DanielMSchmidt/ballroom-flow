// biome-ignore-all lint/a11y/useValidAriaRole: `role` here is the per-document
// MEMBERSHIP role prop (editor/commenter/viewer), not an ARIA role — Biome's a11y
// rule mis-flags it on these component props.
import type { Annotation } from "@weavesteps/domain";
import type { ComponentType } from "react";
import { describe, expect, it } from "vitest";
import { importComponent } from "../test-support/import-component";
import { renderUi, screen } from "../test-support/render";

// ─────────────────────────────────────────────────────────────────────────
// #292 — reading-view thread avatars must show the author's INITIAL, never the
// first character of the raw author id (a ULID → "0" for 2026-era ids). The
// thread sheet opens from the reading view; ThreadSheetContents threads the
// real `authorNameMap` into AnnotationPanel, whose ThreadComment avatar must
// take its initial from the resolved display name, not the id fallback.
// docs/concepts/annotations.md § Who left this.
// ─────────────────────────────────────────────────────────────────────────

interface AnnotationPanelModule {
  AnnotationPanel: ComponentType<Record<string, unknown>>;
}

// A ULID-shaped author id — the class of id real annotations carry. Its first
// character is "0" (the timestamp high bits), which is exactly the "0" the bug
// leaked into the avatar.
const ULID_AUTHOR = "01HZ8QY3M4NADIA0000000000";

const postedByUlid = (): Annotation => ({
  id: "a1",
  authorId: ULID_AUTHOR,
  kind: "note",
  text: "rise earlier",
  tags: [],
  anchors: [{ type: "figure", figureRef: "f1" }],
  replies: [],
  media: [],
  createdAt: 1,
  deletedAt: null,
});

describe("#292 thread-sheet avatar shows the author initial, not the id", () => {
  it("renders the display-name initial when authorNameMap resolves the author", async () => {
    const { AnnotationPanel } = await importComponent<AnnotationPanelModule>(
      "../components/AnnotationPanel",
    );
    renderUi(
      <AnnotationPanel
        role="commenter"
        currentUserId="me"
        docRef="r1"
        threadTitle="Feather Step"
        annotations={[postedByUlid()]}
        authorNameMap={{ [ULID_AUTHOR]: "Nadia" }}
        authorColorMap={{ [ULID_AUTHOR]: "#123456" }}
      />,
    );
    // The author's name label renders (proves the comment is on screen).
    const nameLabel = screen.getByText("Nadia");
    // The comment row is `<AuthorAvatar/> + <div>…name…</div>` — the avatar is the
    // decorative aria-hidden span at the head of that row. It must show the
    // initial "N", never the id's first character "0".
    const commentRow = nameLabel.closest("div.flex.gap-3");
    const avatar = commentRow?.querySelector<HTMLElement>('span[aria-hidden="true"]');
    expect(avatar?.textContent).toBe("N");
    expect(avatar?.textContent).not.toBe("0");
  });

  it("never derives the avatar initial from the raw author id when the name is unknown", async () => {
    const { AnnotationPanel } = await importComponent<AnnotationPanelModule>(
      "../components/AnnotationPanel",
    );
    // No authorNameMap entry for this author: the avatar must fall back to the
    // honest placeholder, never to the id's first character ("0").
    renderUi(
      <AnnotationPanel
        role="commenter"
        currentUserId="me"
        docRef="r1"
        threadTitle="Feather Step"
        annotations={[postedByUlid()]}
      />,
    );
    // The name label falls back to the raw id (no map) — find its comment row.
    const nameLabel = screen.getByText(ULID_AUTHOR);
    const commentRow = nameLabel.closest("div.flex.gap-3");
    const avatar = commentRow?.querySelector<HTMLElement>('span[aria-hidden="true"]');
    expect(avatar?.textContent).not.toBe("0");
  });
});
