type HudIconKind = "gold" | "units" | "turn" | "map" | "mode" | "guide" | "menu";

export function HudIcon({ kind }: { kind: HudIconKind }) {
  switch (kind) {
    case "gold":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="7" fill="currentColor" opacity="0.25" />
          <circle cx="12" cy="12" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M9.5 12h5M12 9.5v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "units":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="8" cy="9" r="2.1" fill="currentColor" />
          <circle cx="16" cy="8" r="2.1" fill="currentColor" opacity="0.9" />
          <circle cx="12" cy="15.5" r="2.1" fill="currentColor" opacity="0.75" />
          <path d="M5.7 17.5h12.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.7" />
        </svg>
      );
    case "turn":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="7.3" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M12 8v4.2l2.9 2.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "map":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4.5 6.2l4.8-1.7 5.4 2.1 4.8-1.7v12.9l-4.8 1.7-5.4-2.1-4.8 1.7V6.2Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          <path d="M9.3 4.5v12.8M14.7 6.6v12.8" stroke="currentColor" strokeWidth="1.4" opacity="0.9" />
        </svg>
      );
    case "mode":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="5" y="6" width="5.5" height="12" rx="1.8" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <rect x="13.5" y="6" width="5.5" height="12" rx="1.8" fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.85" />
          <circle cx="8" cy="12" r="1.2" fill="currentColor" />
          <circle cx="16.5" cy="12" r="1.2" fill="currentColor" opacity="0.85" />
        </svg>
      );
    case "guide":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6.5 5.5h8a3 3 0 0 1 3 3v10l-4-2.2-4 2.2-4-2.2-4 2.2v-10a3 3 0 0 1 3-3h2Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          <path d="M9 9.3h5.5M9 12h5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "menu":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 7.5h14M5 12h14M5 16.5h14" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        </svg>
      );
  }
}
