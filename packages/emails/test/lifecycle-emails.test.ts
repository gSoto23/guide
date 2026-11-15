import { describe, expect, it } from "vitest";
import {
  maskEmail,
  renderAccountDeletionScheduled,
  renderEmailChangeCode,
  renderEmailChanged,
  renderMemberRemoved,
  renderOwnershipTransferred,
  renderRoleChanged,
  renderWorkspaceDeletionScheduled,
} from "../src/index.js";

describe("lifecycle emails (US5)", () => {
  it("renders team notices in both languages", async () => {
    expect((await renderMemberRemoved("es", "Casa Marco")).subject).toBe(
      "Ya no tienes acceso a Casa Marco",
    );
    const role = await renderRoleChanged("en", {
      workspaceName: "Casa Marco",
      from: "agent",
      to: "admin",
    });
    expect(role.text).toContain("from agent to admin");
    const owner = await renderOwnershipTransferred("es", {
      workspaceName: "Casa Marco",
      newOwnerName: "Lucía",
      recipientIsNewOwner: false,
    });
    expect(owner.text).toContain("Sigues en el workspace como administrador");
  });

  it("states the deletion date", async () => {
    const date = new Date("2026-12-14T00:00:00Z");
    const workspace = await renderWorkspaceDeletionScheduled("en", {
      workspaceName: "A",
      purgeAfter: date,
    });
    // The plain-text version uppercases headings.
    expect(workspace.text.toLowerCase()).toContain("december 14, 2026");
    const account = await renderAccountDeletionScheduled("es", date);
    expect(account.text.toLowerCase()).toContain("14 de diciembre de 2026");
  });

  it("sends the code to the new address and a masked notice to the old one", async () => {
    expect((await renderEmailChangeCode("en", "123456")).text).toContain("123456");
    const changed = await renderEmailChanged("es", maskEmail("ana@example.com"));
    expect(changed.text).toContain("a•••@example.com");
    expect(changed.text).not.toContain("ana@example.com");
  });
});
