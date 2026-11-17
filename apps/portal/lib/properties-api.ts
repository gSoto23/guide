/**
 * Typed client for the workspace-scoped routes of feature 002 (T031), over `apiFetch`. Every
 * route lives under `/api/v1/workspaces/{workspaceId}` (contracts/http-api.md).
 */
import { ApiError, apiFetch, type Problem } from "./api";

export function workspacePath(workspaceId: string, path: string): string {
  return `/api/v1/workspaces/${encodeURIComponent(workspaceId)}${path}`;
}

export interface WriteOptions {
  /** Sends an Idempotency-Key, so a retried creation does not create twice. */
  idempotent?: boolean;
  signal?: AbortSignal;
}

function idempotencyHeaders(options: WriteOptions): Record<string, string> {
  return options.idempotent ? { "idempotency-key": crypto.randomUUID() } : {};
}

/** Calls for one workspace. */
export function workspaceApi(workspaceId: string) {
  const url = (path: string) => workspacePath(workspaceId, path);
  return {
    get: <T>(path: string, signal?: AbortSignal) => apiFetch<T>(url(path), { signal }),
    post: <T>(path: string, body?: unknown, options: WriteOptions = {}) =>
      apiFetch<T>(url(path), {
        method: "POST",
        body: body ?? {},
        headers: idempotencyHeaders(options),
        signal: options.signal,
      }),
    put: <T>(path: string, body: unknown) => apiFetch<T>(url(path), { method: "PUT", body }),
    patch: <T>(path: string, body: unknown) => apiFetch<T>(url(path), { method: "PATCH", body }),
    delete: <T>(path: string, body?: unknown) =>
      apiFetch<T>(url(path), { method: "DELETE", ...(body !== undefined ? { body } : {}) }),
  };
}

export type WorkspaceApi = ReturnType<typeof workspaceApi>;

/** The problem of an API error, or null for anything else. */
export function problemOf(error: unknown): Problem | null {
  return error instanceof ApiError ? error.problem : null;
}

/** A number member of a problem body, such as `limit` in `plan_limit_reached`. */
export function problemNumber(problem: Problem | null, key: string): number | undefined {
  const value = problem?.[key];
  return typeof value === "number" ? value : undefined;
}

/** A string member of a problem body, such as `reason` in `feed_rejected`. */
export function problemString(problem: Problem | null, key: string): string | undefined {
  const value = problem?.[key];
  return typeof value === "string" ? value : undefined;
}
