// biome-ignore-all lint/a11y/useValidAriaRole: `role` here is the per-document
// MEMBERSHIP role prop (viewer/commenter/editor), not an ARIA role.
//
// #294 — whole-annotation soft-delete affordance. The data model (deletedAt
// tombstone + store.deleteAnnotation → softDeleteAnnotation) already existed; no
// component exposed it. AnnotationPanel now offers a per-annotation delete on the
// viewer's OWN annotations only (docs/concepts/annotations.md § Ownership:
// "anyone may only edit or delete their own"), mirroring the reply-delete gate.
import type { Annotation } from "@weavesteps/domain";
import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";
import { importComponent } from "../test-support/import-component";
import { renderUi, screen, userEvent } from "../test-support/render";

interface AnnotationPanelModule {
  AnnotationPanel: ComponentType<Record<string, unknown>>;
}

const annotation = (id: string, authorId: string): Annotation => ({
  id,
  authorId,
  kind: "lesson",
  text: "settle the sway here",
  tags: [],
  anchors: [{ type: "figure", figureRef: "f1" }],
  replies: [],
  createdAt: 1,
  deletedAt: null,
});

describe("annotation delete — author gate (thread mode)", () => {
  it("shows a delete control on the viewer's OWN annotation and calls onDeleteAnnotation(id)", async () => {
    const { AnnotationPanel } = await importComponent<AnnotationPanelModule>(
      "../components/AnnotationPanel",
    );
    const onDeleteAnnotation = vi.fn();
    renderUi(
      <AnnotationPanel
        role="commenter"
        currentUserId="me"
        threadTitle="Feather Step · step 2"
        annotations={[annotation("a1", "me")]}
        onDeleteAnnotation={onDeleteAnnotation}
      />,
    );
    const del = screen.getByRole("button", { name: /delete note/i });
    await userEvent.click(del);
    expect(onDeleteAnnotation).toHaveBeenCalledTimes(1);
    expect(onDeleteAnnotation).toHaveBeenCalledWith("a1");
  });

  it("offers NO delete control on a co-member's annotation", async () => {
    const { AnnotationPanel } = await importComponent<AnnotationPanelModule>(
      "../components/AnnotationPanel",
    );
    renderUi(
      <AnnotationPanel
        role="commenter"
        currentUserId="me"
        threadTitle="Feather Step · step 2"
        annotations={[annotation("a1", "the_author")]}
        onDeleteAnnotation={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /delete note/i })).toBeNull();
    // The note still renders for reading.
    expect(screen.getByText(/settle the sway/i)).toBeInTheDocument();
  });

  it("offers no delete control when onDeleteAnnotation is not wired (standalone host)", async () => {
    const { AnnotationPanel } = await importComponent<AnnotationPanelModule>(
      "../components/AnnotationPanel",
    );
    renderUi(
      <AnnotationPanel
        role="commenter"
        currentUserId="me"
        threadTitle="Feather Step · step 2"
        annotations={[annotation("a1", "me")]}
      />,
    );
    expect(screen.queryByRole("button", { name: /delete note/i })).toBeNull();
  });
});

describe("annotation delete — author gate (standard mode)", () => {
  it("shows the delete control on the viewer's own annotation in the filter-bar list", async () => {
    const { AnnotationPanel } = await importComponent<AnnotationPanelModule>(
      "../components/AnnotationPanel",
    );
    const onDeleteAnnotation = vi.fn();
    renderUi(
      <AnnotationPanel
        role="commenter"
        currentUserId="me"
        annotations={[annotation("a1", "me")]}
        onDeleteAnnotation={onDeleteAnnotation}
      />,
    );
    const del = screen.getByRole("button", { name: /delete note/i });
    await userEvent.click(del);
    expect(onDeleteAnnotation).toHaveBeenCalledTimes(1);
    expect(onDeleteAnnotation).toHaveBeenCalledWith("a1");
  });

  it("offers no delete control on a co-member's annotation in the filter-bar list", async () => {
    const { AnnotationPanel } = await importComponent<AnnotationPanelModule>(
      "../components/AnnotationPanel",
    );
    renderUi(
      <AnnotationPanel
        role="commenter"
        currentUserId="me"
        annotations={[annotation("a1", "the_author")]}
        onDeleteAnnotation={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /delete note/i })).toBeNull();
    expect(screen.getByText(/settle the sway/i)).toBeInTheDocument();
  });
});
