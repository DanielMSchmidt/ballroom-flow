import { act } from "@testing-library/react";
import { ATTRIBUTE_REGISTRY, type RegistryKind } from "@weavesteps/domain";
import { afterEach, describe, expect, it } from "vitest";
import { labelValue } from "../components/attribute-display";
import { Profile } from "../components/Profile";
import { usedColumns } from "../components/reading-columns";
import { renderUi, screen, userEvent } from "../test-support/render";
import { getLocale, resetLocaleForTests, setLocale } from "./locale";
import { danceName, localizeKind } from "./vocabulary";

// ─────────────────────────────────────────────────────────────────────────
// i18n — bilingual UI (EN/DE). English is the source language and the test
// default; German comes from the typed catalogs (i18n/messages/*) and the
// vocabulary overlay (i18n/vocabulary.ts). User-authored content (custom
// kinds, notes) is single-language by design and must pass through untouched.
// ─────────────────────────────────────────────────────────────────────────

afterEach(() => resetLocaleForTests());

describe("locale store", () => {
  it("defaults to English and persists a switch to German", () => {
    expect(getLocale()).toBe("en");
    setLocale("de");
    expect(getLocale()).toBe("de");
    expect(localStorage.getItem("bf.locale")).toBe("de");
  });

  it("reflects the active language on <html lang>", () => {
    setLocale("de");
    expect(document.documentElement.lang).toBe("de");
    setLocale("en");
    expect(document.documentElement.lang).toBe("en");
  });
});

describe("vocabulary overlay", () => {
  it("translates builtin kind prose to German and leaves English untouched", () => {
    const de = localizeKind(ATTRIBUTE_REGISTRY.footwork, "de");
    expect(de.label).toBe("Fußarbeit");
    expect(de.valueDefs?.HT).toMatch(/Ferse-Spitze/);
    // Locale-independent identity stays intact — ids, colors, cardinality.
    expect(de.kind).toBe("footwork");
    expect(de.color).toBe(ATTRIBUTE_REGISTRY.footwork.color);
    expect(localizeKind(ATTRIBUTE_REGISTRY.footwork, "en")).toBe(ATTRIBUTE_REGISTRY.footwork);
  });

  it("passes user-defined kinds through untranslated (single-language by design)", () => {
    const custom: RegistryKind = {
      kind: "energy",
      label: "Energy",
      color: "#123456",
      cardinality: "single",
      valueType: "text",
      builtin: false,
    };
    expect(localizeKind(custom, "de")).toBe(custom);
  });

  it("localizes dance names (Foxtrot → Slowfox)", () => {
    expect(danceName("foxtrot", "en")).toBe("Foxtrot");
    expect(danceName("foxtrot", "de")).toBe("Slowfox");
    expect(danceName("waltz", "de")).toBe("Langsamer Walzer");
  });

  it("localizes value labels + column heads through the display helpers", () => {
    expect(labelValue("rise", "commence")).toBe("Commence");
    setLocale("de");
    expect(labelValue("rise", "commence")).toBe("Beginn");
    // A custom kind's stored value still renders verbatim (humanized only).
    expect(labelValue("energy", "very_high")).toBe("very high");
    const cols = usedColumns([
      { kind: "direction", value: "forward", count: 1 } as never,
      { kind: "rise", value: "commence", count: 1 } as never,
    ]);
    expect(cols.map((c) => c.label)).toEqual(["Schritt", "Heben"]);
  });
});

describe("chrome LanguageToggle (landing header + desktop rail)", () => {
  it("switches the locale live and persists it", async () => {
    const { LanguageToggle } = await import("../ui");
    renderUi(<LanguageToggle />);
    await userEvent.click(screen.getByRole("radio", { name: "DE" }));
    expect(getLocale()).toBe("de");
    expect(localStorage.getItem("bf.locale")).toBe("de");
    // The group label follows the locale it just set.
    expect(screen.getByRole("radiogroup", { name: "Sprache" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "EN" }));
    expect(getLocale()).toBe("en");
  });

  it("is pinned to the AppShell desktop rail", async () => {
    const { AppShell } = await import("../ui");
    renderUi(
      <AppShell nav={[]} current="choreo" onNavigate={() => {}}>
        <p>content</p>
      </AppShell>,
    );
    expect(screen.getByRole("radiogroup", { name: "Language" })).toBeInTheDocument();
  });
});

describe("Profile language switcher", () => {
  it("switches the UI to German live and back", async () => {
    renderUi(<Profile plan="free" ownedRoutineCount={2} />);
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Deutsch" }));
    expect(screen.getByRole("button", { name: "Speichern" })).toBeInTheDocument();
    expect(screen.getByText("Gratis-Tarif")).toBeInTheDocument();
    expect(localStorage.getItem("bf.locale")).toBe("de");
    await userEvent.click(screen.getByRole("radio", { name: "English" }));
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
  });

  it("re-renders vocabulary consumers on switch (registry prose)", () => {
    renderUi(<Profile plan="free" ownedRoutineCount={0} />);
    // The attribute-types manager lists builtin kinds off the registry.
    expect(screen.getByText("Rise & Fall")).toBeInTheDocument();
    act(() => setLocale("de"));
    expect(screen.getByText("Heben & Senken")).toBeInTheDocument();
  });
});
