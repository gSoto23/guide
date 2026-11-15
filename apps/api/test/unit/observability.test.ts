import type { ErrorEvent } from "@sentry/node";
import { describe, expect, it } from "vitest";
import { describeError, scrubEvent, stripQuery } from "@guidesk/observability";

describe("scrubEvent (T025, SEC-06)", () => {
  it("drops cookies, headers, bodies, and user emails", () => {
    const event = scrubEvent({
      type: undefined,
      request: {
        method: "POST",
        url: "/api/v1/me",
        cookies: { a: "b" },
        headers: { cookie: "x" },
        data: "{}",
      },
      user: { id: "user-1", email: "ana@example.com" },
    } as ErrorEvent);
    expect(event.request).toEqual({ method: "POST", url: "/api/v1/me" });
    expect(event.user).toEqual({ id: "user-1" });
  });
});

describe("error scrubbing (T103 finding D11)", () => {
  it("drops query strings and extra data, and redacts query parameters from messages", () => {
    const event = scrubEvent({
      type: undefined,
      request: { method: "GET", url: "/api/auth/callback/google?code=secret&state=s" },
      extra: { body: "x" },
      exception: {
        values: [
          {
            type: "DrizzleQueryError",
            value: 'Failed query: insert into "session"\nparams: tok,1.2.3.4',
          },
        ],
      },
      breadcrumbs: [{ category: "http", data: { url: "/x?code=1", method: "GET", body: "b" } }],
    } as ErrorEvent);
    expect(event.request).toEqual({ method: "GET", url: "/api/auth/callback/google" });
    expect(event.extra).toBeUndefined();
    expect(event.exception?.values?.[0]?.value).toBe(
      'Failed query: insert into "session"\nparams: [redacted]',
    );
    expect(event.breadcrumbs?.[0]?.data).toEqual({ url: "/x", method: "GET" });
  });

  it("describes errors without bound parameters", () => {
    const error = new Error("Failed query: select 1\nparams: ana@example.com", {
      cause: { code: "23505", message: "duplicate key" },
    });
    const text = describeError(error);
    expect(text).not.toContain("ana@example.com");
    expect(text).toContain("23505");
  });
});

describe("invitation tokens in URLs (T103, US3–US5 review)", () => {
  it("replaces the token in invitation paths, and leaves workspace invitation IDs alone", () => {
    const token = "A".repeat(43);
    expect(stripQuery(`/api/v1/invitations/${token}/accept`)).toBe(
      "/api/v1/invitations/[token]/accept",
    );
    expect(stripQuery(`/es/invite/${token}?x=1`)).toBe("/es/invite/[token]");
    const id = "0b9d8a4e-58cf-4c45-9f43-1a2b3c4d5e6f";
    expect(stripQuery(`/api/v1/workspaces/${id}/invitations/${id}`)).toBe(
      `/api/v1/workspaces/${id}/invitations/${id}`,
    );
  });
});
