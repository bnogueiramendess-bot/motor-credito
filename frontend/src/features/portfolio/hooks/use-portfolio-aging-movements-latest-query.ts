"use client";

import { useQuery } from "@tanstack/react-query";

import { getPortfolioAgingMovementsLatest } from "@/features/portfolio/api/portfolio.api";

export function usePortfolioAgingMovementsLatestQuery() {
  return useQuery({
    queryKey: ["portfolio-aging-movements-latest"],
    queryFn: () => getPortfolioAgingMovementsLatest()
  });
}

