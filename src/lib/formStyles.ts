/**
 * Canonical form control styles.
 *
 * RULE: Always use these instead of defining local inputStyle / selectStyle.
 * Selects MUST use formSelect (never formInput) so they stay visually
 * identical to inputs: same height, same padding, custom chevron, no native OS chrome.
 *
 * Two scales:
 *  - compact  → modals, panels, small cards  (fontSize 16, padding 6px 10px)
 *  - standard → full-page forms, settings    (fontSize 16, padding 0.65rem 0.9rem)
 *
 * NOTE: fontSize 16px minimum on all inputs prevents iOS Safari from
 * auto-zooming the viewport when an input is focused.
 */

import type { CSSProperties } from "react";

// ─── Shared SVG chevron arrow ─────────────────────────────────────────────────

const CHEVRON_SVG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238888a0' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")";

// ─── Compact (modals, panels) ─────────────────────────────────────────────────

export const formInputCompact: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "6px 10px",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-surface-2)",
  color: "var(--color-text)",
  fontSize: 16,
  outline: "none",
};

export const formSelectCompact: CSSProperties = {
  ...formInputCompact,
  appearance: "none",
  backgroundImage: CHEVRON_SVG,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 8px center",
  paddingRight: 28,
  cursor: "pointer",
};

// ─── Standard (full-page forms, settings) ────────────────────────────────────

export const formInputStandard: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "0.65rem 0.9rem",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-surface-2)",
  color: "var(--color-text)",
  fontSize: 16,
  outline: "none",
};

export const formSelectStandard: CSSProperties = {
  ...formInputStandard,
  appearance: "none",
  backgroundImage: CHEVRON_SVG,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 0.75rem center",
  paddingRight: "2.2rem",
  cursor: "pointer",
};
