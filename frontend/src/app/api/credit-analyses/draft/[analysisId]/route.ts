import { NextResponse } from "next/server";

import { BackendError, fetchBackend } from "@/shared/server/backend-client";

export const dynamic = "force-dynamic";

type Params = { params: { analysisId: string } };

export async function DELETE(_: Request, { params }: Params) {
  const analysisId = Number(params.analysisId);
  if (!Number.isFinite(analysisId) || analysisId <= 0) {
    return NextResponse.json({ detail: "ID de rascunho inválido." }, { status: 400 });
  }
  try {
    await fetchBackend(`/credit-analyses/draft/${analysisId}`, { method: "DELETE" });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Não foi possível descartar o rascunho." }, { status: 500 });
  }
}
