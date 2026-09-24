export type Competitor = { id: string };

export type SummaryStatus = "skipped" | "pending" | "ready" | "failed";

export type Snapshot = {
  fetchedAt: string;
  title: string;
  tagline: string;
  price: string;
  description: string;
  changed: boolean;
  summary: string | null;
  summaryStatus: SummaryStatus;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const api = {
  addCompetitor(id: string): Promise<Competitor> {
    return request<Competitor>("/api/competitors", { method: "POST", body: JSON.stringify({ id }) });
  },
  removeCompetitor(id: string): Promise<void> {
    return request<void>(`/api/competitors/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
  });
  if (!response.ok) {
    let message = response.statusText || "Request failed";
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === "string" && body.error) message = body.error;
    } catch {
      // empty or non-JSON body
    }
    throw new ApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
