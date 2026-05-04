"use client";

import { useQuery } from "@tanstack/react-query";

import { getPortfolioRiskSummary } from "@/features/portfolio/api/portfolio.api";

export function usePortfolioRiskSummaryQuery() {
  return useQuery({
    queryKey: ["portfolio-risk-summary"],
    queryFn: () => getPortfolioRiskSummary()
  });
}
