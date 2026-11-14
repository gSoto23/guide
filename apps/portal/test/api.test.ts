import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch } from "../lib/api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiFetch (T028)", () => {
  it("returns JSON on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    await expect(apiFetch("/api/v1/me")).resolves.toEqual({ ok: true });
  });

  it("throws ApiError with the problem code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: "step_up_required", methods: ["passkey"] }), {
            status: 403,
          }),
      ),
    );
    await expect(apiFetch("/api/v1/x", { method: "POST", body: {} })).rejects.toMatchObject({
      problem: { status: 403, code: "step_up_required", methods: ["passkey"] },
    });
  });

  it("maps network failures to the network code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("offline"))),
    );
    const error = await apiFetch("/api/v1/me").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).problem.code).toBe("network");
  });
});
