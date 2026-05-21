import { NextResponse } from "next/server";

import { BackendError, fetchBackend } from "@/shared/server/backend-client";

export const dynamic = "force-dynamic";

type Context = {
  params: {
    analysisId: string;
  };
};

export async function PUT(request: Request, context: Context) {
  const analysisId = Number(context.params.analysisId);

  if (!Number.isFinite(analysisId) || analysisId <= 0) {
    return NextResponse.json({ detail: "ID da análise inválido." }, { status: 400 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const payload = await fetchBackend(`/credit-analyses/${analysisId}/workspace-state`, {
      method: "PUT",
      body: JSON.stringify(body ?? {}),
    });
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Falha ao atualizar dados da jornada." }, { status: 500 });
  }
}
