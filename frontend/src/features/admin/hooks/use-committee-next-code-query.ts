"use client";

import { useQuery } from "@tanstack/react-query";

import { getCommitteeNextCode } from "@/features/admin/api/admin.api";
import { adminQueryKeys } from "@/features/admin/hooks/query-keys";

export function useCommitteeNextCodeQuery() {
  return useQuery({
    queryKey: adminQueryKeys.committeeNextCode,
    queryFn: () => getCommitteeNextCode(),
    enabled: false
  });
}