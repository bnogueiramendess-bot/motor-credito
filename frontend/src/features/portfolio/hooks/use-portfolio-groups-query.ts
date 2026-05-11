"use client";

import { useQuery } from "@tanstack/react-query";

import { getPortfolioGroups } from "@/features/portfolio/api/portfolio.api";

type UsePortfolioGroupsQueryParams = {
  bu?: string;
  q?: string;
  snapshot_id?: string;
  business_unit_context?: string;
};

export function usePortfolioGroupsQuery(params?: UsePortfolioGroupsQueryParams) {
  return useQuery({
    queryKey: ["portfolio-groups", params?.bu ?? null, params?.q ?? null, params?.snapshot_id ?? "current", params?.business_unit_context ?? "default"],
    queryFn: () => getPortfolioGroups(params)
  });
}
