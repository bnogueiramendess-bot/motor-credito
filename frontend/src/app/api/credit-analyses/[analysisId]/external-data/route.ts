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

type ExternalDataEntryCreateBody = {
  entry_method: "manual" | "upload" | "automatic";
  source_type: "agrisk" | "serasa" | "scr" | "internal_sheet" | "other";
  report_date?: string | null;
  source_score?: number | null;
  source_rating?: string | null;
  has_restrictions?: boolean;
  protests_count?: number;
  protests_amount?: number;
  lawsuits_count?: number;
  lawsuits_amount?: number;
  bounced_checks_count?: number;
  declared_revenue?: number | null;
  declared_indebtedness?: number | null;
  notes?: string | null;
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

export async function POST(request: Request, context: Context) {
  const analysisId = Number(context.params.analysisId);

  if (!Number.isFinite(analysisId) || analysisId <= 0) {
    return NextResponse.json({ detail: "ID da análise inválido." }, { status: 400 });
  }

  let body: ExternalDataEntryCreateBody;
  try {
    body = (await request.json()) as ExternalDataEntryCreateBody;
  } catch {
    return NextResponse.json({ detail: "Payload inválido." }, { status: 400 });
  }

  try {
    const payload = await fetchBackend(`/credit-analyses/${analysisId}/external-data`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Falha ao registrar dados externos da análise." }, { status: 500 });
  }
}
