export class ApiError extends Error {
  readonly status: number;
  readonly retryAfter: number | null;

  constructor(message: string, status: number, retryAfter: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}.`;
    try {
      const payload = (await response.json()) as { detail?: unknown };
      if (typeof payload.detail === "string") message = payload.detail;
    } catch {
      // Keep the status-based fallback.
    }
    const retryHeader = response.headers.get("Retry-After");
    const retryAfter = retryHeader ? Number(retryHeader) : null;
    throw new ApiError(message, response.status, Number.isFinite(retryAfter) ? retryAfter : null);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export interface User {
  username: string;
}

export const api = {
  me(signal?: AbortSignal): Promise<User> {
    return request<User>("/api/auth/me", { signal });
  },
  login(username: string, password: string): Promise<User> {
    return request<User>("/api/auth/login", {
      method: "POST",
      body: { username, password },
    });
  },
  logout(): Promise<void> {
    return request<void>("/api/auth/logout", { method: "POST" });
  },
  health(): Promise<{ status: string; service: string }> {
    return request("/api/health");
  },
};
