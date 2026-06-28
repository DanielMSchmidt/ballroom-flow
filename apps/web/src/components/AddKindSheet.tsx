import type { RegistryKind } from "@ballroom/domain";
import { isReservedKind, slugifyKind } from "@ballroom/domain";
import { useCallback, useState } from "react";
import { Button, Input, Select, Sheet } from "../ui";

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
 */
export function AddKindSheet({ open = false, onClose, onCreate }: AddKindSheetProps) {
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("#888888");
  const [cardinality, setCardinality] = useState<"single" | "multi">("single");
  const [valueType, setValueType] = useState("enum");
  const [values, setValues] = useState("");
  // Error is field-scoped so it renders on the input it refers to (the label vs
  // the values field) and clears when that input changes.
  const [error, setError] = useState<{ field: "label" | "values"; msg: string } | null>(null);

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

    const parsedValues = values
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

    if (valueType === "enum" && parsedValues.length === 0) {
      setError({ field: "values", msg: "At least one value is required for enum kinds" });
      return;
    }

    const kind: RegistryKind = {
      kind: slug,
      label: trimmedLabel,
      color,
      cardinality,
      valueType,
      values: parsedValues,
      builtin: false,
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
        <Button type="submit" variant="primary">
          Create
        </Button>
      </form>
    </Sheet>
  );
}
