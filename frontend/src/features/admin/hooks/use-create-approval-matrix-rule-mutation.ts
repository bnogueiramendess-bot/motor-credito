"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { ApprovalMatrixRuleWritePayload, createApprovalMatrixRule } from "@/features/admin/api/admin.api";
import { adminQueryKeys } from "@/features/admin/hooks/query-keys";

export function useCreateApprovalMatrixRuleMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: ApprovalMatrixRuleWritePayload) => createApprovalMatrixRule(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.approvalMatrix });
    }
  });
}
