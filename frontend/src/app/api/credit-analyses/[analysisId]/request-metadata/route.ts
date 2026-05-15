import { NextResponse } from "next/server";

import { BackendError, fetchBackend } from "@/shared/server/backend-client";

export const dynamic = "force-dynamic";

type Params = { params: { analysisId: string } };

export async function GET(_: Request, { params }: Params) {
  const analysisId = Number(params.analysisId);
  if (!Number.isFinite(analysisId) || analysisId <= 0) {
    return NextResponse.json({ detail: "Análise inválida." }, { status: 400 });
  }

  try {
    const response = await fetchBackend(`/credit-analyses/${analysisId}/request-metadata`);
    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Falha ao carregar metadados da solicitação." }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: Params) {
  const analysisId = Number(params.analysisId);
  if (!Number.isFinite(analysisId) || analysisId <= 0) {
    return NextResponse.json({ detail: "Análise inválida." }, { status: 400 });
  }

  try {
    const payload = await request.json();
    const response = await fetchBackend(`/credit-analyses/${analysisId}/request-metadata`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Falha ao salvar metadados da solicitação." }, { status: 500 });
  }
}
