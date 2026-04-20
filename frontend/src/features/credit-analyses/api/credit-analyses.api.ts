import { apiClient } from "@/shared/lib/http/http-client";

import {
  CreditAnalysisDetailApiResponse,
  CreditAnalysisListApiResponse
} from "@/features/credit-analyses/api/contracts";

export async function getCreditAnalyses() {
  return apiClient.get<CreditAnalysisListApiResponse>("/api/credit-analyses");
}

export async function getCreditAnalysisDetail(analysisId: number) {
  return apiClient.get<CreditAnalysisDetailApiResponse>(`/api/credit-analyses/${analysisId}/detail`);
}
