const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4002";

export { API_URL };

export function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  const token = typeof window !== "undefined" ? sessionStorage.getItem("accessToken") : null;
  const headers = new Headers(options?.headers);
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  // Default to no HTTP cache — every API call returns dynamic data (live quotes,
  // tracking metrics, social feeds, search results). Browser caching the first
  // response and serving it on later page opens was the root cause of "/admin and
  // /admin/tracking sometimes show no data until I refresh." Callers can override
  // by passing { cache: "default" } if they ever need cached behavior.
  return fetch(`${API_URL}${path}`, { cache: "no-store", ...options, headers });
}
