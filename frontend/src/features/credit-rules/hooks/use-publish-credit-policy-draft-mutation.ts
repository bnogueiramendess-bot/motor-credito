"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { publishCreditPolicyDraft } from "@/features/credit-rules/api/credit-policy.api";
import { creditPolicyQueryKeys } from "@/features/credit-rules/hooks/query-keys";

export function usePublishCreditPolicyDraftMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => publishCreditPolicyDraft(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: creditPolicyQueryKeys.active }),
        queryClient.invalidateQueries({ queryKey: creditPolicyQueryKeys.draft })
      ]);
    }
  });
}
