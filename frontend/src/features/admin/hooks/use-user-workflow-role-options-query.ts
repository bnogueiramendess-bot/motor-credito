"use client";

import { useQuery } from "@tanstack/react-query";

import { listUserWorkflowRoleOptions } from "@/features/admin/api/admin.api";
import { adminQueryKeys } from "@/features/admin/hooks/query-keys";

export function useUserWorkflowRoleOptionsQuery() {
  return useQuery({
    queryKey: adminQueryKeys.userWorkflowRoleOptions,
    queryFn: () => listUserWorkflowRoleOptions()
  });
}
