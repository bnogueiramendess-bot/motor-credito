"use client";

import { useQuery } from "@tanstack/react-query";

import { getPortfolioAgingMovementsLatest } from "@/features/portfolio/api/portfolio.api";

export function usePortfolioAgingMovementsLatestQuery(snapshotId?: string, businessUnitContext?: string) {
  return useQuery({
    queryKey: ["portfolio-aging-movements-latest", snapshotId ?? "current", businessUnitContext ?? "default"],
    queryFn: () => getPortfolioAgingMovementsLatest(snapshotId, businessUnitContext)
  });
}
