/**
 * Portal API client (T028). The browser calls same-origin `/api/*`: CloudFront routes it to the
 * API in AWS (ADR-0009), and Next.js rewrites it to the local API in development.
 * Errors arrive as application/problem+json with a stable `code` (contracts/http-api.md).
 */
export interface Problem {
  status: number;
  code: string;
  title?: string;
  detail?: string;
  fields?: Record<string, string[]>;
  methods?: string[];
  /** Feature-specific members, for example `{limit, used}` or `{reason}` (feature 002). */
  [extra: string]: unknown;
}

export class ApiError extends Error {
  constructor(readonly problem: Problem) {
    super(problem.detail ?? problem.code);
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

async function parseProblem(response: Response): Promise<Problem> {
  try {
    const body = (await response.json()) as Partial<Problem>;
    return { ...body, status: response.status, code: body.code ?? "internal_error" };
  } catch {
    return { status: response.status, code: "internal_error" };
  }
}

/** Calls the API from the browser with the session cookie. */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
        ...options.headers,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch {
    throw new ApiError({ status: 0, code: "network" });
  }
  if (!response.ok) {
    throw new ApiError(await parseProblem(response));
  }
  // 204, and a 202 that only says "accepted" (extraction submit), have no body.
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
