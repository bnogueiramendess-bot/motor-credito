"use client";

import { useQuery } from "@tanstack/react-query";

import { getPortfolioAgingLatest } from "@/features/portfolio/api/portfolio.api";

type UsePortfolioAgingLatestQueryParams = {
  bu?: string;
  snapshot_id?: string;
  business_unit_context?: string;
};

export function usePortfolioAgingLatestQuery(params?: UsePortfolioAgingLatestQueryParams) {
  return useQuery({
    queryKey: ["portfolio-aging-latest", params?.bu ?? null, params?.snapshot_id ?? "current", params?.business_unit_context ?? "default"],
    queryFn: () => getPortfolioAgingLatest(params)
  });
}
