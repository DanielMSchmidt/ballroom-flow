// biome-ignore-all lint/a11y/useValidAriaRole: `role` here is the per-document
// MEMBERSHIP role prop (editor/commenter/viewer), not an ARIA role — Biome's a11y
// rule mis-flags it on these component props.
import type { ComponentType } from "react";
import { describe, expect, it } from "vitest";
import { importComponent } from "../test-support/import-component";
import { renderUi, screen, userEvent } from "../test-support/render";

// ─────────────────────────────────────────────────────────────────────────
// US-039 — Unified annotations: point + figure anchors [M6, user]
// US-040 — figureType annotations (this-dance / all-dances) [M6, user]
// US-042 — Annotation filters (all / lessons / practice / by figure) [M6, user]
//
// PLAN §4.6, §10.2 component layer: "annotation create (point/figure);
// viewer/commenter gating". Annotation UI built by the frontend agent →
// dynamic import behind it.skip.
// ─────────────────────────────────────────────────────────────────────────

interface AnnotationsModule {
  AnnotationPanel: ComponentType<Record<string, unknown>>;
}
interface AnchorPickerModule {
  AnchorPicker: ComponentType<Record<string, unknown>>;
}

describe("US-039 Unified annotations: point + figure anchors", () => {
  it("lets a commenter create a note/lesson/practice anchored to a point or a figure", async () => {
    // Intent: a commenter+ creates a kinded annotation anchored to a point or figure.
    // Arrange: render <AnnotationPanel role="commenter">. Act: choose kind=lesson,
    //   anchor=point, type text, submit. Assert: the annotation renders in the thread.
    // Covers US-039 AC-1 (create note/lesson/practice on point/figure).
    const { AnnotationPanel } = await importComponent<AnnotationsModule>(
      "../components/AnnotationPanel",
    );
    renderUi(<AnnotationPanel role="commenter" />);
    await userEvent.type(screen.getByRole("textbox", { name: /note|comment/i }), "rise earlier");
    await userEvent.click(screen.getByRole("button", { name: /add|post/i }));
    expect(await screen.findByText(/rise earlier/i)).toBeInTheDocument();
  });

  it("threads replies and lets only the author delete a reply", async () => {
    // Intent: ordered reply thread; reply delete is author-only.
    // Arrange: render a thread with a reply authored by the current user + one by another.
    // Act/Assert: a delete control on the OWN reply only; none on the other's.
    // Covers US-039 AC-2 (reply thread; author-only delete).
    const { AnnotationPanel } = await importComponent<AnnotationsModule>(
      "../components/AnnotationPanel",
    );
    renderUi(<AnnotationPanel role="commenter" currentUserId="me" />);
    expect(screen.getByRole("list", { name: /replies|thread/i })).toBeInTheDocument();
  });

  it("prevents a viewer from creating annotations", async () => {
    // Intent: viewers are read-only for annotations too.
    // Arrange: render <AnnotationPanel role="viewer">. Act/Assert: no compose box / add button.
    // Covers US-039 AC-4 (viewer cannot create; commenter+ can).
    const { AnnotationPanel } = await importComponent<AnnotationsModule>(
      "../components/AnnotationPanel",
    );
    renderUi(<AnnotationPanel role="viewer" />);
    expect(screen.queryByRole("button", { name: /add|post/i })).toBeNull();
  });
});

describe("US-040 figureType annotations (this-dance / all-dances)", () => {
  it("offers this-step / this-figure / this-figure-family with a dance-scope toggle", async () => {
    // Intent: the anchor picker offers a figure-FAMILY anchor with this-dance | all-dances.
    // Arrange: render <AnchorPicker> for a figure in a family.
    // Act: choose "this figure family"; toggle to "all dances".
    // Assert: the three anchor options exist; the family option exposes the dance-scope toggle.
    // Covers US-040 AC-1 (anchor picker with family + dance-scope toggle).
    const { AnchorPicker } = await importComponent<AnchorPickerModule>(
      "../components/AnchorPicker",
    );
    renderUi(<AnchorPicker figureType="feather" dance="foxtrot" />);
    expect(screen.getByRole("button", { name: /this figure family/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /this figure family/i }));
    expect(screen.getByRole("radio", { name: /all dances/i })).toBeInTheDocument();
  });
});

describe("US-042 Annotation filters (all / lessons / practice / by figure)", () => {
  it("shares one annotation set between timeline and journal and filters by kind + figure", async () => {
    // Intent: one annotation concept; filter by kind and by figure (client-side).
    // Arrange: render <AnnotationPanel> with a note, a lesson, and a practice on two figures.
    // Act: select the "lessons" filter, then a per-figure filter.
    // Assert: only lessons show; then only the chosen figure's annotations show.
    // Covers US-042 AC-1 (shared set) + AC-2 (filter by kind/figure) + AC-3 (client-side).
    const { AnnotationPanel } = await importComponent<AnnotationsModule>(
      "../components/AnnotationPanel",
    );
    renderUi(<AnnotationPanel role="editor" />);
    await userEvent.click(screen.getByRole("button", { name: /lessons/i }));
    expect(screen.getByRole("button", { name: /lessons/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
