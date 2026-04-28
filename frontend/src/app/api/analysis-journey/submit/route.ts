import { NextResponse } from "next/server";

import {
  AnalysisJourneySubmitRequest,
  AnalysisJourneySubmitResponse,
  CofaceReportReadResponse,
  UploadFileMetadataInput
} from "@/features/analysis-journey/api/contracts";
import { CreditAnalysisDto, CustomerDto } from "@/features/credit-analyses/api/contracts";
import { ExternalDataEntryDto } from "@/features/external-data/api/contracts";
import { BackendError, fetchBackend } from "@/shared/server/backend-client";

type BackendExternalDataPayload = {
  entry_method: "manual" | "upload" | "automatic";
  source_type: "agrisk" | "serasa" | "scr" | "internal_sheet" | "other";
  report_date: string | null;
  source_score: number | null;
  source_rating: string | null;
  has_restrictions: boolean;
  protests_count: number;
  protests_amount: number;
  lawsuits_count: number;
  lawsuits_amount: number;
  bounced_checks_count: number;
  declared_revenue: number | null;
  declared_indebtedness: number | null;
  notes: string | null;
};

function normalizeCustomerDocument(value: string) {
  return value.replace(/\D/g, "");
}

function mapFileMetadata(file: UploadFileMetadataInput) {
  const safeName = file.original_filename.replace(/\s+/g, "-");
  const createdAt = Date.now();
  const stored = `${createdAt}-${safeName}`;
  return {
    original_filename: file.original_filename,
    stored_filename: stored,
    mime_type: file.mime_type || "application/octet-stream",
    file_size: file.file_size,
    storage_path: `/virtual-uploads/${stored}`
  };
}

function toCurrencyNumber(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, value);
}

function isCofaceStatusValid(status: CofaceReportReadResponse["status"]) {
  return status === "valid" || status === "valid_with_warnings";
}

async function registerEntryWithFiles(
  analysisId: number,
  payload: BackendExternalDataPayload,
  files: UploadFileMetadataInput[]
) {
  const entry = await fetchBackend<ExternalDataEntryDto>(`/credit-analyses/${analysisId}/external-data`, {
    method: "POST",
    body: JSON.stringify(payload)
  });

  await Promise.all(
    files.map((file) =>
      fetchBackend(`/credit-analyses/${analysisId}/external-data/${entry.id}/files`, {
        method: "POST",
        body: JSON.stringify(mapFileMetadata(file))
      })
    )
  );
}

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let payload: AnalysisJourneySubmitRequest;

  try {
    payload = (await request.json()) as AnalysisJourneySubmitRequest;
  } catch {
    return NextResponse.json({ detail: "Payload inválido para submissão da jornada." }, { status: 400 });
  }

  if (!payload.customer.company_name || !payload.customer.document_number) {
    return NextResponse.json({ detail: "Dados cadastrais obrigatórios não informados." }, { status: 400 });
  }

  const warnings: string[] = [];

  try {
    const customers = await fetchBackend<CustomerDto[]>("/customers");
    const normalizedDocument = normalizeCustomerDocument(payload.customer.document_number);

    let customer =
      (payload.existing_customer_id
        ? customers.find((item) => item.id === payload.existing_customer_id)
        : null) ??
      customers.find((item) => normalizeCustomerDocument(item.document_number) === normalizedDocument) ??
      null;

    if (!customer) {
      customer = await fetchBackend<CustomerDto>("/customers", {
        method: "POST",
        body: JSON.stringify({
          company_name: payload.customer.company_name,
          document_number: normalizedDocument,
          segment: payload.customer.segment,
          region: payload.customer.region,
          relationship_start_date: payload.customer.relationship_start_date
        })
      });
    }

    const requestedLimit = toCurrencyNumber(payload.analysis.requested_limit);
    const currentLimit = toCurrencyNumber(payload.analysis.current_limit);
    const usedLimit = toCurrencyNumber(payload.analysis.used_limit);
    let guaranteeLimit = toCurrencyNumber(payload.analysis.guarantee_limit);

    if (payload.analysis.guarantee_limit_source === "coface_report") {
      const cofaceReadId = payload.inputs.external_import.coface_read_id;
      if (cofaceReadId !== null) {
        try {
          const cofaceRead = await fetchBackend<CofaceReportReadResponse>(`/credit-report-reads/coface/${cofaceReadId}`);
          const importedCoverageAmount = cofaceRead.read_payload?.coface?.decision_amount;
          if (isCofaceStatusValid(cofaceRead.status) && importedCoverageAmount !== null && importedCoverageAmount !== undefined) {
            guaranteeLimit = toCurrencyNumber(importedCoverageAmount);
          } else {
            warnings.push("Relatorio COFACE sem valor de cobertura valido. Limite com garantia mantido conforme preenchimento da tela.");
          }
        } catch (error) {
          if (error instanceof BackendError) {
            warnings.push(`Nao foi possivel confirmar o valor de cobertura COFACE: ${error.message}`);
          } else {
            warnings.push("Nao foi possivel confirmar o valor de cobertura COFACE no backend.");
          }
        }
      } else {
        warnings.push("Leitura COFACE nao informada no envio. Limite com garantia mantido conforme preenchimento da tela.");
      }
    }

    const exposureAmount = Math.max(0, requestedLimit + currentLimit + usedLimit - guaranteeLimit);

    const analysis = await fetchBackend<CreditAnalysisDto>("/credit-analyses", {
      method: "POST",
      body: JSON.stringify({
        customer_id: customer.id,
        requested_limit: requestedLimit,
        current_limit: currentLimit,
        exposure_amount: exposureAmount,
        annual_revenue_estimated: toCurrencyNumber(payload.analysis.annual_revenue_estimated),
        assigned_analyst_name: payload.analysis.assigned_analyst_name || null
      })
    });

    if (payload.inputs.manual.enabled) {
      const manual = payload.inputs.manual;
      const hasRestrictions =
        manual.negativations_count > 0 ||
        manual.negativations_amount > 0 ||
        manual.protests_count > 0 ||
        manual.protests_amount > 0 ||
        manual.active_lawsuits;

      await registerEntryWithFiles(
        analysis.id,
        {
          entry_method: "manual",
          source_type: "other",
          report_date: new Date().toISOString().slice(0, 10),
          source_score: null,
          source_rating: null,
          has_restrictions: hasRestrictions,
          protests_count: manual.protests_count,
          protests_amount: toCurrencyNumber(manual.protests_amount),
          lawsuits_count: manual.active_lawsuits ? 1 : 0,
          lawsuits_amount: 0,
          bounced_checks_count: manual.negativations_count,
          declared_revenue: manual.has_commercial_history ? manual.commercial_history_revenue : null,
          declared_indebtedness: null,
          notes: [
            `Origem: preenchimento manual`,
            `Valor total negativações: ${toCurrencyNumber(manual.negativations_amount)}`,
            `Observações: ${manual.observations || "-"}`,
            `Comentários: ${manual.comments || "-"}`,
            manual.has_commercial_history
              ? `Histórico comercial: faturamento ${manual.commercial_history_revenue ?? 0}, prazo contratual ${manual.contractual_avg_term_days ?? 0}, prazo efetivo ${manual.effective_avg_term_days ?? 0}`
              : "Histórico comercial: não"
          ].join("\n")
        },
        []
      );
    }

    if (payload.inputs.ocr.enabled) {
      const ocr = payload.inputs.ocr;
      await registerEntryWithFiles(
        analysis.id,
        {
          entry_method: "upload",
          source_type: "other",
          report_date: new Date().toISOString().slice(0, 10),
          source_score: null,
          source_rating: "OCR",
          has_restrictions: false,
          protests_count: 0,
          protests_amount: 0,
          lawsuits_count: 0,
          lawsuits_amount: 0,
          bounced_checks_count: 0,
          declared_revenue: ocr.net_revenue ?? ocr.gross_revenue ?? null,
          declared_indebtedness: ocr.liabilities,
          notes: JSON.stringify(
            {
              origem: "ocr_dre_balanco",
              ativo: ocr.active,
              passivo: ocr.liabilities,
              patrimonio_liquido: ocr.equity,
              receita_bruta: ocr.gross_revenue,
              receita_liquida: ocr.net_revenue,
              custos: ocr.costs,
              despesas: ocr.expenses,
              lucro: ocr.profit,
              adicionais: ocr.additional_fields || null
            },
            null,
            2
          )
        },
        ocr.files
      );
    }

    if (payload.inputs.internal_import.enabled) {
      const internalImport = payload.inputs.internal_import;
      await registerEntryWithFiles(
        analysis.id,
        {
          entry_method: "upload",
          source_type: "internal_sheet",
          report_date: new Date().toISOString().slice(0, 10),
          source_score: null,
          source_rating: "IMPORTAÇÃO_INTERNA",
          has_restrictions: false,
          protests_count: 0,
          protests_amount: 0,
          lawsuits_count: 0,
          lawsuits_amount: 0,
          bounced_checks_count: 0,
          declared_revenue: null,
          declared_indebtedness: null,
          notes: JSON.stringify(
            {
              origem: "importacao_interna",
              linhas: internalImport.rows_count,
              estrutura_validada: internalImport.template_validated,
              observacoes: internalImport.notes || null
            },
            null,
            2
          )
        },
        internalImport.files
      );
    }

    if (payload.inputs.external_import.enabled) {
      const externalImport = payload.inputs.external_import;
      await registerEntryWithFiles(
        analysis.id,
        {
          entry_method: "upload",
          source_type: externalImport.source_type,
          report_date: new Date().toISOString().slice(0, 10),
          source_score: externalImport.source_score,
          source_rating: externalImport.source_rating || null,
          has_restrictions: externalImport.has_restrictions,
          protests_count: externalImport.protests_count,
          protests_amount: 0,
          lawsuits_count: externalImport.lawsuits_count,
          lawsuits_amount: 0,
          bounced_checks_count: externalImport.negativations_count,
          declared_revenue: null,
          declared_indebtedness: null,
          notes: externalImport.notes || "Importação externa"
        },
        externalImport.files
      );
    }

    let scoreCalculated = false;
    let decisionCalculated = false;

    try {
      await fetchBackend(`/credit-analyses/${analysis.id}/score/calculate`, { method: "POST" });
      scoreCalculated = true;
    } catch (error) {
      if (error instanceof BackendError) {
        warnings.push(`Score não calculado automaticamente: ${error.message}`);
      } else {
        warnings.push("Score não calculado automaticamente.");
      }
    }

    try {
      await fetchBackend(`/credit-analyses/${analysis.id}/decision/calculate`, { method: "POST" });
      decisionCalculated = true;
    } catch (error) {
      if (error instanceof BackendError) {
        warnings.push(`Decisão do motor não calculada automaticamente: ${error.message}`);
      } else {
        warnings.push("Decisão do motor não calculada automaticamente.");
      }
    }

    const response: AnalysisJourneySubmitResponse = {
      analysis_id: analysis.id,
      customer_id: customer.id,
      score_calculated: scoreCalculated,
      decision_calculated: decisionCalculated,
      warnings
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    if (error instanceof BackendError) {
      return NextResponse.json({ detail: error.message }, { status: error.status });
    }
    return NextResponse.json({ detail: "Falha ao consolidar a jornada da análise." }, { status: 500 });
  }
}
