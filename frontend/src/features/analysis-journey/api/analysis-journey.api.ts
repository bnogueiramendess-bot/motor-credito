import { apiClient } from "@/shared/lib/http/http-client";

import {
  AnalysisJourneySubmitRequest,
  AnalysisJourneySubmitResponse,
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
