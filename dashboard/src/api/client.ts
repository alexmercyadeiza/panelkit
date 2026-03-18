const BASE = "/api";

export async function api<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    ...options,
  });

  const data = await res.json();

  if (!res.ok) {
    throw new ApiError(data.error || "Request failed", res.status, data);
  }

  return data as T;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}
