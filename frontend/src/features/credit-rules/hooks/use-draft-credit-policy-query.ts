"use client";

import { useQuery } from "@tanstack/react-query";

import { getDraftCreditPolicy } from "@/features/credit-rules/api/credit-policy.api";
import { creditPolicyQueryKeys } from "@/features/credit-rules/hooks/query-keys";

export function useDraftCreditPolicyQuery() {
  return useQuery({
    queryKey: creditPolicyQueryKeys.draft,
    queryFn: () => getDraftCreditPolicy()
  });
}
