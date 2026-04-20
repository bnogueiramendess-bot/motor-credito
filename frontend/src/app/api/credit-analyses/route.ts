import { NextResponse } from "next/server";

import { CreditAnalysisDto, CustomerDto, ScoreResultDto } from "@/features/credit-analyses/api/contracts";
import { BackendError, fetchBackend, fetchBackendOptional } from "@/shared/server/backend-client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [analyses, customers] = await Promise.all([
      fetchBackend<CreditAnalysisDto[]>("/credit-analyses"),
      fetchBackend<CustomerDto[]>("/customers")
    ]);

    const customersById = new Map(customers.map((customer) => [customer.id, customer]));
    const scoresByAnalysisId = new Map<number, ScoreResultDto | null>();

    await Promise.all(
      analyses.map(async (analysis) => {
        const score = await fetchBackendOptional<ScoreResultDto>(`/credit-analyses/${analysis.id}/score`);
        scoresByAnalysisId.set(analysis.id, score);
      })
    );

    const response = analyses.map((analysis) => ({
      ...analysis,
      customer: customersById.get(analysis.customer_id) ?? null,
      score: scoresByAnalysisId.get(analysis.id) ?? null
    }));

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Falha ao carregar analises de credito." }, { status: 500 });
  }
}
