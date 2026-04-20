import { NextResponse } from "next/server";

import { DecisionEventDto } from "@/features/credit-analyses/api/contracts";
import { BackendError, fetchBackend } from "@/shared/server/backend-client";

export const dynamic = "force-dynamic";

type Context = {
  params: {
    analysisId: string;
  };
};

export async function GET(_: Request, context: Context) {
  const analysisId = Number(context.params.analysisId);

  if (!Number.isFinite(analysisId) || analysisId <= 0) {
    return NextResponse.json({ detail: "ID da analise invalido." }, { status: 400 });
  }

  try {
    const events = await fetchBackend<DecisionEventDto[]>(`/credit-analyses/${analysisId}/events`);
    return NextResponse.json(events);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Falha ao carregar eventos da analise." }, { status: 500 });
  }
}
