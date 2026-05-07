"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { inviteAdminUser, InviteUserPayload } from "@/features/admin/api/admin.api";
import { adminQueryKeys } from "@/features/admin/hooks/query-keys";

export function useInviteAdminUserMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: InviteUserPayload) => inviteAdminUser(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.users });
    }
  });
}
