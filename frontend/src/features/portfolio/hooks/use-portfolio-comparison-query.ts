"use client";

import { useQuery } from "@tanstack/react-query";

import { getPortfolioComparison } from "@/features/portfolio/api/portfolio.api";

export function usePortfolioComparisonQuery(fromSnapshotId?: string, toSnapshotId?: string) {
  return useQuery({
    queryKey: ["portfolio-comparison", fromSnapshotId ?? null, toSnapshotId ?? null],
    enabled: Boolean(fromSnapshotId && toSnapshotId && fromSnapshotId !== toSnapshotId),
    queryFn: () => getPortfolioComparison(fromSnapshotId as string, toSnapshotId as string)
  });
}

