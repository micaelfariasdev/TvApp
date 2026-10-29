import { NextResponse } from "next/server";
import { backendRequest, getAdminSessionToken } from "@/lib/server-api";

export async function PATCH(request: Request) {
  const token = await getAdminSessionToken();
  if (!token) {
    return NextResponse.json({ error: "Entre no painel para salvar alterações." }, { status: 401 });
  }

  try {
    const body = await request.json();
    const response = await backendRequest(
      "/tvbox/api/v2/catalog/categories",
      { method: "PATCH", body: JSON.stringify(body) },
      token,
    );
    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    console.error("Falha ao alterar tipo da categoria:", error);
    return NextResponse.json(
      { error: "Não foi possível atualizar a categoria no servidor." },
      { status: 502 },
    );
  }
}
