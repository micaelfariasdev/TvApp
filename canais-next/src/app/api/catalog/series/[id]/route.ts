import { NextResponse } from "next/server";
import { backendRequest, getValidatedAdminSessionToken } from "@/lib/server-api";

export async function GET(
  _request: Request,
  context: RouteContext<"/api/catalog/series/[id]">,
) {
  try {
    const token = await getValidatedAdminSessionToken();
    if (!token) {
      return NextResponse.json({ error: "Entre no painel para acessar as séries." }, { status: 401 });
    }
    const { id } = await context.params;
    const response = await backendRequest(
      `/tvbox/api/v2/catalog/series/${encodeURIComponent(id)}`,
      {},
      token,
    );
    const payload: unknown = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    console.error("Falha ao consultar os episódios da série:", error);
    return NextResponse.json(
      { error: "Não foi possível carregar os episódios da série." },
      { status: 502 },
    );
  }
}