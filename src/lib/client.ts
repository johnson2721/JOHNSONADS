export type Account = { id: string; name: string; email: string; phone: string; country: string; businessName: string; category: string; role: "customer" | "seller" | "admin"; verified: boolean };
export async function api<T = { ok: boolean }>(path: string, method = "GET", data?: unknown): Promise<T> {
  const isFile = typeof Blob !== "undefined" && data instanceof Blob;
  const response = await fetch(path, { method, credentials: "same-origin", cache: "no-store", ...(data !== undefined ? { headers: { "Content-Type": isFile ? data.type || "application/octet-stream" : "application/json" }, body: isFile ? data : JSON.stringify(data) } : {}) });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || "Something went wrong. Please try again.");
  return result as T;
}
export const errorText = (error: unknown) => error instanceof Error ? error.message : "Something went wrong. Please try again.";
export const field = (data: FormData, key: string) => String(data.get(key) ?? "");
export function safeNext(value?: string) {
  if (!value || !/^\/(?![/\\])/.test(value) || /[\\\u0000-\u001f]/.test(value)) return "/dashboard";
  try { const url = new URL(value, "https://app.invalid"); return url.origin === "https://app.invalid" ? url.pathname + url.search + url.hash : "/dashboard"; } catch { return "/dashboard"; }
}
export const categoryUrl = (key: string) => `/marketplace?category=${encodeURIComponent(key)}`;
