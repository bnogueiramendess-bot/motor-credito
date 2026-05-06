"use client";

import { useQuery } from "@tanstack/react-query";

import { getPortfolioAgingMovementsLatest } from "@/features/portfolio/api/portfolio.api";

export function usePortfolioAgingMovementsLatestQuery(snapshotId?: string) {
  return useQuery({
    queryKey: ["portfolio-aging-movements-latest", snapshotId ?? "current"],
    queryFn: () => getPortfolioAgingMovementsLatest(snapshotId)
  });
}
