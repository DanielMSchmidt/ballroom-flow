import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMessages } from "../i18n";
import { uiMessages } from "../i18n/messages/ui";
import { cx } from "./cx";
import { CloseIcon } from "./icons";

export type ToastTone = "neutral" | "success" | "warning" | "danger";

export interface ToastOptions {
  tone?: ToastTone;
  /** Optional action (e.g. "Undo"). */
  action?: { label: string; onClick: () => void };
  /** ms before auto-dismiss. Default 4000; 0 keeps it until dismissed. */
  duration?: number;
}

interface ToastRecord extends ToastOptions {
  id: number;
  message: string;
}

interface ToastApi {
  /** Show a toast. Returns its id (for manual dismissal). */
  show: (message: string, opts?: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/**
 * useToast — fire confirmations. Standard messages (DESIGN-PRINCIPLES
 * #16) are emitted by callers, e.g.:
 *   toast.show("Made this figure yours")              // copy-on-write
 *   toast.show("Undone", { action: { label: "Redo", … } })
 *   toast.show("You've reached 3 routines on the free plan", { tone: "warning", … })  // quota upsell
 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

const TONE_STYLE: Record<ToastTone, { bg: string; fg: string }> = {
  neutral: { bg: "var(--bf-surface-inverse)", fg: "var(--bf-ink-inverse)" },
  success: { bg: "var(--bf-success-ink)", fg: "var(--bf-ink-inverse)" },
  warning: { bg: "var(--bf-warning-ink)", fg: "var(--bf-ink-inverse)" },
  danger: { bg: "var(--bf-danger-ink)", fg: "var(--bf-ink-inverse)" },
};

/**
 * ToastProvider — owns the toast stack and a polite ARIA live region
 * so every toast is announced to assistive tech (#8, #16). Toasts are
 * dismissible and auto-dismiss; they never trap focus (#16).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const msg = useMessages(uiMessages);
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const idRef = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (message: string, opts: ToastOptions = {}) => {
      const id = ++idRef.current;
      const duration = opts.duration ?? 4000;
      setToasts((prev) => [...prev, { id, message, ...opts }]);
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const t = timers.current;
    return () => {
      for (const timer of t.values()) clearTimeout(timer);
      t.clear();
    };
  }, []);

  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Live region: polite so it doesn't interrupt; assertive tones
          could be added per-toast if needed. Always in the DOM so AT
          observes mutations. */}
      <section
        className="pointer-events-none fixed inset-x-0 flex flex-col items-center gap-2 px-4"
        style={{
          bottom: "calc(var(--bf-touch-target) + env(safe-area-inset-bottom) + 1.5rem)",
          zIndex: "var(--bf-z-toast)",
        }}
        aria-label={msg.notifications}
      >
        <div aria-live="polite" aria-atomic="false" className="contents">
          {toasts.map((t) => {
            const tone = TONE_STYLE[t.tone ?? "neutral"];
            return (
              <output
                key={t.id}
                className={cx(
                  "pointer-events-auto flex max-w-md items-center gap-3 rounded-lg px-4 py-2.5",
                  "text-xs font-semibold",
                )}
                style={{
                  background: tone.bg,
                  color: tone.fg,
                  boxShadow: "var(--bf-shadow-toast)",
                  animation: "bf-pop-in var(--bf-motion-base) var(--bf-ease-out)",
                }}
              >
                <span className="flex-1">{t.message}</span>
                {t.action && (
                  <button
                    type="button"
                    onClick={() => {
                      t.action?.onClick();
                      dismiss(t.id);
                    }}
                    className="shrink-0 font-bold underline underline-offset-2"
                  >
                    {t.action.label}
                  </button>
                )}
                <button
                  type="button"
                  aria-label={msg.dismissNotification}
                  onClick={() => dismiss(t.id)}
                  className="-mr-1 inline-flex size-6 shrink-0 items-center justify-center opacity-70"
                >
                  <CloseIcon size={13} />
                </button>
              </output>
            );
          })}
        </div>
      </section>
    </ToastContext.Provider>
  );
}
