"use client";

import { useMutation } from "@tanstack/react-query";

import { regenerateAdminUserInviteToken } from "@/features/admin/api/admin.api";

export function useRegenerateAdminUserInviteTokenMutation() {
  return useMutation({
    mutationFn: (id: number) => regenerateAdminUserInviteToken(id)
  });
}
