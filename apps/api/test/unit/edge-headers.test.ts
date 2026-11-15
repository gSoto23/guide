import type { FastifyReply, FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import { createEdgeHook, readEdgeInfo } from "../../src/common/edge-headers.js";

function request(headers: Record<string, string>, url = "/api/v1/me"): FastifyRequest {
  return { headers, url } as unknown as FastifyRequest;
}

function reply() {
  const state: { status?: number; body?: unknown } = {};
  const r = {
    status(code: number) {
      state.status = code;
      return r;
    },
    header() {
      return r;
    },
    async send(body: unknown) {
      state.body = body;
      return r;
    },
  };
  return { reply: r as unknown as FastifyReply, state };
}

describe("edge headers (T027, research R7)", () => {
  const secret = "edge-secret-value";

  it("trusts viewer location only with the matching secret", () => {
    const headers = {
      "x-guidesk-edge": secret,
      "cloudfront-viewer-country": "CR",
      "cloudfront-viewer-city": "Samara",
    };
    expect(readEdgeInfo(request(headers), secret)).toEqual({ country: "CR", city: "Samara" });
    expect(
      readEdgeInfo(request({ ...headers, "x-guidesk-edge": "wrong" }), secret),
    ).toBeUndefined();
    expect(readEdgeInfo(request(headers), undefined)).toBeUndefined();
  });

  it("refuses requests that bypass CloudFront when enforced, except the health check", async () => {
    const hook = createEdgeHook({ secret, enforce: true });
    const blocked = reply();
    await hook(request({}), blocked.reply);
    expect(blocked.state.status).toBe(403);

    const health = reply();
    await hook(request({}, "/api/health"), health.reply);
    expect(health.state.status).toBeUndefined();
  });

  it("does not block locally when not enforced", async () => {
    const hook = createEdgeHook({ secret: undefined, enforce: false });
    const local = reply();
    await hook(request({}), local.reply);
    expect(local.state.status).toBeUndefined();
  });
});
