const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4002";

export { API_URL };

export function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  const token = typeof window !== "undefined" ? sessionStorage.getItem("accessToken") : null;
  const headers = new Headers(options?.headers);
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(`${API_URL}${path}`, { ...options, headers });
}
