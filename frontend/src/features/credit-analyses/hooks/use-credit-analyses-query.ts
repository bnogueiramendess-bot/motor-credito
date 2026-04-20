"use client";

import { useQuery } from "@tanstack/react-query";

import { getCreditAnalyses } from "@/features/credit-analyses/api/credit-analyses.api";

export function useCreditAnalysesQuery() {
  return useQuery({
    queryKey: ["credit-analyses"],
    queryFn: getCreditAnalyses
  });
}
