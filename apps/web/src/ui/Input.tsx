import type { InputHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import { Field } from "./Field";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  hideLabel?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
}

/**
 * Input — single-line text field with an accessible label/hint/error
 * via the shared Field scaffold (#8). 44px min height (#3).
 */
export function Input({ label, hideLabel, hint, error, required, className, ...rest }: InputProps) {
  return (
    <Field label={label} hideLabel={hideLabel} hint={hint} error={error} required={required}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          required={required}
          className={cx(
            "w-full rounded-md border bg-surface-sunken px-3.5 text-sm text-ink",
            "min-h-[var(--bf-touch-target)] placeholder:text-ink-faint",
            "outline-none transition-colors",
            invalid ? "border-danger" : "border-border-strong",
            className,
          )}
          style={{ transitionDuration: "var(--bf-motion-fast)" }}
          {...rest}
        />
      )}
    </Field>
  );
}
