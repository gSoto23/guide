import { describe, expect, it } from "vitest";
import {
  DESTINATIONS,
  MORE_DESTINATIONS,
  currentDestination,
} from "../components/shell/destinations";

/** Destination matching for the shell's current-page mark (feature 015 T007, spec FR-005). */
describe("currentDestination", () => {
  it.each([
    ["/es/inbox", "inbox"],
    ["/en/inbox/copilot", "inbox"],
    ["/es/properties/abc/conversations", "inbox"],
    ["/es/properties/abc/conversations/xyz", "inbox"],
    ["/es/requests", "requests"],
    ["/es/properties", "properties"],
    ["/es/properties/abc/guide/sections/1", "properties"],
    ["/es/properties/abc/analytics", "properties"],
    ["/es/analytics", "analytics"],
    ["/es/calendar", "calendar"],
    ["/es/calendar/stays/abc", "calendar"],
    ["/es/shared-content/block", "shared"],
    ["/es/settings/members", "team"],
    ["/es/settings", "settings"],
    ["/es/settings/plan", "settings"],
  ])("%s belongs to %s", (path, expected) => {
    expect(currentDestination(path)).toBe(expected);
  });

  it.each(["/es/start", "/es/onboarding", "/es", "/es/inboxes", "/es/settingsx"])(
    "%s belongs to no destination",
    (path) => {
      expect(currentDestination(path)).toBeNull();
    },
  );

  it("puts three destinations and More in the bottom bar, the rest under More", () => {
    expect(DESTINATIONS.filter((item) => item.inBar).map((item) => item.id)).toEqual([
      "inbox",
      "requests",
      "properties",
    ]);
    expect(MORE_DESTINATIONS).toEqual(["calendar", "analytics", "shared", "team", "settings"]);
  });

  it("groups the sidebar into daily work and the workspace", () => {
    expect(DESTINATIONS.filter((item) => item.group === "work").map((item) => item.id)).toEqual([
      "inbox",
      "requests",
      "properties",
      "calendar",
      "analytics",
    ]);
  });
});
