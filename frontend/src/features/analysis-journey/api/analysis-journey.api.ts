import { apiClient } from "@/shared/lib/http/http-client";

import {
  AgriskReportReadResponse,
  AnalysisJourneySubmitRequest,
  AnalysisJourneySubmitResponse,
  CreditAnalysisTriageRequest,
  CreditAnalysisTriageResponse,
  CreditAnalysisDraftCreateRequest,
  CreditAnalysisDraftCreateResponse,
  CreditAnalysisTriageSubmitRequest,
  CreditAnalysisTriageSubmitResponse,
  CofaceReportReadResponse,
  ExternalCnpjLookupResponse,
  AnalysisRequestMetadataDto,
  AnalysisRequestMetadataUpsertRequest,
  AnalysisDocumentDto,
  CreditAnalysisExistingCheckResponse,
  CommercialReference,
  CreateCommercialReferencePayload
} from "@/features/analysis-journey/api/contracts";
import { CustomerDto } from "@/features/credit-analyses/api/contracts";

export async function listCustomers() {
  return apiClient.get<CustomerDto[]>("/api/customers");
}

export async function submitAnalysisJourney(payload: AnalysisJourneySubmitRequest) {
  return apiClient.post<AnalysisJourneySubmitResponse, AnalysisJourneySubmitRequest>("/api/analysis-journey/submit", payload);
}

export async function lookupExternalCnpj(cnpj: string) {
  return apiClient.get<ExternalCnpjLookupResponse>(`/api/external/cnpj/${cnpj}`);
}

export async function triageCreditRequest(payload: CreditAnalysisTriageRequest) {
  return apiClient.post<CreditAnalysisTriageResponse, CreditAnalysisTriageRequest>("/api/analysis-journey/triage", payload);
}

export async function checkExistingCreditAnalysis(cnpj: string) {
  return apiClient.get<CreditAnalysisExistingCheckResponse>(`/api/credit-analyses/check-existing?cnpj=${encodeURIComponent(cnpj)}`);
}

export async function createCreditAnalysisDraft(payload: CreditAnalysisDraftCreateRequest) {
  return apiClient.post<CreditAnalysisDraftCreateResponse, CreditAnalysisDraftCreateRequest>("/api/credit-analyses/draft", payload);
}

export async function submitTriageCreditRequest(payload: CreditAnalysisTriageSubmitRequest) {
  return apiClient.post<CreditAnalysisTriageSubmitResponse, CreditAnalysisTriageSubmitRequest>("/api/analysis-journey/triage-submit", payload);
}

export async function getAnalysisRequestMetadata(analysisId: number) {
  return apiClient.get<AnalysisRequestMetadataDto>(`/api/credit-analyses/${analysisId}/request-metadata`);
}

export async function saveAnalysisRequestMetadata(analysisId: number, payload: AnalysisRequestMetadataUpsertRequest) {
  return apiClient.put<AnalysisRequestMetadataDto, AnalysisRequestMetadataUpsertRequest>(`/api/credit-analyses/${analysisId}/request-metadata`, payload);
}

export async function listAnalysisDocuments(analysisId: number) {
  return apiClient.get<AnalysisDocumentDto[]>(`/api/credit-analyses/${analysisId}/documents`);
}

export async function uploadAnalysisDocument(analysisId: number, documentType: string, file: File) {
  const data = new FormData();
  data.append("document_type", documentType);
  data.append("file", file);

  const response = await fetch(`/api/credit-analyses/${analysisId}/documents`, {
    method: "POST",
    body: data
  });
  if (!response.ok) {
    if (response.status === 400) {
      throw new Error("Arquivo inválido ou ausente.");
    }
    throw new Error("Não foi possível enviar o arquivo. Tente novamente.");
  }
  return (await response.json()) as AnalysisDocumentDto;
}

export async function deleteAnalysisDocument(analysisId: number, documentId: number) {
  const response = await fetch(`/api/credit-analyses/${analysisId}/documents/${documentId}`, {
    method: "DELETE"
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new Error(payload.detail ?? "Falha ao remover documento.");
  }
}

export async function listCommercialReferences(analysisId: number) {
  return apiClient.get<CommercialReference[]>(`/api/credit-analyses/${analysisId}/commercial-references`);
}

export async function createCommercialReference(analysisId: number, payload: CreateCommercialReferencePayload) {
  return apiClient.post<CommercialReference, CreateCommercialReferencePayload>(
    `/api/credit-analyses/${analysisId}/commercial-references`,
    payload
  );
}

export async function deleteCommercialReference(analysisId: number, referenceId: number) {
  const response = await fetch(`/api/credit-analyses/${analysisId}/commercial-references/${referenceId}`, {
    method: "DELETE"
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new Error(payload.detail ?? "Falha ao remover referência comercial.");
  }
}

function toBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Não foi possível ler o arquivo em base64."));
        return;
      }
      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

export async function readAgriskReport(file: File, customerDocumentNumber: string) {
  const fileContentBase64 = await toBase64(file);
  const response = await fetch("/api/analysis-journey/agrisk-read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      original_filename: file.name,
      mime_type: file.type || "application/pdf",
      file_size: file.size,
      customer_document_number: customerDocumentNumber,
      file_content_base64: fileContentBase64
    })
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new Error(payload.detail ?? "Falha ao processar o relatório AgRisk.");
  }

  return (await response.json()) as AgriskReportReadResponse;
}

export async function readCofaceReport(file: File, customerDocumentNumber: string) {
  const fileContentBase64 = await toBase64(file);
  const response = await fetch("/api/analysis-journey/coface-read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      original_filename: file.name,
      mime_type: file.type || "application/pdf",
      file_size: file.size,
      customer_document_number: customerDocumentNumber,
      file_content_base64: fileContentBase64
    })
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new Error(payload.detail ?? "Falha ao processar o relatório COFACE.");
  }

  return (await response.json()) as CofaceReportReadResponse;
}
