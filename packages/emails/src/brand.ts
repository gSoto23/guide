/**
 * Brand colors for emails (docs/brand/README.md §3.1, direction "A · Bienvenida"). Emails can't use
 * CSS variables, so the values live here; every text pair meets WCAG AA on the light background.
 */
export const BRAND = {
  /** Terracota: the mark and buttons (white text on it: 5.49:1). */
  primary: "#B4452A",
  /** Terracota oscuro: links (7.89:1 on white). */
  link: "#8E3420",
  /** Carbón: text (15.73:1 on white). */
  text: "#2B211C",
  /** Muted text for footnotes. */
  muted: "#66574D",
  /** White: the page background (was cal until 2026-11-24). */
  background: "#FFFFFF",
  /** Line between the message and its footer. */
  line: "#E6DCD1",
} as const;
