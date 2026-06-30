import type { RegistryKind } from "@ballroom/domain";
import { isReservedKind, slugifyKind } from "@ballroom/domain";
import { useCallback, useMemo, useState } from "react";
import { Button, Input, Select, Sheet, Toggle } from "../ui";

export interface AddKindSheetProps {
  open?: boolean;
  onClose?: () => void;
  onCreate?: (kind: RegistryKind) => void;
}

const CARDINALITY_OPTIONS = [
  { value: "single", label: "Single" },
  { value: "multi", label: "Multi" },
];

const VALUE_TYPE_OPTIONS = [
  { value: "enum", label: "Enum (fixed list)" },
  { value: "text", label: "Text (free-form)" },
];

/**
 * AddKindSheet — bottom-sheet form for creating a user-defined attribute kind
 * (US-043 AC-1). On submit, builds a RegistryKind descriptor and calls onCreate.
 *
 * Beyond the core shape it also captures the data-driven RegistryKind fields
 * (#111 / PLAN §3): a one-line `description` + per-value definitions (which power
 * the registry-derived info-sheet, §4.9), and `roleAware`/`required` flags (which
 * drive Profile's attribute-types manager affordances, frame 1.17). All optional
 * — a kind left blank simply omits them and degrades gracefully.
 */
export function AddKindSheet({ open = false, onClose, onCreate }: AddKindSheetProps) {
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("#888888");
  const [cardinality, setCardinality] = useState<"single" | "multi">("single");
  const [valueType, setValueType] = useState("enum");
  const [values, setValues] = useState("");
  const [description, setDescription] = useState("");
  // Per-value definitions keyed by the raw value token. Kept as a flat map so it
  // survives edits to the comma-separated `values` field; only entries whose
  // value is still present (and non-empty) are emitted on submit.
  const [valueDefs, setValueDefs] = useState<Record<string, string>>({});
  const [roleAware, setRoleAware] = useState(false);
  const [required, setRequired] = useState(false);
  // Error is field-scoped so it renders on the input it refers to (the label vs
  // the values field) and clears when that input changes.
  const [error, setError] = useState<{ field: "label" | "values"; msg: string } | null>(null);

  // The currently-parsed enum values, deduped + in entry order — drives the
  // per-value definition inputs below the Values field (enum kinds only).
  const parsedValues = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of values
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)) {
      if (!seen.has(v)) {
        seen.add(v);
        out.push(v);
      }
    }
    return out;
  }, [values]);

  // useCallback keeps handleClose stable across renders — Sheet's useOverlay
  // re-runs its focus effect when onClose changes identity, so an unstable arrow
  // would re-focus the panel on every keystroke and drop input (same pattern as
  // ChoreoList's closeForm handler).
  const handleClose = useCallback(() => {
    setLabel("");
    setColor("#888888");
    setCardinality("single");
    setValueType("enum");
    setValues("");
    setDescription("");
    setValueDefs({});
    setRoleAware(false);
    setRequired(false);
    setError(null);
    onClose?.();
  }, [onClose]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const trimmedLabel = label.trim();
    if (!trimmedLabel) {
      setError({ field: "label", msg: "Label is required" });
      return;
    }

    const slug = slugifyKind(trimmedLabel);
    // A label of only punctuation/symbols (e.g. "!!!") passes the non-empty
    // check above but slugify strips non-alphanumeric chars → empty slug, which
    // would create a kind with an empty `kind` key (invalid). Block it early.
    if (!slug) {
      setError({ field: "label", msg: "Enter a valid name" });
      return;
    }
    if (isReservedKind(slug)) {
      setError({ field: "label", msg: "That name is reserved" });
      return;
    }

    if (valueType === "enum" && parsedValues.length === 0) {
      setError({ field: "values", msg: "At least one value is required for enum kinds" });
      return;
    }

    // Emit only defs for values still present + non-empty, so a definition typed
    // then later removed from the values list doesn't linger.
    const defs: Record<string, string> = {};
    for (const v of parsedValues) {
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
      values: parsedValues,
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
    <Sheet open={open} onClose={handleClose} title="Add attribute kind">
      <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
        <Input
          label="Label"
          placeholder="e.g. Energy"
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
          label="Description"
          placeholder="e.g. How much drive the step carries"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={140}
          hint="One line shown in the attribute info sheet (optional)"
        />
        <Input
          label="Color"
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
        <Select
          label="Cardinality"
          options={CARDINALITY_OPTIONS}
          value={cardinality}
          onChange={(e) => setCardinality(e.target.value as "single" | "multi")}
        />
        <Select
          label="Value type"
          options={VALUE_TYPE_OPTIONS}
          value={valueType}
          onChange={(e) => setValueType(e.target.value)}
        />
        <Input
          label="Values"
          placeholder="e.g. low, medium, high"
          value={values}
          onChange={(e) => {
            setValues(e.target.value);
            setError(null);
          }}
          hint="Comma-separated list (used for enum kinds)"
          error={error?.field === "values" ? error.msg : undefined}
        />
        {valueType === "enum" && parsedValues.length > 0 && (
          <fieldset className="flex flex-col gap-2 border-0 p-0">
            <legend className="mb-1 text-2xs font-bold uppercase tracking-wide text-ink-muted">
              Value definitions (optional)
            </legend>
            {parsedValues.map((v) => (
              <Input
                key={v}
                label={`Definition for "${v}"`}
                placeholder={`What "${v}" means`}
                value={valueDefs[v] ?? ""}
                maxLength={140}
                onChange={(e) => setValueDefs((prev) => ({ ...prev, [v]: e.target.value }))}
              />
            ))}
          </fieldset>
        )}
        <Toggle label="Differs by leader / follower" checked={roleAware} onChange={setRoleAware} />
        <Toggle
          label="Required (a core slot for every step)"
          checked={required}
          onChange={setRequired}
        />
        <Button type="submit" variant="primary">
          Create
        </Button>
      </form>
    </Sheet>
  );
}
