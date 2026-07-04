import { type ReactNode, useId } from "react";
import { cx } from "./cx";

/**
 * Field — shared label + hint + error scaffold for form controls.
 * Wires up `htmlFor`, `aria-describedby`, and `aria-invalid` so Input
 * and Select stay accessible without each re-implementing it (#8).
 */
export interface FieldRenderArgs {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
}

export interface FieldProps {
  label: string;
  /** Visually hide the label (still read by AT). */
  hideLabel?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: (args: FieldRenderArgs) => ReactNode;
}

export function Field({
  label,
  hideLabel,
  hint,
  error,
  required,
  className,
  children,
}: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const invalid = Boolean(error);
  const describedBy = cx(hint ? hintId : undefined, error ? errorId : undefined) || undefined;

  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label
        htmlFor={id}
        className={cx(
          "text-2xs font-bold uppercase tracking-wide text-ink-muted",
          hideLabel && "bf-sr-only",
        )}
      >
        {label}
        {required && (
          <span aria-hidden="true" className="text-danger">
            {" "}
            *
          </span>
        )}
      </label>
      {children({ id, describedBy, invalid })}
      {hint && !error && (
        <p id={hintId} className="text-2xs text-ink-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-2xs font-semibold text-danger-ink">
          {error}
        </p>
      )}
    </div>
  );
}
