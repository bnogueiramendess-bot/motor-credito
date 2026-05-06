"use client";

import { useQuery } from "@tanstack/react-query";

import { getPortfolioAgingAlertsLatestBySnapshot } from "@/features/portfolio/api/portfolio.api";

export function usePortfolioAgingAlertsLatestQuery(snapshotId?: string) {
  return useQuery({
    queryKey: ["portfolio-aging-alerts-latest", snapshotId ?? "current"],
    queryFn: () => getPortfolioAgingAlertsLatestBySnapshot(snapshotId)
  });
}
