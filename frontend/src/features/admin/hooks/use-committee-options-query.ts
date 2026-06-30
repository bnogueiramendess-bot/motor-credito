"use client";

import { useQuery } from "@tanstack/react-query";

import { getCommitteeOptions } from "@/features/admin/api/admin.api";
import { adminQueryKeys } from "@/features/admin/hooks/query-keys";

export function useCommitteeOptionsQuery() {
  return useQuery({
    queryKey: adminQueryKeys.committeeOptions,
    queryFn: () => getCommitteeOptions()
  });
}