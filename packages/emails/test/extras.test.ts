import { describe, expect, it } from "vitest";
import { renderPush } from "../src/chat/push.js";
import { renderServiceRequestNew } from "../src/extras/notices.js";

/** Feature 008 alerts (T006): host content only, both languages. Fictional data. */
const details = {
  propertyName: "Casa Colibrí",
  extraName: "Recogida en el aeropuerto",
  requestedDate: "2026-12-11",
  requestedTime: "16:30",
  quantity: 2,
  confirmed: false,
  stay: { checkInDate: "2026-12-11", checkoutDate: "2026-12-15" },
  requestsLink: "http://localhost:3000/es/requests",
};

describe("service request alerts (feature 008)", () => {
  it("names the extra, the date, and the stay in Spanish and English, with the link", async () => {
    const es = await renderServiceRequestNew("es", details);
    expect(es.subject).toBe("Nueva solicitud en Casa Colibrí: Recogida en el aeropuerto");
    expect(es.text).toContain("Recogida en el aeropuerto × 2, 2026-12-11 16:30.");
    expect(es.text).toContain("Solicitudes: http://localhost:3000/es/requests");
    const en = await renderServiceRequestNew("en", { ...details, confirmed: true });
    expect(en.text).toContain("It was confirmed automatically by your rules.");
  });

  it("pushes the property and the extra only", () => {
    expect(
      renderPush("es", {
        kind: "service_request",
        propertyName: "Casa Colibrí",
        extraName: "Kayak",
      }),
    ).toEqual({ title: "Casa Colibrí", body: "Nueva solicitud: Kayak" });
  });
});
