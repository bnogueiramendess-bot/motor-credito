"use client";

import { useQuery } from "@tanstack/react-query";

import { getApprovalMatrixNextCode } from "@/features/admin/api/admin.api";
import { adminQueryKeys } from "@/features/admin/hooks/query-keys";

export function useApprovalMatrixNextCodeQuery() {
  return useQuery({
    queryKey: adminQueryKeys.approvalMatrixNextCode,
    queryFn: () => getApprovalMatrixNextCode()
  });
}
