"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { updateAdminUser, UpdateAdminUserPayload } from "@/features/admin/api/admin.api";
import { adminQueryKeys } from "@/features/admin/hooks/query-keys";

type Input = {
  id: number;
  payload: UpdateAdminUserPayload;
};

export function useUpdateAdminUserMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, payload }: Input) => updateAdminUser(id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.users });
    }
  });
}
