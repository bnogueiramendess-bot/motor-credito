import { NextResponse } from "next/server";

import { CreditAnalysisDto, CustomerDto, DecisionEventDto } from "@/features/credit-analyses/api/contracts";
import { ExternalDataEntryDto } from "@/features/external-data/api/contracts";
import { BackendError, fetchBackend, fetchBackendOptional } from "@/shared/server/backend-client";

export const dynamic = "force-dynamic";

type Context = {
  params: {
    analysisId: string;
  };
};

type ExternalDataDetailDto = ExternalDataEntryDto & {
  files: {
    id: number;
    original_filename: string;
    stored_filename: string;
    mime_type: string;
    file_size: number;
    storage_path: string;
    uploaded_at: string;
  }[];
};

function resolveDetailError(error: unknown) {
  if (error instanceof BackendError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Erro ao carregar detalhes da fonte.";
}

export async function GET(_: Request, context: Context) {
  const analysisId = Number(context.params.analysisId);

  if (!Number.isFinite(analysisId) || analysisId <= 0) {
    return NextResponse.json({ detail: "ID da análise inválido." }, { status: 400 });
  }

  try {
    const analysis = await fetchBackend<CreditAnalysisDto>(`/credit-analyses/${analysisId}`);

    const [customer, events, entries] = await Promise.all([
      fetchBackendOptional<CustomerDto>(`/customers/${analysis.customer_id}`),
      fetchBackend<DecisionEventDto[]>(`/credit-analyses/${analysisId}/events`),
      fetchBackend<ExternalDataEntryDto[]>(`/credit-analyses/${analysisId}/external-data`)
    ]);

    const details = await Promise.allSettled(
      entries.map((entry) => fetchBackend<ExternalDataDetailDto>(`/credit-analyses/${analysisId}/external-data/${entry.id}`))
    );

    const enrichedEntries = entries.map((entry, index) => {
      const detail = details[index];
      if (detail?.status === "fulfilled") {
        return {
          ...entry,
          files: detail.value.files ?? [],
          detail_fetch_status: "available" as const,
          detail_fetch_error: null
        };
      }

      return {
        ...entry,
        files: [],
        detail_fetch_status: "failed" as const,
        detail_fetch_error: resolveDetailError(detail?.reason)
      };
    });

    return NextResponse.json({
      analysis,
      customer,
      events,
      entries: enrichedEntries
    });
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Falha ao carregar dados externos da análise." }, { status: 500 });
  }
}
