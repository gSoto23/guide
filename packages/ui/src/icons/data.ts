/**
 * The Guidesk icon set (feature 015, brand guide §5): 24 × 24 grid with 2 px padding, drawn with
 * 2 px round strokes in the current text color. Shapes echo the mark: the speech bubble with one
 * square corner, arches, and soft rounded rectangles. One export per icon keeps client bundles to
 * the icons they use (research R3).
 */
export type IconShape =
  | { d: string }
  | { cx: number; cy: number; r: number }
  | { x: number; y: number; width: number; height: number; rx: number };

export type IconData = readonly IconShape[];

/** The mark's bubble: rounded corners except the square one at the bottom left. */
const BUBBLE = "M4 20V8a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4Z";

// Guide sections -------------------------------------------------------------------------------

export const door: IconData = [
  { d: "M6 21V10a6 6 0 0 1 12 0v11" },
  { d: "M3 21h18" },
  { d: "M14.5 15h.01" },
];
export const wifi: IconData = [
  { d: "M3.5 9.5a12 12 0 0 1 17 0" },
  { d: "M6.8 12.9a7.5 7.5 0 0 1 10.4 0" },
  { d: "M10 16.2a3 3 0 0 1 4 0" },
  { d: "M12 19.5h.01" },
];
export const rules: IconData = [
  { x: 5, y: 3, width: 14, height: 18, rx: 3 },
  { d: "M9 8h6" },
  { d: "M9 12h6" },
  { d: "M9 16h3" },
];
export const appliance: IconData = [
  { x: 4, y: 2.5, width: 16, height: 19, rx: 3 },
  { cx: 12, cy: 13.5, r: 4 },
  { d: "M8 6.5h.01" },
  { d: "M11 6.5h.01" },
];
export const amenity: IconData = [
  { d: "M11 3l1.9 5.1L18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9Z" },
  { d: "M19 15v6" },
  { d: "M16 18h6" },
];
export const car: IconData = [
  { d: "M5 11l1.6-4.2a2 2 0 0 1 1.9-1.3h7a2 2 0 0 1 1.9 1.3L19 11" },
  { x: 3, y: 11, width: 18, height: 6, rx: 2 },
  { d: "M7 17v2" },
  { d: "M17 17v2" },
  { d: "M7 14h.01" },
  { d: "M17 14h.01" },
];
export const pin: IconData = [
  { d: "M12 21s-7-6.1-7-11.5a7 7 0 0 1 14 0C19 14.9 12 21 12 21Z" },
  { cx: 12, cy: 9.5, r: 2.5 },
];
export const emergency: IconData = [
  { d: "M7 17v-5a5 5 0 0 1 10 0v5" },
  { x: 5, y: 17, width: 14, height: 4, rx: 1 },
  { d: "M12 2.5v2" },
  { d: "M4.5 5.5l1.4 1.4" },
  { d: "M19.5 5.5l-1.4 1.4" },
];
export const checkout: IconData = [
  { x: 4, y: 7, width: 16, height: 13, rx: 2.5 },
  { d: "M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" },
  { d: "M9 11v5" },
  { d: "M15 11v5" },
];
export const gift: IconData = [
  { x: 3, y: 8, width: 18, height: 4, rx: 1 },
  { d: "M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8" },
  { d: "M12 8v13" },
  { d: "M12 8C11 5 9.5 3.5 8 3.5a2.25 2.25 0 0 0 0 4.5" },
  { d: "M12 8c1-3 2.5-4.5 4-4.5a2.25 2.25 0 0 1 0 4.5" },
];
export const compass: IconData = [{ cx: 12, cy: 12, r: 9 }, { d: "M15.5 8.5l-2 5-5 2 2-5Z" }];
export const bookmark: IconData = [{ d: "M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16l-6-4Z" }];

// Navigation ---------------------------------------------------------------------------------

export const inbox: IconData = [{ d: BUBBLE }, { d: "M8.5 10h7" }, { d: "M8.5 14h4" }];
export const bag: IconData = [
  { d: "M5 8h14l-1 12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1Z" },
  { d: "M9 8V7a3 3 0 0 1 6 0v1" },
];
export const house: IconData = [
  { d: "M3.5 11L12 3.5l8.5 7.5" },
  { d: "M6 9v11h12V9" },
  { d: "M10 20v-4a2 2 0 0 1 4 0v4" },
];
export const chart: IconData = [
  { d: "M4 20.5h16" },
  { d: "M7 17v-5" },
  { d: "M12 17V7" },
  { d: "M17 17V9" },
];
export const layers: IconData = [
  { d: "M12 3l9 4.5-9 4.5-9-4.5Z" },
  { d: "M3 12l9 4.5 9-4.5" },
  { d: "M3 16.5l9 4.5 9-4.5" },
];
export const people: IconData = [
  { cx: 9, cy: 8, r: 3.5 },
  { d: "M2.5 20a6.5 6.5 0 0 1 13 0" },
  { d: "M16 4.5a3.5 3.5 0 0 1 0 7" },
  { d: "M18 14.5a6.5 6.5 0 0 1 3.5 5.5" },
];
export const sliders: IconData = [
  { d: "M4 6h9" },
  { d: "M17 6h3" },
  { cx: 15, cy: 6, r: 2 },
  { d: "M4 12h3" },
  { d: "M11 12h9" },
  { cx: 9, cy: 12, r: 2 },
  { d: "M4 18h11" },
  { d: "M19 18h1" },
  { cx: 17, cy: 18, r: 2 },
];
export const more: IconData = [
  { x: 4, y: 4, width: 6, height: 6, rx: 1.5 },
  { x: 14, y: 4, width: 6, height: 6, rx: 1.5 },
  { x: 4, y: 14, width: 6, height: 6, rx: 1.5 },
  { x: 14, y: 14, width: 6, height: 6, rx: 1.5 },
];

// Inbox reasons ------------------------------------------------------------------------------

export const wrench: IconData = [
  {
    d: "M15 4a5 5 0 0 0-4.6 6.9L4 17.3V20h2.7l6.4-6.4A5 5 0 0 0 20 9l-3 3-3-1-1-3 3-3a5 5 0 0 0-1-1Z",
  },
];
export const frown: IconData = [
  { d: BUBBLE },
  { d: "M9.5 15a3.5 3.5 0 0 1 5 0" },
  { d: "M9.5 10h.01" },
  { d: "M14.5 10h.01" },
];
export const coin: IconData = [
  { cx: 12, cy: 12, r: 9 },
  {
    d: "M14.5 9.5c-.4-.9-1.4-1.5-2.5-1.5-1.4 0-2.5.8-2.5 2s1.1 1.6 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2c-1.1 0-2.1-.6-2.5-1.5",
  },
  { d: "M12 6.5V8" },
  { d: "M12 16v1.5" },
];
export const calendar: IconData = [
  { x: 3.5, y: 5, width: 17, height: 15.5, rx: 3 },
  { d: "M3.5 10h17" },
  { d: "M8 3v4" },
  { d: "M16 3v4" },
];
export const scale: IconData = [
  { d: "M12 4v16" },
  { d: "M8 20h8" },
  { d: "M5 7h14" },
  { d: "M5 7l-3 6a3 3 0 0 0 6 0Z" },
  { d: "M19 7l-3 6a3 3 0 0 0 6 0Z" },
];
export const question: IconData = [
  { d: BUBBLE },
  { d: "M9.8 9.6a2.3 2.3 0 0 1 4.4.9c0 1.5-2.2 1.8-2.2 3" },
  { d: "M12 16.3h.01" },
];
export const pencil: IconData = [
  { d: "M4 20l1-4L16 5a2.1 2.1 0 0 1 3 3L8 19Z" },
  { d: "M14 7l3 3" },
];
export const shield: IconData = [
  { d: "M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6Z" },
  { d: "M12 8v4" },
  { d: "M12 15.5h.01" },
];
export const gauge: IconData = [{ d: "M4 18a8 8 0 0 1 16 0" }, { d: "M12 18l4-4.5" }];
export const cloudOff: IconData = [
  { d: "M7.5 18.5h9a4 4 0 0 0 .6-8A5.5 5.5 0 0 0 6.6 11a3.75 3.75 0 0 0 .9 7.5Z" },
  { d: "M3 3l18 18" },
];
export const person: IconData = [{ cx: 12, cy: 8, r: 4 }, { d: "M4 21a8 8 0 0 1 16 0" }];

// Actions and status -------------------------------------------------------------------------

export const plus: IconData = [{ d: "M12 5v14" }, { d: "M5 12h14" }];
export const message: IconData = [{ d: BUBBLE }, { d: "M12 9v6" }, { d: "M9 12h6" }];
export const copy: IconData = [
  { x: 8, y: 8, width: 12, height: 12, rx: 2.5 },
  { d: "M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" },
];
export const key: IconData = [
  { cx: 7.5, cy: 16.5, r: 4.5 },
  { d: "M10.7 13.3L20 4" },
  { d: "M16 8l3 3" },
  { d: "M13.5 10.5l2 2" },
];
export const chat: IconData = [
  { d: BUBBLE },
  { d: "M8.5 12h.01" },
  { d: "M12 12h.01" },
  { d: "M15.5 12h.01" },
];
export const phone: IconData = [
  {
    d: "M5 4h3.5L10 8.5 8 10a11 11 0 0 0 6 6l1.5-2 4.5 1.5V19a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1Z",
  },
];
export const globe: IconData = [
  { cx: 12, cy: 12, r: 9 },
  { d: "M3 12h18" },
  { d: "M12 3a14 14 0 0 1 0 18" },
  { d: "M12 3a14 14 0 0 0 0 18" },
];
export const chevron: IconData = [{ d: "M9 6l6 6-6 6" }];
export const external: IconData = [
  { d: "M14 4h6v6" },
  { d: "M20 4l-9 9" },
  { d: "M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" },
];
export const check: IconData = [{ d: "M5 12.5l4.5 4.5L19 7.5" }];
export const clock: IconData = [{ cx: 12, cy: 12, r: 9 }, { d: "M12 7v5l3 2" }];
export const lock: IconData = [
  { x: 5, y: 10.5, width: 14, height: 10, rx: 2.5 },
  { d: "M8 10.5V8a4 4 0 0 1 8 0v2.5" },
];
export const link: IconData = [
  { d: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" },
  { d: "M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" },
];
export const qr: IconData = [
  { x: 4, y: 4, width: 6, height: 6, rx: 1.5 },
  { x: 14, y: 4, width: 6, height: 6, rx: 1.5 },
  { x: 4, y: 14, width: 6, height: 6, rx: 1.5 },
  { d: "M14 14h3" },
  { d: "M20 14v3" },
  { d: "M14 18v2h3" },
  { d: "M20 20h.01" },
];
