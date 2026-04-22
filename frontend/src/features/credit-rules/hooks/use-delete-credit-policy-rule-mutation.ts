"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { deleteCreditPolicyDraftRule } from "@/features/credit-rules/api/credit-policy.api";
import { creditPolicyQueryKeys } from "@/features/credit-rules/hooks/query-keys";

export function useDeleteCreditPolicyRuleMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ruleId: number) => deleteCreditPolicyDraftRule(ruleId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: creditPolicyQueryKeys.draft });
    }
  });
}
