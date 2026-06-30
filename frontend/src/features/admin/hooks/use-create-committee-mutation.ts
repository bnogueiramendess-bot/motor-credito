"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { CommitteeWritePayload, createCommittee } from "@/features/admin/api/admin.api";
import { adminQueryKeys } from "@/features/admin/hooks/query-keys";

export function useCreateCommitteeMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CommitteeWritePayload) => createCommittee(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.committees });
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.committeeNextCode });
    }
  });
}