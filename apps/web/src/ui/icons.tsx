// biome-ignore-all lint/a11y/noSvgWithoutTitle: every icon here is decorative
// and applies aria-hidden via the shared `base()` spread; meaning is carried by
// a sibling label (DESIGN-PRINCIPLES #8). The spread defeats Biome's static
// check, so the rule is suppressed for this icon-only module.
import type { SVGProps } from "react";

/**
 * Icon set — thin stroke style matching the prototype's visual
 * language (Ballroom Builder.dc.html). All icons are decorative:
 * they render `aria-hidden` and rely on a sibling label for meaning
 * (DESIGN-PRINCIPLES #8). Size via width/height (default 18).
 */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 18, ...rest }: IconProps): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
    ...rest,
  };
}

export const PlusIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const CloseIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const ChevronRightIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);

export const ChevronDownIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

export const ChevronLeftIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

export const CheckIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 12l5 5 9-10" />
  </svg>
);

export const EditIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z" />
  </svg>
);

export const ShareIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
  </svg>
);

/** Four vertical bars — the "choreo / steps" mark used throughout. */
export const StepsIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 5v14M9.5 5v14M14 5v14M18.5 5v14" />
  </svg>
);

export const JournalIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 5.5A2 2 0 0 1 6 4h13v15H6a2 2 0 0 0-2 2z" />
    <path d="M19 19v2H6" />
  </svg>
);

export const PersonIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </svg>
);

export const LibraryIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 4h5v16H4zM10 4h5v16h-5zM16 5l4 1-3 14-4-1z" />
  </svg>
);

/** Globe — global library scope. */
export const GlobeIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" />
  </svg>
);

/** Branch / fork — variant scope (carries lineage). */
export const BranchIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="6" cy="6" r="2.5" />
    <circle cx="6" cy="18" r="2.5" />
    <circle cx="18" cy="8" r="2.5" />
    <path d="M6 8.5v7M6 15a8 8 0 0 1 8-7" />
  </svg>
);

/** Pencil-square — custom scope (your own from scratch). */
export const CustomIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 4h10M4 4v16h16V10" />
    <path d="M16 3.5a2 2 0 0 1 3 3L11 14l-3.5.5L8 11z" />
  </svg>
);

export const WarningIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3l9 16H3z" />
    <path d="M12 10v4M12 17h.01" />
  </svg>
);

export const InfoIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </svg>
);

/** Cloud with a slash — offline / data-unavailable state (#20). */
export const OfflineIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M17.5 17.5H7a4 4 0 0 1-.7-7.94A6 6 0 0 1 17 8" />
    <path d="M3 3l18 18" />
  </svg>
);

export const UndoIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M9 7L4 12l5 5" />
    <path d="M4 12h11a5 5 0 0 1 0 10h-1" />
  </svg>
);
