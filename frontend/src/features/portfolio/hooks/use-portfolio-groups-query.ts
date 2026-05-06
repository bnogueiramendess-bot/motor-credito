"use client";

import { useQuery } from "@tanstack/react-query";

import { getPortfolioGroups } from "@/features/portfolio/api/portfolio.api";

type UsePortfolioGroupsQueryParams = {
  bu?: string;
  q?: string;
  snapshot_id?: string;
};

export function usePortfolioGroupsQuery(params?: UsePortfolioGroupsQueryParams) {
  return useQuery({
    queryKey: ["portfolio-groups", params?.bu ?? null, params?.q ?? null, params?.snapshot_id ?? "current"],
    queryFn: () => getPortfolioGroups(params)
  });
}
