"use client";

import { useQuery } from "@tanstack/react-query";

import { listBusinessUnits } from "@/features/admin/api/admin.api";
import { adminQueryKeys } from "@/features/admin/hooks/query-keys";

export function useBusinessUnitsQuery() {
  return useQuery({
    queryKey: adminQueryKeys.businessUnits,
    queryFn: () => listBusinessUnits()
  });
}
