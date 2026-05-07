"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { BusinessUnitPayload, updateBusinessUnit } from "@/features/admin/api/admin.api";
import { adminQueryKeys } from "@/features/admin/hooks/query-keys";

export function useUpdateBusinessUnitMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: BusinessUnitPayload }) => updateBusinessUnit(id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.businessUnits });
    }
  });
}
