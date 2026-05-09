"use client";

import { useQuery } from "@tanstack/react-query";

import { getCreditAnalysesQueueOptions } from "@/features/credit-analyses/api/credit-analyses.api";

export function useCreditAnalysesQueueOptionsQuery() {
  return useQuery({
    queryKey: ["credit-analyses-queue-options"],
    queryFn: getCreditAnalysesQueueOptions
  });
}
