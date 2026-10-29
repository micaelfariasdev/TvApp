import { NextResponse } from "next/server";
import { backendRequest, getAdminSessionToken } from "@/lib/server-api";

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/catalog/items/[id]">,
) {
  const token = await getAdminSessionToken();
  if (!token) {
    return NextResponse.json({ error: "Entre no painel para salvar alterações." }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const body = await request.json();
    const response = await backendRequest(
      `/tvbox/api/v2/catalog/items/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(body) },
      token,
    );
    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    console.error("Falha ao editar item do catálogo:", error);
    return NextResponse.json(
      { error: "Não foi possível atualizar o item no servidor." },
      { status: 502 },
    );
  }
}
