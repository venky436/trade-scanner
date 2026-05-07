const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4002";

export { API_URL };

// Endpoints that should NOT trigger an auto-logout on 401. The auth flow
// itself (login / refresh / me / logout) reasonably 401s during the normal
// happy path (e.g. refresh fails when session expires) and AuthContext handles
// those cases on its own.
const AUTH_FLOW_PATHS = new Set([
  "/api/user/login",
  "/api/user/register",
  "/api/user/refresh",
  "/api/user/logout",
  "/api/user/me",
]);

// Custom event broadcast on a 401 from a non-auth-flow endpoint. AuthContext
// listens for this and forces a logout + redirect to /login.
export const SESSION_EXPIRED_EVENT = "tradescanner:session-expired";

export async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
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
  const res = await fetch(`${API_URL}${path}`, { cache: "no-store", ...options, headers });

  // Auto-logout on 401 from a normal API call. Skip auth-flow endpoints since
  // those legitimately 401 during refresh failure and AuthContext already
  // handles those paths.
  if (res.status === 401 && !AUTH_FLOW_PATHS.has(path) && typeof window !== "undefined") {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }

  return res;
}
