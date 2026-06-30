import type { ReactNode, SelectHTMLAttributes } from "react";
import { cx } from "./cx";
import { Field } from "./Field";
import { ChevronDownIcon } from "./icons";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> {
  label: string;
  hideLabel?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  options: SelectOption[];
  placeholder?: string;
}

/**
 * Select — native <select> styled to the system, with a decorative
 * chevron. Native control keeps it keyboard- and AT-friendly (#7, #8)
 * and gives mobile a platform picker. 44px min height (#3).
 */
export function Select({
  label,
  hideLabel,
  hint,
  error,
  required,
  options,
  placeholder,
  className,
  ...rest
}: SelectProps) {
  return (
    <Field label={label} hideLabel={hideLabel} hint={hint} error={error} required={required}>
      {({ id, describedBy, invalid }) => (
        <div className="relative">
          <select
            id={id}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            required={required}
            className={cx(
              "w-full appearance-none rounded-md border bg-surface-sunken pl-3.5 pr-10 text-sm text-ink",
              "min-h-[var(--bf-touch-target)] outline-none transition-colors",
              invalid ? "border-danger" : "border-border-strong",
              className,
            )}
            style={{ transitionDuration: "var(--bf-motion-fast)" }}
            {...rest}
          >
            {placeholder && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {options.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted">
            <ChevronDownIcon size={16} />
          </span>
        </div>
      )}
    </Field>
  );
}
