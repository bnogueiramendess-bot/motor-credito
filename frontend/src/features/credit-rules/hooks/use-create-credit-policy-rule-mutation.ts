"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { createCreditPolicyDraftRule } from "@/features/credit-rules/api/credit-policy.api";
import { CreateCreditPolicyDraftRulePayload } from "@/features/credit-rules/api/credit-policy.contracts";
import { creditPolicyQueryKeys } from "@/features/credit-rules/hooks/query-keys";

export function useCreateCreditPolicyRuleMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateCreditPolicyDraftRulePayload) => createCreditPolicyDraftRule(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: creditPolicyQueryKeys.draft });
    }
  });
}
