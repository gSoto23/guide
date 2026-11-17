import { describe, expect, it } from "vitest";
import { fakeExtraction } from "../../src/llm/fake.adapter.js";

describe("the fake model's reading of times (LLM_MODE=fake)", () => {
  it("reads am and pm as a 24-hour time", () => {
    const result = fakeExtraction(
      "Casa Colibrí\nEntrada a las 3 pm, salida a las 11 am. Máximo 4 huéspedes.",
    );
    expect(result).toMatchObject({ checkInTime: "15:00", checkoutTime: "11:00", maxGuests: 4 });
  });

  it("keeps a 24-hour time and handles noon and midnight", () => {
    expect(fakeExtraction("Cabin\nCheck-in 16:30. Check-out 12 pm.")).toMatchObject({
      checkInTime: "16:30",
      checkoutTime: "12:00",
    });
    expect(fakeExtraction("Cabin\nCheck-in 12 a.m.")).toMatchObject({ checkInTime: "00:00" });
  });
});
