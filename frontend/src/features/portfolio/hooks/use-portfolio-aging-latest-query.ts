"use client";

import { useQuery } from "@tanstack/react-query";

import { getPortfolioAgingLatest } from "@/features/portfolio/api/portfolio.api";

type UsePortfolioAgingLatestQueryParams = {
  bu?: string;
  snapshot_id?: string;
};

export function usePortfolioAgingLatestQuery(params?: UsePortfolioAgingLatestQueryParams) {
  return useQuery({
    queryKey: ["portfolio-aging-latest", params?.bu ?? null, params?.snapshot_id ?? "current"],
    queryFn: () => getPortfolioAgingLatest(params)
  });
}
