import { apiClient } from "@/shared/lib/http/http-client";

import {
  AgriskReportReadResponse,
  AnalysisJourneySubmitRequest,
  AnalysisJourneySubmitResponse,
  CofaceReportReadResponse,
  ExternalCnpjLookupResponse
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
