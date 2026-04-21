"use client";

import { useQuery } from "@tanstack/react-query";

import { getExternalDataDashboard } from "@/features/external-data/api/external-data.api";

export function useExternalDataDashboardQuery(analysisId: number | null) {
  return useQuery({
    queryKey: ["external-data-dashboard", analysisId],
    queryFn: () => getExternalDataDashboard(analysisId as number),
    enabled: Number.isFinite(analysisId) && (analysisId ?? 0) > 0
  });
}
