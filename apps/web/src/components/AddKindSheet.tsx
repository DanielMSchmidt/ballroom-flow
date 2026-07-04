import type { RegistryKind } from "@weavesteps/domain";
import { isReservedKind, slugifyKind } from "@weavesteps/domain";
import { useCallback, useMemo, useState } from "react";
import { useMessages } from "../i18n";
import { attributesMessages } from "../i18n/messages/attributes";
import {
  Button,
  CheckIcon,
  CloseIcon,
  CUSTOM_KIND_SWATCHES,
  Input,
  Select,
  Sheet,
  Toggle,
} from "../ui";

export interface AddKindSheetProps {
  open?: boolean;
  onClose?: () => void;
  onCreate?: (kind: RegistryKind) => void;
  /**
   * When set, the sheet opens in EDIT mode: fields are pre-filled from this kind
   * and the slug (`kind`) is held stable across the edit — attributes reference a
   * kind by its slug, so re-deriving it from the label would orphan existing
   * data. Persistence is an upsert keyed on the slug (store seam → D1
   * `ON CONFLICT(userId, kind)`), so editing reuses the same `onCreate` channel.
   * The parent should give the sheet a `key` tied to the edit target so a fresh
   * mount re-seeds these initial values.
   */
  initial?: RegistryKind;
}

/** Split a raw add-field string ("low, high") into trimmed, non-empty tokens. */
function tokenize(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Append tokens to `list`, de-duped and preserving order. */
function appendValues(list: string[], tokens: string[]): string[] {
  const next = [...list];
  for (const tok of tokens) if (!next.includes(tok)) next.push(tok);
  return next;
}

/**
 * AddKindSheet — bottom-sheet form for creating OR editing a user-defined
 * attribute kind (US-043 AC-1). On submit, builds a RegistryKind descriptor and
 * calls onCreate (an upsert, so it doubles as the edit save).
 *
 * Beyond the core shape it also captures the data-driven RegistryKind fields
 * (#111 / PLAN §3): a one-line `description` + per-value definitions (which power
 * the registry-derived info-sheet, §4.9), and `roleAware`/`required` flags (which
 * drive Profile's attribute-types manager affordances, frame 1.17). All optional
 * — a kind left blank simply omits them and degrades gracefully.
 *
 * Two deliberate UX choices:
 *  - **Enum values are a chip list, not a comma-blob** — you add one value at a
 *    time (Enter/comma/Add) and remove any with ✕, so the set is always explicit
 *    (no re-parsing a free-text field on every keystroke).
 *  - **Colour is picked from a curated palette** (CUSTOM_KIND_SWATCHES), every
 *    swatch WCAG-AA-legible as chip text on the timeline's sunken well — a free
 *    colour picker could yield an unreadable light value.
 */
export function AddKindSheet({ open = false, onClose, onCreate, initial }: AddKindSheetProps) {
  const t = useMessages(attributesMessages);
  const editing = initial != null;
  // Stored values ("single"/"enum"/…) are locale-independent; only the labels
  // the user sees are translated.
  const cardinalityOptions = [
    { value: "single", label: t.cardinalitySingle },
    { value: "multi", label: t.cardinalityMulti },
  ];
  const valueTypeOptions = [
    { value: "enum", label: t.valueTypeEnum },
    { value: "text", label: t.valueTypeText },
  ];

  // Defaults are derived from `initial` (edit) or fall back to blanks/first
  // swatch (create). Lazy state initializers read them once; the parent re-mounts
  // the sheet (via `key`) when the edit target changes, so these re-seed cleanly.
  const defaultColor = initial?.color ?? CUSTOM_KIND_SWATCHES[0];
  const [label, setLabel] = useState(() => initial?.label ?? "");
  const [color, setColor] = useState(defaultColor);
  const [cardinality, setCardinality] = useState<"single" | "multi">(
    () => initial?.cardinality ?? "single",
  );
  const [valueType, setValueType] = useState(() => initial?.valueType ?? "enum");
  // Enum values as an explicit list of chips (was a comma-separated string).
  const [values, setValues] = useState<string[]>(() => initial?.values ?? []);
  // The in-progress "add a value" field; committed into `values` on Enter/comma
  // /Add, and flushed on submit so a trailing typed value is never dropped.
  const [newValue, setNewValue] = useState("");
  const [description, setDescription] = useState(() => initial?.description ?? "");
  // Per-value definitions keyed by the raw value token. Kept as a flat map so it
  // survives edits to the values list; only entries whose value is still present
  // (and non-empty) are emitted on submit.
  const [valueDefs, setValueDefs] = useState<Record<string, string>>(
    () => initial?.valueDefs ?? {},
  );
  const [roleAware, setRoleAware] = useState(() => initial?.roleAware ?? false);
  const [required, setRequired] = useState(() => initial?.required ?? false);
  // Error is field-scoped so it renders on the input it refers to (the label vs
  // the values field) and clears when that input changes.
  const [error, setError] = useState<{ field: "label" | "values"; msg: string } | null>(null);

  // The colour palette. In edit mode, a stored colour outside the curated set
  // (a legacy free-picked value) is prepended so it stays selectable and isn't
  // silently changed just by opening the editor.
  const swatches = useMemo<readonly string[]>(() => {
    const base = CUSTOM_KIND_SWATCHES;
    if (initial?.color && !base.some((c) => c.toLowerCase() === initial.color.toLowerCase())) {
      return [initial.color, ...base];
    }
    return base;
  }, [initial]);

  const commitValue = useCallback((raw: string) => {
    const tokens = tokenize(raw);
    if (tokens.length === 0) return;
    setValues((prev) => appendValues(prev, tokens));
    setNewValue("");
    setError(null);
  }, []);

  function removeValue(v: string) {
    setValues((prev) => prev.filter((x) => x !== v));
  }

  function handleValueKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commitValue(newValue);
    } else if (e.key === "Backspace" && newValue === "" && values.length > 0) {
      // Quick-remove the last chip when the field is empty (familiar tag-input UX).
      setValues((prev) => prev.slice(0, -1));
    }
  }

  // useCallback keeps handleClose stable across renders — Sheet's useOverlay
  // re-runs its focus effect when onClose changes identity, so an unstable arrow
  // would re-focus the panel on every keystroke and drop input (same pattern as
  // ChoreoList's closeForm handler). Resets to the initial-derived defaults so a
  // reopen (before the parent re-mounts) starts clean.
  const handleClose = useCallback(() => {
    setLabel(initial?.label ?? "");
    setColor(defaultColor);
    setCardinality(initial?.cardinality ?? "single");
    setValueType(initial?.valueType ?? "enum");
    setValues(initial?.values ?? []);
    setNewValue("");
    setDescription(initial?.description ?? "");
    setValueDefs(initial?.valueDefs ?? {});
    setRoleAware(initial?.roleAware ?? false);
    setRequired(initial?.required ?? false);
    setError(null);
    onClose?.();
  }, [onClose, initial, defaultColor]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const trimmedLabel = label.trim();
    if (!trimmedLabel) {
      setError({ field: "label", msg: t.errorLabelRequired });
      return;
    }

    // In edit mode the slug is fixed (it identifies the kind); only creation
    // derives + validates a fresh slug from the label.
    let slug: string;
    if (editing) {
      slug = initial.kind;
    } else {
      slug = slugifyKind(trimmedLabel);
      // A label of only punctuation/symbols (e.g. "!!!") passes the non-empty
      // check above but slugify strips non-alphanumeric chars → empty slug, which
      // would create a kind with an empty `kind` key (invalid). Block it early.
      if (!slug) {
        setError({ field: "label", msg: t.errorInvalidName });
        return;
      }
      if (isReservedKind(slug)) {
        setError({ field: "label", msg: t.errorReservedName });
        return;
      }
    }

    // Flush any value still sitting in the add-field so a trailing typed value
    // (never committed to a chip) isn't silently dropped on submit.
    const finalValues = appendValues(values, tokenize(newValue));

    if (valueType === "enum" && finalValues.length === 0) {
      setError({ field: "values", msg: t.errorEnumValues });
      return;
    }

    // Emit only defs for values still present + non-empty, so a definition typed
    // then later removed from the values list doesn't linger.
    const defs: Record<string, string> = {};
    for (const v of finalValues) {
      const d = valueDefs[v]?.trim();
      if (d) defs[v] = d;
    }
    const trimmedDescription = description.trim();

    const kind: RegistryKind = {
      kind: slug,
      label: trimmedLabel,
      color,
      cardinality,
      valueType,
      values: finalValues,
      builtin: false,
      ...(trimmedDescription ? { description: trimmedDescription } : {}),
      ...(Object.keys(defs).length > 0 ? { valueDefs: defs } : {}),
      ...(roleAware ? { roleAware: true } : {}),
      ...(required ? { required: true } : {}),
    };

    onCreate?.(kind);
    handleClose();
  }

  return (
    <Sheet open={open} onClose={handleClose} title={editing ? t.editKindTitle : t.addKindTitle}>
      <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
        <Input
          label={t.labelField}
          placeholder={t.labelPlaceholder}
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
            setError(null);
          }}
          maxLength={80}
          required
          error={error?.field === "label" ? error.msg : undefined}
        />
        <Input
          label={t.descriptionField}
          placeholder={t.descriptionPlaceholder}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={140}
          hint={t.descriptionHint}
        />

        {/* Colour — a curated, contrast-safe palette (readable on the timeline)
            instead of a free picker that could yield an illegible light value. */}
        <fieldset className="flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 text-2xs font-bold uppercase tracking-wide text-ink-muted">
            {t.colorField}
          </legend>
          <div className="flex flex-wrap gap-2">
            {swatches.map((hex, i) => {
              const selected = color.toLowerCase() === hex.toLowerCase();
              return (
                <button
                  key={hex}
                  type="button"
                  aria-label={t.colorOption(i + 1)}
                  aria-pressed={selected}
                  onClick={() => setColor(hex)}
                  className="flex size-8 items-center justify-center rounded-full border-2 transition-colors"
                  style={{
                    backgroundColor: hex,
                    borderColor: selected ? "var(--bf-ink)" : "transparent",
                  }}
                >
                  {selected && <CheckIcon size={14} className="text-ink-inverse" />}
                </button>
              );
            })}
          </div>
          <p className="text-2xs italic text-ink-faint">{t.colorHint}</p>
        </fieldset>

        <Select
          label={t.cardinalityField}
          options={cardinalityOptions}
          value={cardinality}
          onChange={(e) => setCardinality(e.target.value as "single" | "multi")}
        />
        <Select
          label={t.valueTypeField}
          options={valueTypeOptions}
          value={valueType}
          onChange={(e) => setValueType(e.target.value)}
        />

        {/* Enum values — an explicit chip list (add one at a time, remove with ✕)
            rather than a comma-separated blob. Hidden for free-text kinds. */}
        {valueType === "enum" && (
          <fieldset className="flex flex-col gap-2 border-0 p-0">
            <legend className="text-2xs font-bold uppercase tracking-wide text-ink-muted">
              {t.valuesField}
            </legend>
            {values.length > 0 && (
              <ul className="flex flex-wrap gap-1.5" aria-label={t.valuesField}>
                {values.map((v) => (
                  <li key={v}>
                    <span
                      className="inline-flex items-center gap-1 rounded-[6px] border-[1.5px] px-2 py-1 text-2xs font-bold"
                      style={{
                        background: "var(--bf-surface-sunken)",
                        color,
                        borderColor: color,
                      }}
                    >
                      {v}
                      <button
                        type="button"
                        aria-label={t.removeValue(v)}
                        onClick={() => removeValue(v)}
                        className="-mr-0.5 flex items-center justify-center rounded-full p-0.5 opacity-70 transition-opacity hover:opacity-100"
                        style={{ color }}
                      >
                        <CloseIcon size={12} />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-start gap-2">
              <Input
                label={t.addValueLabel}
                hideLabel
                className="flex-1"
                placeholder={t.valuesPlaceholder}
                value={newValue}
                onChange={(e) => {
                  setNewValue(e.target.value);
                  setError(null);
                }}
                onKeyDown={handleValueKeyDown}
                error={error?.field === "values" ? error.msg : undefined}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => commitValue(newValue)}
                disabled={tokenize(newValue).length === 0}
              >
                {t.add}
              </Button>
            </div>
            <p className="text-2xs italic text-ink-faint">{t.valuesHint}</p>

            {values.length > 0 && (
              <div className="mt-1 flex flex-col gap-2">
                <span className="text-2xs font-bold uppercase tracking-wide text-ink-muted">
                  {t.valueDefsLegend}
                </span>
                {values.map((v) => (
                  <Input
                    key={v}
                    label={t.definitionFor(v)}
                    placeholder={t.definitionPlaceholder(v)}
                    value={valueDefs[v] ?? ""}
                    maxLength={140}
                    onChange={(e) => setValueDefs((prev) => ({ ...prev, [v]: e.target.value }))}
                  />
                ))}
              </div>
            )}
          </fieldset>
        )}

        <Toggle label={t.differsByRole} checked={roleAware} onChange={setRoleAware} />
        <Toggle label={t.requiredToggle} checked={required} onChange={setRequired} />
        <Button type="submit" variant="primary">
          {editing ? t.saveChanges : t.create}
        </Button>
      </form>
    </Sheet>
  );
}
