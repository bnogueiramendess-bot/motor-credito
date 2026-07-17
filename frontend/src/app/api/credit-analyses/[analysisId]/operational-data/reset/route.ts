import { NextResponse } from "next/server";

import { BackendError, fetchBackend } from "@/shared/server/backend-client";

export const dynamic = "force-dynamic";

type Context = {
  params: {
    analysisId: string;
  };
};

export async function POST(request: Request, context: Context) {
  const analysisId = Number(context.params.analysisId);
  if (!Number.isFinite(analysisId) || analysisId <= 0) {
    return NextResponse.json({ detail: "ID da an?lise inv?lido." }, { status: 400 });
  }

  try {
    const payload = await request.json().catch(() => ({}));
    const result = await fetchBackend(`/credit-analyses/${analysisId}/operational-data/reset`, {
      method: "POST",
      body: JSON.stringify(payload ?? {})
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Falha ao resetar dados operacionais." }, { status: 500 });
  }
}
