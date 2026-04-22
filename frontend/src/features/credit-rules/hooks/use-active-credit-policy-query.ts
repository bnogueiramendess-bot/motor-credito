"use client";

import { useQuery } from "@tanstack/react-query";

import { getActiveCreditPolicy } from "@/features/credit-rules/api/credit-policy.api";
import { creditPolicyQueryKeys } from "@/features/credit-rules/hooks/query-keys";

export function useActiveCreditPolicyQuery() {
  return useQuery({
    queryKey: creditPolicyQueryKeys.active,
    queryFn: () => getActiveCreditPolicy()
  });
}
