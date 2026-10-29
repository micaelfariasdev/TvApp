import { NextResponse } from "next/server";
import { backendRequest, getAdminSessionToken } from "@/lib/server-api";

export async function POST(request: Request) {
  const token = await getAdminSessionToken();
  if (!token) {
    return NextResponse.json({ error: "Entre no painel para salvar alterações." }, { status: 401 });
  }

  try {
    const body = await request.json();
    const response = await backendRequest(
      "/tvbox/api/v2/catalog/items",
      { method: "POST", body: JSON.stringify(body) },
      token,
    );
    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    console.error("Falha ao criar item no catálogo:", error);
    return NextResponse.json(
      { error: "Não foi possível salvar o item no servidor." },
      { status: 502 },
    );
  }
}
