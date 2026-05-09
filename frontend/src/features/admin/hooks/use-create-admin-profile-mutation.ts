"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { createAdminProfile, UpsertAdminProfilePayload } from "@/features/admin/api/admin.api";
import { adminQueryKeys } from "@/features/admin/hooks/query-keys";

export function useCreateAdminProfileMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: UpsertAdminProfilePayload) => createAdminProfile(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.profiles });
    }
  });
}
