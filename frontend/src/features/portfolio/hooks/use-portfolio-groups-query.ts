"use client";

import { useQuery } from "@tanstack/react-query";

import { getPortfolioGroups } from "@/features/portfolio/api/portfolio.api";

type UsePortfolioGroupsQueryParams = {
  bu?: string;
  q?: string;
};

export function usePortfolioGroupsQuery(params?: UsePortfolioGroupsQueryParams) {
  return useQuery({
    queryKey: ["portfolio-groups", params?.bu ?? null, params?.q ?? null],
    queryFn: () => getPortfolioGroups(params)
  });
}
