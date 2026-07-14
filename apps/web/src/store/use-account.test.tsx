// WEP-0002 (phase 4) — the React hook seam over the account store, at the
// component layer (jsdom + Testing Library + vitest-axe). Verifies that a
// component reading the bookmark set / own family notes through `useLibraryRefs`
// / `useOwnFamilyNotes` re-renders reactively off the store's `subscribe` (so a
// bookmark added through the seam shows INSTANTLY, with no refetch dependency),
// and that the rendered surface is axe-clean.
import { describe, expect, it } from "vitest";
import { axeCheck, renderUi, screen, userEvent } from "../test-support/render";
import type { AccountStore, OwnFamilyNote } from "./account";
import { useLibraryRefs, useOwnFamilyNotes } from "./use-account";

/**
 * A minimal in-memory AccountStore stand-in that drives the hooks reactively —
 * the same subscribe/notify contract `openAccount` returns, without a socket. It
 * lets the component test exercise the reactive hook wiring in isolation (the
 * live doc + offline behavior is covered by account.test.ts at the seam level).
 */
function fakeStore(): AccountStore {
  const listeners = new Set<() => void>();
  let refs: string[] = [];
  let notes: OwnFamilyNote[] = [];
  const notify = (): void => {
    for (const fn of listeners) fn();
  };
  return {
    readLibraryRefs: () => refs,
    readOwnFamilyNotes: () => notes,
    addBookmark: (r) => {
      if (!refs.includes(r)) {
        refs = [...refs, r];
        notify();
      }
    },
    removeBookmark: (r) => {
      refs = refs.filter((x) => x !== r);
      notify();
    },
    createFamilyNote: (input) => {
      notes = [
        ...notes,
        {
          id: `note-${notes.length}`,
          kind: input.kind,
          text: input.text,
          figureType: input.figureType,
          danceScope: input.danceScope,
        },
      ];
      notify();
    },
    deleteFamilyNote: (id) => {
      notes = notes.filter((n) => n.id !== id);
      notify();
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    syncState: () => "live",
    pendingSyncCount: () => 0,
    close: () => listeners.clear(),
  };
}

/** A tiny surface that reads the bookmark set through the seam and adds one. */
function LibrarySurface({ store }: { store: AccountStore }): React.JSX.Element {
  const refs = useLibraryRefs(store);
  const notes = useOwnFamilyNotes(store);
  return (
    <main>
      <h1>My library</h1>
      <ul aria-label="bookmarked figures">
        {refs.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <button type="button" onClick={() => store.addBookmark("fig-1")}>
        Add to my library
      </button>
      <ul aria-label="my family notes">
        {notes.map((n) => (
          <li key={n.id}>{n.text}</li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() =>
          store.createFamilyNote({
            figureType: "feather",
            danceScope: "all",
            kind: "lesson",
            text: "head left",
          })
        }
      >
        Author note
      </button>
    </main>
  );
}

describe("useLibraryRefs / useOwnFamilyNotes (WEP-0002 seam hooks)", () => {
  it("shows a bookmark INSTANTLY after add through the seam (no refetch dependency)", async () => {
    const store = fakeStore();
    renderUi(<LibrarySurface store={store} />);

    expect(screen.queryByText("fig-1")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /add to my library/i }));
    // Reactive read from the doc seam — no server round-trip, appears immediately.
    expect(screen.getByText("fig-1")).toBeInTheDocument();
  });

  it("shows an authored family note reactively (offline-capable compose path)", async () => {
    const store = fakeStore();
    renderUi(<LibrarySurface store={store} />);

    await userEvent.click(screen.getByRole("button", { name: /author note/i }));
    expect(screen.getByText("head left")).toBeInTheDocument();
  });

  it("is axe-clean", async () => {
    const store = fakeStore();
    store.addBookmark("global:waltz:natural_turn");
    const { container } = renderUi(<LibrarySurface store={store} />);
    expect(await axeCheck(container)).toHaveNoViolations();
  });
});
