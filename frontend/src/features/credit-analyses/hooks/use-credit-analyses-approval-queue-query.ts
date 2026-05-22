"use client";

import { useQuery } from "@tanstack/react-query";

import { ApprovalQueueParams, getCreditAnalysesApprovalQueue } from "@/features/credit-analyses/api/credit-analyses.api";

export function useCreditAnalysesApprovalQueueQuery(params: ApprovalQueueParams) {
  return useQuery({
    queryKey: ["credit-analyses-approval-queue", params],
    queryFn: () => getCreditAnalysesApprovalQueue(params),
  });
}
