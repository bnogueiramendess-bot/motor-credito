"use client";

import { useQuery } from "@tanstack/react-query";

import { listCommittees } from "@/features/admin/api/admin.api";
import { adminQueryKeys } from "@/features/admin/hooks/query-keys";

export function useCommitteesQuery() {
  return useQuery({
    queryKey: adminQueryKeys.committees,
    queryFn: () => listCommittees()
  });
}