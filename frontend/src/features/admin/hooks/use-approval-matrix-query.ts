"use client";

import { useQuery } from "@tanstack/react-query";

import { listApprovalMatrixRules } from "@/features/admin/api/admin.api";
import { adminQueryKeys } from "@/features/admin/hooks/query-keys";

export function useApprovalMatrixQuery() {
  return useQuery({
    queryKey: adminQueryKeys.approvalMatrix,
    queryFn: () => listApprovalMatrixRules()
  });
}
