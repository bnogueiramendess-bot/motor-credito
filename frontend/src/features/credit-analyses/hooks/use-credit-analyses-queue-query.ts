"use client";

import { useQuery } from "@tanstack/react-query";

import { getCreditAnalysesQueue, OperationalQueueParams } from "@/features/credit-analyses/api/credit-analyses.api";

export function useCreditAnalysesQueueQuery(params: OperationalQueueParams) {
  return useQuery({
    queryKey: ["credit-analyses-queue", params],
    queryFn: () => getCreditAnalysesQueue(params)
  });
}
