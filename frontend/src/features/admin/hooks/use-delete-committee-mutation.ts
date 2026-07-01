"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { deleteCommittee } from "@/features/admin/api/admin.api";
import { adminQueryKeys } from "@/features/admin/hooks/query-keys";

export function useDeleteCommitteeMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => deleteCommittee(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.committees });
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.committeeNextCode });
    }
  });
}