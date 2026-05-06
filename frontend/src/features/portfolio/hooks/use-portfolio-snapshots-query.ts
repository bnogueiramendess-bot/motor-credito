"use client";

import { useQuery } from "@tanstack/react-query";

import { getPortfolioSnapshots } from "@/features/portfolio/api/portfolio.api";

export function usePortfolioSnapshotsQuery() {
  return useQuery({
    queryKey: ["portfolio-snapshots"],
    queryFn: () => getPortfolioSnapshots()
  });
}
