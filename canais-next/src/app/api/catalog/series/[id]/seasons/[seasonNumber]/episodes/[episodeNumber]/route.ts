import { NextResponse } from "next/server";
import { backendRequest, getAdminSessionToken } from "@/lib/server-api";

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/catalog/series/[id]/seasons/[seasonNumber]/episodes/[episodeNumber]">,
) {
  const token = await getAdminSessionToken();
  if (!token) {
    return NextResponse.json({ error: "Entre no painel para editar episódios." }, { status: 401 });
  }

  try {
    const { id, seasonNumber, episodeNumber } = await context.params;
    const body = await request.json();
    const response = await backendRequest(
      `/tvbox/api/v2/catalog/series/${encodeURIComponent(id)}/seasons/${encodeURIComponent(seasonNumber)}/episodes/${encodeURIComponent(episodeNumber)}`,
      { method: "PATCH", body: JSON.stringify(body) },
      token,
    );
    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    console.error("Falha ao editar episódio pelo painel:", error);
    return NextResponse.json(
      { error: "Não foi possível editar o episódio no servidor." },
      { status: 502 },
    );
  }
}
