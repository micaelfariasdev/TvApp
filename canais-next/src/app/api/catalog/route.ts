import { connection, NextResponse } from "next/server";
import { backendRequest, getValidatedAdminSessionToken } from "@/lib/server-api";

const catalogPath = "/tvbox/api/v2/catalog";

export async function GET() {
  await connection();
  let token: string | null;
  try {
    token = await getValidatedAdminSessionToken();
  } catch (error) {
    console.error("Falha ao validar sessão antes de consultar o catálogo:", error);
    return NextResponse.json(
      { error: "Não foi possível validar o acesso ao catálogo." },
      { status: 502 },
    );
  }
  if (!token) {
    return NextResponse.json({ error: "Entre no painel para acessar o catálogo." }, { status: 401 });
  }

  try {
    const response = await backendRequest(catalogPath, {}, token);
    const payload: unknown = await response.json();

    if (!response.ok) {
      const errorMessage =
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof payload.error === "string"
          ? payload.error
          : `O servidor de catálogo respondeu com HTTP ${response.status}.`;
      return NextResponse.json({ error: errorMessage }, { status: response.status });
    }

    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    console.error("Falha ao consultar a API v2 do servidor de canais:", error);
    const message =
      error instanceof TypeError
        ? "Não foi possível conectar ao servidor de canais. Verifique CANAIS_API_URL e se o Express está ativo."
        : "Não foi possível obter o catálogo do servidor de canais.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
