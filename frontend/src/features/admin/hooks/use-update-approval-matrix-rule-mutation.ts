"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { ApprovalMatrixRuleWritePayload, updateApprovalMatrixRule } from "@/features/admin/api/admin.api";
import { adminQueryKeys } from "@/features/admin/hooks/query-keys";

type Input = {
  id: number;
  payload: ApprovalMatrixRuleWritePayload;
};

export function useUpdateApprovalMatrixRuleMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, payload }: Input) => updateApprovalMatrixRule(id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.approvalMatrix });
    }
  });
}
