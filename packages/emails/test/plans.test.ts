import { describe, expect, it } from "vitest";
import { renderPlanAiUsage, renderPlanTopUpUsedUp } from "../src/plans/notices.js";

/** Plan emails (feature 011 FR-009; feature 019 FR-013): counts only, both languages. */
const usage = {
  workspaceName: "Hospedajes Colibrí",
  used: 500,
  limit: 500,
  resetsAt: "1 de diciembre de 2026, 00:00 UTC",
  planLink: "http://localhost:3000/es/settings/plan",
};

describe("plan.ai_usage", () => {
  it("says the AI pauses at 100% without a top-up, and how to ask for one", async () => {
    const es = await renderPlanAiUsage("es", { ...usage, threshold: 100 });
    expect(es.subject).toBe("Hospedajes Colibrí: se acabaron las respuestas de IA de este mes");
    expect(es.text).toContain("los huéspedes reciben una respuesta de espera");
    expect(es.text).toContain("una recarga mantiene la IA respondiendo");
    expect(es.text).toContain("Plan y límites: http://localhost:3000/es/settings/plan");
  });

  it("says the AI keeps answering at 100% when a top-up has replies left", async () => {
    const es = await renderPlanAiUsage("es", { ...usage, threshold: 100, topUpLeft: 238 });
    expect(es.text).toContain("La IA sigue respondiendo con tu recarga (quedan 238 respuestas)");
    expect(es.text).not.toContain("respuesta de espera");
    const en = await renderPlanAiUsage("en", { ...usage, threshold: 100, topUpLeft: 238 });
    expect(en.text).toContain("The AI keeps answering with your top-up (238 replies left)");
  });

  it("warns at 80% with the replies left", async () => {
    const en = await renderPlanAiUsage("en", { ...usage, used: 400, threshold: 80 });
    expect(en.subject).toBe("Hospedajes Colibrí: 80% of this month's AI replies used");
    expect(en.text).toContain("400 of its 500 AI replies for this month (100 left)");
    expect(en.text).toContain("a top-up keeps the AI answering");
  });
});

describe("plan.top_up_used_up", () => {
  const details = {
    workspaceName: "Hospedajes Colibrí",
    granted: 250,
    monthLeft: 0,
    otherTopUpsLeft: 0,
    resetsAt: "1 Dec 2026, 00:00 UTC",
    planLink: "http://localhost:3000/en/settings/plan",
  };

  it("says the AI is paused when nothing is left", async () => {
    const en = await renderPlanTopUpUsedUp("en", details);
    expect(en.subject).toBe("Hospedajes Colibrí: an AI reply top-up is used up");
    expect(en.text).toContain("Your top-up of 250 AI replies is used up.");
    expect(en.text).toContain("until 1 Dec 2026, 00:00 UTC guests get a holding reply");
  });

  it("names what still answers otherwise", async () => {
    const es = await renderPlanTopUpUsedUp("es", { ...details, otherTopUpsLeft: 100 });
    expect(es.subject).toBe("Hospedajes Colibrí: se acabó una recarga de respuestas de IA");
    expect(es.text).toContain(
      "La IA sigue respondiendo con tus otras recargas (quedan 100 respuestas).",
    );
    const month = await renderPlanTopUpUsedUp("es", { ...details, monthLeft: 40 });
    expect(month.text).toContain("A este mes todavía le quedan 40 respuestas.");
  });
});
