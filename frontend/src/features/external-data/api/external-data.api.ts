import { apiClient } from "@/shared/lib/http/http-client";

import { ExternalDataDashboardApiResponse } from "@/features/external-data/api/contracts";

export async function getExternalDataDashboard(analysisId: number) {
  return apiClient.get<ExternalDataDashboardApiResponse>(`/api/credit-analyses/${analysisId}/external-data`);
}
