import { NextResponse } from "next/server";

import { getAccessTokenFromCookies } from "@/shared/server/auth-cookies";

const BACKEND_API_URL = process.env.BACKEND_API_URL ?? "http://localhost:8000";

type Params = { params: { analysisId: string; documentId: string } };

export async function DELETE(_: Request, { params }: Params) {
  const analysisId = Number(params.analysisId);
  const documentId = Number(params.documentId);
  if (!Number.isFinite(analysisId) || analysisId <= 0 || !Number.isFinite(documentId) || documentId <= 0) {
    return NextResponse.json({ detail: "Parâmetros inválidos." }, { status: 400 });
  }

  const accessToken = await getAccessTokenFromCookies();
  if (!accessToken) {
    return NextResponse.json({ detail: "Não autenticado." }, { status: 401 });
  }

  try {
    const response = await fetch(`${BACKEND_API_URL}/credit-analyses/${analysisId}/documents/${documentId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      cache: "no-store"
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { detail?: string };
      return NextResponse.json({ detail: payload.detail ?? "Falha ao remover documento." }, { status: response.status });
    }

    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ detail: "Falha ao remover documento." }, { status: 500 });
  }
}
