"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { resetCreditPolicyDraft } from "@/features/credit-rules/api/credit-policy.api";
import { creditPolicyQueryKeys } from "@/features/credit-rules/hooks/query-keys";

export function useResetCreditPolicyDraftMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => resetCreditPolicyDraft(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: creditPolicyQueryKeys.active }),
        queryClient.invalidateQueries({ queryKey: creditPolicyQueryKeys.draft })
      ]);
    }
  });
}
