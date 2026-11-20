/**
 * The portal's destinations (feature 015, contract portal-shell). Three sit in the phone and tablet
 * bottom bar next to More (four columns keep every Spanish label whole at 320 px, research R13);
 * the rest live under More there, and all show in the wide-screen sidebar.
 */
export type DestinationId =
  "inbox" | "requests" | "properties" | "analytics" | "shared" | "team" | "settings";

export interface Destination {
  id: DestinationId;
  /** Path after the locale. */
  path: string;
  /** Key under `workspace.nav`. */
  label: DestinationId;
  /** Sidebar group: the daily work first, then the workspace. */
  group: "work" | "workspace";
  /** Shown in the bottom bar; otherwise under More. */
  inBar: boolean;
}

export const DESTINATIONS: readonly Destination[] = [
  { id: "inbox", path: "/inbox", label: "inbox", group: "work", inBar: true },
  { id: "requests", path: "/requests", label: "requests", group: "work", inBar: true },
  { id: "properties", path: "/properties", label: "properties", group: "work", inBar: true },
  { id: "analytics", path: "/analytics", label: "analytics", group: "work", inBar: false },
  { id: "shared", path: "/shared-content", label: "shared", group: "workspace", inBar: false },
  { id: "team", path: "/settings/members", label: "team", group: "workspace", inBar: false },
  { id: "settings", path: "/settings", label: "settings", group: "workspace", inBar: false },
];

export const MORE_DESTINATIONS: readonly DestinationId[] = DESTINATIONS.filter(
  (destination) => !destination.inBar,
).map((destination) => destination.id);

function under(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`);
}

/** The destination a portal path belongs to, or null for pages outside the navigation. */
export function currentDestination(pathname: string): DestinationId | null {
  // Drop the locale prefix (`/es/inbox` → `/inbox`).
  const path = pathname.replace(/^\/[a-z]{2}(?=\/|$)/, "") || "/";
  if (under(path, "/inbox")) return "inbox";
  if (/^\/properties\/[^/]+\/conversations(\/|$)/.test(path)) return "inbox";
  if (under(path, "/requests")) return "requests";
  if (under(path, "/properties")) return "properties";
  if (under(path, "/analytics")) return "analytics";
  if (under(path, "/shared-content")) return "shared";
  if (under(path, "/settings/members")) return "team";
  if (under(path, "/settings")) return "settings";
  return null;
}
