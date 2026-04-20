"use client";

import { useQuery } from "@tanstack/react-query";

import { getCreditAnalysisDetail } from "@/features/credit-analyses/api/credit-analyses.api";

export function useCreditAnalysisDetailQuery(analysisId: number) {
  return useQuery({
    queryKey: ["credit-analysis-detail", analysisId],
    queryFn: () => getCreditAnalysisDetail(analysisId),
    enabled: Number.isFinite(analysisId) && analysisId > 0
  });
}
