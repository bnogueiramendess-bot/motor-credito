import { NextResponse } from "next/server";

import {
  CreditAnalysisDto,
  CustomerDto,
  DecisionEventDto,
  DecisionResultDto,
  FinalDecisionResultDto,
  ScoreResultDto
} from "@/features/credit-analyses/api/contracts";
import { BackendError, fetchBackend, fetchBackendOptional } from "@/shared/server/backend-client";

export const dynamic = "force-dynamic";

type Context = {
  params: {
    analysisId: string;
  };
};

export async function GET(_: Request, context: Context) {
  const analysisId = Number(context.params.analysisId);

  if (!Number.isFinite(analysisId) || analysisId <= 0) {
    return NextResponse.json({ detail: "ID da análise inválido." }, { status: 400 });
  }

  try {
    const analysis = await fetchBackend<CreditAnalysisDto>(`/credit-analyses/${analysisId}`);

    const [customer, events, score, decision, finalDecision] = await Promise.all([
      fetchBackendOptional<CustomerDto>(`/customers/${analysis.customer_id}`),
      fetchBackend<DecisionEventDto[]>(`/credit-analyses/${analysisId}/events`),
      fetchBackendOptional<ScoreResultDto>(`/credit-analyses/${analysisId}/score`),
      fetchBackendOptional<DecisionResultDto>(`/credit-analyses/${analysisId}/decision`),
      fetchBackendOptional<FinalDecisionResultDto>(`/credit-analyses/${analysisId}/final-decision`)
    ]);

    return NextResponse.json({
      analysis,
      customer,
      score,
      decision,
      final_decision: finalDecision,
      events
    });
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Falha ao carregar o detalhe da análise." }, { status: 500 });
  }
}
