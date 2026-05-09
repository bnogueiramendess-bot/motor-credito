"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { updateAdminUserStatus } from "@/features/admin/api/admin.api";
import { adminQueryKeys } from "@/features/admin/hooks/query-keys";

type Input = {
  id: number;
  isActive: boolean;
};

export function useUpdateAdminUserStatusMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, isActive }: Input) => updateAdminUserStatus(id, isActive),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.users });
    }
  });
}
