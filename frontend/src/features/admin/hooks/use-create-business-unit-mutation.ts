"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { BusinessUnitPayload, createBusinessUnit } from "@/features/admin/api/admin.api";
import { adminQueryKeys } from "@/features/admin/hooks/query-keys";

export function useCreateBusinessUnitMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: BusinessUnitPayload) => createBusinessUnit(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.businessUnits });
    }
  });
}
