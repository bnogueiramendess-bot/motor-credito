"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { UpsertAdminProfilePayload, updateAdminProfile } from "@/features/admin/api/admin.api";
import { adminQueryKeys } from "@/features/admin/hooks/query-keys";

type UpdateProfileInput = {
  id: number;
  payload: UpsertAdminProfilePayload;
};

export function useUpdateAdminProfileMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, payload }: UpdateProfileInput) => updateAdminProfile(id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.profiles });
    }
  });
}
