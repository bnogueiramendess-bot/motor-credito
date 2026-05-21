"use client";

import { useQuery } from "@tanstack/react-query";

import { getApprovalMatrixOptions } from "@/features/admin/api/admin.api";
import { adminQueryKeys } from "@/features/admin/hooks/query-keys";

export function useApprovalMatrixOptionsQuery() {
  return useQuery({
    queryKey: adminQueryKeys.approvalMatrixOptions,
    queryFn: () => getApprovalMatrixOptions()
  });
}
