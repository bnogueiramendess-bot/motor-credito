"use client";

import { useQuery } from "@tanstack/react-query";

import { getPortfolioAgingAlertsLatest } from "@/features/portfolio/api/portfolio.api";

export function usePortfolioAgingAlertsLatestQuery() {
  return useQuery({
    queryKey: ["portfolio-aging-alerts-latest"],
    queryFn: () => getPortfolioAgingAlertsLatest()
  });
}

