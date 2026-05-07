"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { updateBusinessUnitStatus } from "@/features/admin/api/admin.api";
import { adminQueryKeys } from "@/features/admin/hooks/query-keys";

export function useUpdateBusinessUnitStatusMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) => updateBusinessUnitStatus(id, isActive),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.businessUnits });
    }
  });
}
