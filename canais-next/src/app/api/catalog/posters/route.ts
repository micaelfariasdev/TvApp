import { NextResponse } from "next/server";
import { backendRequest, getAdminSessionToken } from "@/lib/server-api";

export async function POST(request: Request) {
  const token = await getAdminSessionToken();
  if (!token) {
    return NextResponse.json(
      { error: "Entre no painel para buscar capas." },
      { status: 401 },
    );
  }

  try {
    const body = await request.json();
    const response = await backendRequest(
      "/tvbox/api/v2/catalog/posters/search",
      { method: "POST", body: JSON.stringify(body) },
      token,
    );
    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    console.error("Falha ao buscar capa pelo painel:", error);
    return NextResponse.json(
      { error: "Não foi possível buscar a capa no servidor." },
      { status: 502 },
    );
  }
}
