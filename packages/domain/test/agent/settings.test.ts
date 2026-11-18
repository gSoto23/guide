import { describe, expect, it } from "vitest";
import {
  AUTONOMY_TOPICS,
  levelFor,
  normalizeAutonomy,
  resolveAssistantSettings,
  uniformAutonomy,
  type AssistantSettingsRow,
} from "../../src/agent/settings.js";

const row = (patch: Partial<AssistantSettingsRow> = {}): AssistantSettingsRow => ({
  autonomy: null,
  tone: "casual",
  quietEnabled: false,
  quietStart: null,
  quietEnd: null,
  contactsMode: "all",
  contactMembershipIds: [],
  ownGroups: [],
  instruction: null,
  ...patch,
});

describe("assistant settings (feature 007 research R8)", () => {
  it("uses the defaults when there is no row", () => {
    const settings = resolveAssistantSettings(null, null);
    expect(settings.autonomy).toEqual(uniformAutonomy("draft"));
    expect(settings.tone).toBe("casual");
    expect(settings.quietHours).toBeNull();
    expect(settings.contacts).toEqual({ mode: "all" });
    expect(settings.sources.autonomy).toBe("workspace");
    expect(settings.instructions).toEqual({ workspace: null, property: null });
  });

  it("applies the workspace's values to a property that follows it", () => {
    const workspace = row({
      autonomy: { wifi: "auto", parking: "full_auto" },
      tone: "formal",
      quietEnabled: true,
      quietStart: "22:00:00",
      quietEnd: "07:00:00",
      contactsMode: "selected",
      contactMembershipIds: ["m1"],
      instruction: { versionId: "v1", text: "Sign as the team." },
    });
    const property = row({ autonomy: uniformAutonomy("full_auto"), ownGroups: [] });
    const settings = resolveAssistantSettings(workspace, property);
    expect(settings.autonomy.wifi).toBe("auto");
    expect(settings.autonomy.parking).toBe("full_auto");
    expect(settings.autonomy.arrival).toBe("draft");
    expect(settings.tone).toBe("formal");
    expect(settings.quietHours).toEqual({ start: "22:00", end: "07:00" });
    expect(settings.contacts).toEqual({ mode: "selected", membershipIds: ["m1"] });
    expect(settings.sources).toEqual({
      autonomy: "workspace",
      tone: "workspace",
      quiet_hours: "workspace",
      contacts: "workspace",
    });
  });

  it("uses the property's own groups and keeps the rest from the workspace", () => {
    const workspace = row({ autonomy: uniformAutonomy("auto"), tone: "formal" });
    const property = row({
      autonomy: uniformAutonomy("draft"),
      tone: "casual",
      ownGroups: ["autonomy"],
      instruction: { versionId: "v2", text: "Walk to the beach." },
    });
    const settings = resolveAssistantSettings(
      { ...workspace, instruction: { versionId: "v1", text: "Sign as the team." } },
      property,
    );
    expect(settings.autonomy).toEqual(uniformAutonomy("draft"));
    expect(settings.sources.autonomy).toBe("property");
    expect(settings.tone).toBe("formal");
    expect(settings.sources.tone).toBe("workspace");
    expect(settings.instructions.workspace?.versionId).toBe("v1");
    expect(settings.instructions.property?.versionId).toBe("v2");
  });

  it("keeps a property's own values while it follows the workspace", () => {
    const own = row({ autonomy: uniformAutonomy("auto"), ownGroups: [] });
    expect(resolveAssistantSettings(null, own).autonomy).toEqual(uniformAutonomy("draft"));
    expect(resolveAssistantSettings(null, { ...own, ownGroups: ["autonomy"] }).autonomy).toEqual(
      uniformAutonomy("auto"),
    );
  });

  it("reads missing or invalid levels as draft and unknown topics as other", () => {
    const map = normalizeAutonomy({ wifi: "auto", parking: "always", extra: "auto" });
    expect(map.wifi).toBe("auto");
    expect(map.parking).toBe("draft");
    expect(Object.keys(map)).toEqual([...AUTONOMY_TOPICS]);
    expect(levelFor({ ...map, other: "full_auto" }, "spa")).toBe("full_auto");
    expect(levelFor(map, "wifi")).toBe("auto");
  });

  it("ignores quiet hours that are off, incomplete, or empty", () => {
    expect(
      resolveAssistantSettings(
        row({ quietEnabled: false, quietStart: "22:00", quietEnd: "07:00" }),
        null,
      ).quietHours,
    ).toBeNull();
    expect(
      resolveAssistantSettings(
        row({ quietEnabled: true, quietStart: "22:00", quietEnd: null }),
        null,
      ).quietHours,
    ).toBeNull();
    expect(
      resolveAssistantSettings(
        row({ quietEnabled: true, quietStart: "08:00", quietEnd: "08:00" }),
        null,
      ).quietHours,
    ).toBeNull();
  });
});
