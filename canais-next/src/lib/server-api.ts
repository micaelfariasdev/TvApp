import { cookies } from "next/headers";

export const adminSessionCookie = "cinedark_admin_session";

export function getBackendUrl(path: string) {
  const configuredUrl = process.env.CANAIS_API_URL || "http://164.152.62.129";
  const baseUrl = new URL(configuredUrl);
  if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
    throw new Error("CANAIS_API_URL precisa usar HTTP ou HTTPS.");
  }
  return new URL(path, baseUrl);
}

export async function getAdminSessionToken() {
  const cookieStore = await cookies();
  return cookieStore.get(adminSessionCookie)?.value;
}

export async function getValidatedAdminSessionToken() {
  const token = await getAdminSessionToken();
  if (!token) return null;

  const response = await backendRequest("/tvbox/api/v2/session", {}, token);
  return response.ok ? token : null;
}

export function backendRequest(path: string, init: RequestInit = {}, sessionToken?: string) {
  const url = getBackendUrl(path);
  // const localBackend = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  // if ((sessionToken || init.method === "POST" && path.endsWith("/session")) &&
  //     url.protocol !== "https:" && !localBackend) {
  //   throw new Error("Use HTTPS ou um endereço local para transmitir credenciais ao servidor.");
  // }

  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  if (sessionToken) headers.set("Cookie", `tvbox_session=${encodeURIComponent(sessionToken)}`);

  return fetch(url, {
    ...init,
    cache: "no-store",
    headers,
    signal: AbortSignal.timeout(10_000),
  });
}
