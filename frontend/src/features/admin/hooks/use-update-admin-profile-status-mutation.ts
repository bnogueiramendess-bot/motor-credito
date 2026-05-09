"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { ProfileStatus, updateAdminProfileStatus } from "@/features/admin/api/admin.api";
import { adminQueryKeys } from "@/features/admin/hooks/query-keys";

type ProfileStatusInput = {
  id: number;
  status: ProfileStatus;
};

export function useUpdateAdminProfileStatusMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, status }: ProfileStatusInput) => updateAdminProfileStatus(id, status),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.profiles });
    }
  });
}
