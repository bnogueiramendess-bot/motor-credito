"use client";

import { useQuery } from "@tanstack/react-query";

import { getRoleMatrix } from "@/features/admin/api/admin.api";
import { adminQueryKeys } from "@/features/admin/hooks/query-keys";

export function useRoleMatrixQuery() {
  return useQuery({
    queryKey: adminQueryKeys.roleMatrix,
    queryFn: () => getRoleMatrix()
  });
}
