/**
 * Guidesk illustrations (feature 015, brand guide §6): flat shapes from the mark's vocabulary
 * (arches, speech bubbles with one square corner, sun circles, simple horizons) on a 240 × 160
 * view box. Shapes carry only classes; each app colors them with its light and dark tokens, so no
 * inline styles are needed under the content security policy (research R8). No text.
 */
export const ILLUSTRATION_CLASSES = [
  "il-bg",
  "il-arena",
  "il-terra",
  "il-terra-soft",
  "il-sol",
  "il-line",
  "il-dash",
  "il-cut",
  "il-stroke",
] as const;

export type IllustrationClass = (typeof ILLUSTRATION_CLASSES)[number];

export type IllustrationShape =
  | { cls: IllustrationClass; d: string }
  | { cls: IllustrationClass; cx: number; cy: number; r: number }
  | { cls: IllustrationClass; x: number; y: number; width: number; height: number; rx: number };

/** The ground: the lower half of a wide ellipse under the horizon. */
export type IllustrationData = readonly IllustrationShape[];

const GROUND: IllustrationShape = { cls: "il-arena", d: "M12 134a108 18 0 0 0 216 0Z" };
const HORIZON: IllustrationShape = { cls: "il-line", d: "M24 134h192" };

/** A speech bubble with the square corner at the bottom left, from its box. */
function bubble(x: number, y: number, width: number, height: number, radius: number): string {
  const r = radius;
  return (
    `M${x} ${y + height}V${y + r}a${r} ${r} 0 0 1 ${r}-${r}h${width - 2 * r}` +
    `a${r} ${r} 0 0 1 ${r} ${r}v${height - 2 * r}a${r} ${r} 0 0 1-${r} ${r}Z`
  );
}

/** An arch standing on the ground line, from its left edge, width, and height. */
function arch(x: number, bottom: number, width: number, height: number): string {
  const r = width / 2;
  return `M${x} ${bottom}V${bottom - height + r}a${r} ${r} 0 0 1 ${width} 0V${bottom}Z`;
}

/** Sign-in: an open doorway with the light on and a speech bubble. */
export const doorScene: IllustrationData = [
  GROUND,
  { cls: "il-sol", cx: 180, cy: 46, r: 22 },
  { cls: "il-terra", d: arch(86, 134, 68, 96) },
  { cls: "il-sol", d: arch(101, 134, 38, 68) },
  { cls: "il-terra-soft", x: 94, y: 134, width: 52, height: 7, rx: 3.5 },
  { cls: "il-terra-soft", d: bubble(24, 40, 54, 38, 12) },
  { cls: "il-bg", cx: 40, cy: 59, r: 3.5 },
  { cls: "il-bg", cx: 51, cy: 59, r: 3.5 },
  { cls: "il-bg", cx: 62, cy: 59, r: 3.5 },
  HORIZON,
];

/** Start and onboarding: a house with its door lit at sunrise. */
export const welcomeScene: IllustrationData = [
  GROUND,
  { cls: "il-sol", cx: 58, cy: 62, r: 26 },
  { cls: "il-terra-soft", x: 98, y: 66, width: 86, height: 68, rx: 6 },
  { cls: "il-terra", d: "M90 72L141 34L192 72Z" },
  { cls: "il-terra", d: arch(128, 134, 26, 34) },
  { cls: "il-sol", d: arch(134, 134, 14, 24) },
  { cls: "il-bg", cx: 114, cy: 94, r: 7 },
  { cls: "il-terra", d: bubble(196, 26, 34, 22, 8) },
  { cls: "il-sol", cx: 213, cy: 37, r: 4 },
  HORIZON,
];

/** No properties yet: an empty plot with the outline of an arch and a plus. */
export const noPropertiesScene: IllustrationData = [
  GROUND,
  { cls: "il-sol", cx: 186, cy: 44, r: 18 },
  { cls: "il-dash", d: "M84 134V86a36 36 0 0 1 72 0V134" },
  { cls: "il-terra", cx: 120, cy: 100, r: 17 },
  { cls: "il-cut", d: "M120 91v18M111 100h18" },
  HORIZON,
];

/** Inbox clear: a large bubble with a check. */
export const inboxClearScene: IllustrationData = [
  GROUND,
  { cls: "il-sol", cx: 170, cy: 50, r: 20 },
  { cls: "il-terra", d: bubble(70, 38, 98, 86, 20) },
  { cls: "il-cut", d: "M99 82l12 12 25-25" },
  { cls: "il-terra-soft", d: bubble(178, 96, 30, 24, 8) },
  HORIZON,
];

/** No requests: a bag under an arch. */
export const noRequestsScene: IllustrationData = [
  GROUND,
  { cls: "il-sol", cx: 192, cy: 40, r: 14 },
  { cls: "il-terra-soft", d: arch(60, 134, 120, 112) },
  { cls: "il-line", d: "M108 92v-6a12 12 0 0 1 24 0v6" },
  { cls: "il-terra", d: "M94 92h52l-4 42h-44Z" },
  HORIZON,
];

/** No data yet: bars growing on the horizon with the sun rising. */
export const noDataScene: IllustrationData = [
  GROUND,
  { cls: "il-sol", d: "M150 134a30 30 0 0 1 60 0Z" },
  { cls: "il-terra-soft", x: 54, y: 110, width: 18, height: 24, rx: 4 },
  { cls: "il-terra-soft", x: 82, y: 94, width: 18, height: 40, rx: 4 },
  { cls: "il-terra", x: 110, y: 74, width: 18, height: 60, rx: 4 },
  { cls: "il-dash", d: "M48 98L132 56" },
  HORIZON,
];

/** Offline: a bubble with a crossed signal under the moon. */
export const offlineScene: IllustrationData = [
  GROUND,
  { cls: "il-sol", d: "M188 26a20 20 0 1 0 14 34a16 16 0 1 1-14-34Z" },
  { cls: "il-terra-soft", d: bubble(62, 44, 100, 76, 18) },
  { cls: "il-stroke", d: "M90 84a32 32 0 0 1 44 0M100 96a16 16 0 0 1 24 0" },
  { cls: "il-terra", cx: 112, cy: 106, r: 4.5 },
  { cls: "il-stroke", d: "M86 68l52 44" },
  HORIZON,
];

/** Unavailable or expired: a closed door under the moon. */
export const unavailableScene: IllustrationData = [
  GROUND,
  { cls: "il-sol", d: "M64 26a18 18 0 1 0 13 31a14 14 0 1 1-13-31Z" },
  { cls: "il-terra-soft", d: arch(86, 134, 68, 96) },
  { cls: "il-terra", d: arch(99, 134, 42, 74) },
  { cls: "il-bg", x: 108, y: 98, width: 24, height: 14, rx: 3 },
  { cls: "il-line", d: "M112 98l8-8 8 8" },
  HORIZON,
];

/** One moment or slow down: a bubble with a clock in front of the sun. */
export const waitScene: IllustrationData = [
  GROUND,
  { cls: "il-sol", cx: 166, cy: 48, r: 20 },
  { cls: "il-terra", d: bubble(78, 40, 84, 84, 20) },
  { cls: "il-bg", cx: 120, cy: 82, r: 24 },
  { cls: "il-stroke", d: "M120 68v14l10 6" },
  HORIZON,
];
