"use client";

import { useQuery } from "@tanstack/react-query";

import { getPortfolioRiskSummaryBySnapshot } from "@/features/portfolio/api/portfolio.api";

export function usePortfolioRiskSummaryQuery(snapshotId?: string, businessUnitContext?: string) {
  return useQuery({
    queryKey: ["portfolio-risk-summary", snapshotId ?? "current", businessUnitContext ?? "default"],
    queryFn: () => getPortfolioRiskSummaryBySnapshot(snapshotId, businessUnitContext)
  });
}
