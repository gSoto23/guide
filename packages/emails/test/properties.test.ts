import { describe, expect, it } from "vitest";
import { renderFeedFailing, renderImportFinished, renderPmsReconnect } from "../src/index.js";

/** Feature 002 emails (T078, T097, contracts/emails.md). All values are fictional. */
const PORTAL = "https://app.example.test/es/properties/5f0c";

describe("properties.feed_failing (FR-024)", () => {
  it("names the property and channel, the last read, and links to the portal only", async () => {
    const email = await renderFeedFailing("es", {
      propertyName: "Casa Colibrí",
      channelName: "Airbnb",
      lastSuccessAt: new Date("2027-01-10T00:00:00Z"),
      link: PORTAL,
    });
    expect(email.subject).toBe("El calendario de Airbnb de Casa Colibrí no se actualiza");
    expect(email.text).toContain("10 de enero de 2027");
    expect(email.text).toContain(PORTAL);
    const english = await renderFeedFailing("en", {
      propertyName: "Casa Colibrí",
      channelName: "Booking.com",
      lastSuccessAt: null,
      link: PORTAL,
    });
    expect(english.subject).toContain("isn't updating");
    expect(english.html).not.toMatch(/\.ics|token/);
  });
});

describe("properties.import_finished (FR-029)", () => {
  it("shows counts and at most five translated reasons", async () => {
    const email = await renderImportFinished("en", {
      source: "Beds24",
      created: 12,
      needsDetails: 3,
      failed: 2,
      skipped: 1,
      reasonCodes: [
        "plan_limit",
        "reconnect_pms",
        "plan_limit",
        "provider_error",
        "invalid_time_zone",
        "missing_facts",
        "invalid_row",
      ],
      link: PORTAL,
    });
    expect(email.subject).toBe("Your Beds24 import finished");
    expect(email.text).toContain("Created: 12. Need details: 3. Failed: 2. Skipped: 1.");
    expect(email.text).toContain("The property limit was reached");
    expect(email.text).not.toContain("The row has errors");
    const spanish = await renderImportFinished("es", {
      source: "CSV",
      created: 23,
      needsDetails: 0,
      failed: 2,
      skipped: 0,
      reasonCodes: [],
      link: PORTAL,
    });
    expect(spanish.subject).toBe("Terminó tu importación desde CSV");
    expect(spanish.text).not.toContain("Motivos principales");
  });
});

describe("properties.pms_reconnect (FR-035)", () => {
  it("names the provider and account, never a credential", async () => {
    const email = await renderPmsReconnect("es", {
      providerName: "Hostex",
      accountLabel: "Cuenta de prueba",
      lastRefreshAt: new Date("2027-01-09T00:00:00Z"),
      link: "https://app.example.test/es/settings/integrations",
    });
    expect(email.subject).toBe("Vuelve a conectar Hostex para mantener tus estancias al día");
    expect(email.text).toContain("Cuenta: Cuenta de prueba.");
    expect(email.text).toContain("9 de enero de 2027");
  });
});
