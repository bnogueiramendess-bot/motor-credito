import { NextResponse } from "next/server";

import { getAccessTokenFromCookies } from "@/shared/server/auth-cookies";
import { BackendError, fetchBackend } from "@/shared/server/backend-client";

const BACKEND_API_URL = process.env.BACKEND_API_URL ?? "http://localhost:8000";
export const dynamic = "force-dynamic";

type Params = { params: { analysisId: string } };

export async function GET(_: Request, { params }: Params) {
  const analysisId = Number(params.analysisId);
  if (!Number.isFinite(analysisId) || analysisId <= 0) {
    return NextResponse.json({ detail: "Análise inválida." }, { status: 400 });
  }
  try {
    const response = await fetchBackend(`/credit-analyses/${analysisId}/documents`);
    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Falha ao listar documentos." }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: Params) {
  const analysisId = Number(params.analysisId);
  if (!Number.isFinite(analysisId) || analysisId <= 0) {
    return NextResponse.json({ detail: "Análise inválida." }, { status: 400 });
  }

  try {
    const accessToken = await getAccessTokenFromCookies();
    if (!accessToken) {
      return NextResponse.json({ detail: "Não autenticado." }, { status: 401 });
    }
    const formData = await request.formData();
    const response = await fetch(`${BACKEND_API_URL}/credit-analyses/${analysisId}/documents`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      body: formData,
      cache: "no-store"
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { detail?: string };
      return NextResponse.json({ detail: payload.detail ?? "Falha no upload do documento." }, { status: response.status });
    }
    return NextResponse.json(await response.json(), { status: 201 });
  } catch {
    return NextResponse.json({ detail: "Falha no upload do documento." }, { status: 500 });
  }
}
