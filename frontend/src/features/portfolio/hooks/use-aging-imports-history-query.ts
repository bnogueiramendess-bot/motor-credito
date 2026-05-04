"use client";

import { useQuery } from "@tanstack/react-query";

import { getAgingImportsHistory } from "@/features/portfolio/api/aging-imports.api";

export function useAgingImportsHistoryQuery(limit = 10) {
  return useQuery({
    queryKey: ["ar-aging-imports-history", limit],
    queryFn: () => getAgingImportsHistory(limit)
  });
}

