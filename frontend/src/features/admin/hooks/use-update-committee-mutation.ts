"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { CommitteeWritePayload, updateCommittee } from "@/features/admin/api/admin.api";
import { adminQueryKeys } from "@/features/admin/hooks/query-keys";

type Input = {
  id: number;
  payload: CommitteeWritePayload;
};

export function useUpdateCommitteeMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, payload }: Input) => updateCommittee(id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.committees });
    }
  });
}