import { describe, expect, it } from "vitest";
import { aiState, askMoreHref, share } from "../lib/plan";

/** Plan helpers (feature 011; top-ups from feature 019 US4). */
describe("AI reply state", () => {
  it("is ok below 80%, a warning from 80%, and paused or on a top-up when used up", () => {
    expect(aiState({ used: 399, limit: 500 }, 0)).toBe("ok");
    expect(aiState({ used: 400, limit: 500 }, 0)).toBe("warning");
    expect(aiState({ used: 499, limit: 500 }, 0)).toBe("warning");
    expect(aiState({ used: 500, limit: 500 }, 0)).toBe("paused");
    expect(aiState({ used: 512, limit: 500 }, 238)).toBe("topUp");
    expect(aiState({ used: 499, limit: 500 }, 238)).toBe("warning");
  });

  it("caps meters at 100%", () => {
    expect(share(238, 250)).toBe(95);
    expect(share(600, 500)).toBe(100);
  });

  it("builds a mail link with an encoded subject", () => {
    expect(askMoreHref("planes@example.com", "Más respuestas de IA para el workspace 1")).toBe(
      "mailto:planes@example.com?subject=M%C3%A1s%20respuestas%20de%20IA%20para%20el%20workspace%201",
    );
  });
});
