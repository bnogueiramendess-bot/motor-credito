"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { updateCreditPolicyDraftRule } from "@/features/credit-rules/api/credit-policy.api";
import { UpdateCreditPolicyDraftRulePayload } from "@/features/credit-rules/api/credit-policy.contracts";
import { creditPolicyQueryKeys } from "@/features/credit-rules/hooks/query-keys";

type MutationInput = {
  ruleId: number;
  payload: UpdateCreditPolicyDraftRulePayload;
};

export function useUpdateCreditPolicyRuleMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ ruleId, payload }: MutationInput) => updateCreditPolicyDraftRule(ruleId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: creditPolicyQueryKeys.draft });
    }
  });
}
