import { NextResponse } from "next/server";
import { backendRequest, getAdminSessionToken } from "@/lib/server-api";

export async function POST(
  request: Request,
  context: RouteContext<"/api/catalog/series/[id]/seasons">,
) {
  const token = await getAdminSessionToken();
  if (!token) {
    return NextResponse.json({ error: "Entre no painel para criar temporadas." }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const body = await request.json();
    const response = await backendRequest(
      `/tvbox/api/v2/catalog/series/${encodeURIComponent(id)}/seasons`,
      { method: "POST", body: JSON.stringify(body) },
      token,
    );
    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    console.error("Falha ao criar temporada pelo painel:", error);
    return NextResponse.json(
      { error: "Não foi possível criar a temporada no servidor." },
      { status: 502 },
    );
  }
}
