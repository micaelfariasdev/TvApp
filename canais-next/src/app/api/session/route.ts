import { NextRequest, NextResponse } from "next/server";
import {
  adminSessionCookie,
  backendRequest,
  getAdminSessionToken,
} from "@/lib/server-api";

export async function GET() {
  const token = await getAdminSessionToken();
  if (!token) return NextResponse.json({ authenticated: false });

  try {
    const response = await backendRequest("/tvbox/api/v2/session", {}, token);
    if (response.ok) return NextResponse.json({ authenticated: true });
    const unauthenticated = NextResponse.json({ authenticated: false });
    unauthenticated.cookies.delete(adminSessionCookie);
    return unauthenticated;
  } catch (error) {
    console.error("Falha ao validar sessão do painel:", error);
    return NextResponse.json(
      { error: "Não foi possível validar a sessão no servidor." },
      { status: 502 },
    );
  }
}

export async function POST(request: NextRequest) {
  let password: unknown;
  try {
    ({ password } = await request.json());
  } catch {
    return NextResponse.json({ error: "Envie a senha do painel." }, { status: 400 });
  }
  if (typeof password !== "string" || !password) {
    return NextResponse.json({ error: "Envie a senha do painel." }, { status: 400 });
  }

  try {
    const response = await backendRequest("/tvbox/api/v2/session", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    const payload = await response.json();
    if (!response.ok) {
      return NextResponse.json(payload, { status: response.status });
    }
    if (typeof payload.token !== "string") {
      throw new Error("A API do servidor não retornou uma sessão válida.");
    }

    const result = NextResponse.json({ authenticated: true });
    const forwardedProtocol = request.headers.get("x-forwarded-proto");
    const secure =
      forwardedProtocol?.split(",")[0].trim() === "https" ||
      (!forwardedProtocol && new URL(request.url).protocol === "https:");
    result.cookies.set(adminSessionCookie, payload.token, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      expires: new Date(payload.expiresAt),
    });
    return result;
  } catch (error) {
    console.error("Falha ao entrar no painel de catálogo:", error);
    return NextResponse.json(
      {
        error: error instanceof Error && error.message.startsWith("Use HTTPS")
          ? error.message
          : "Não foi possível entrar no painel do servidor.",
      },
      { status: 502 },
    );
  }
}

export async function DELETE() {
  const result = NextResponse.json({ authenticated: false });
  result.cookies.delete(adminSessionCookie);
  return result;
}
