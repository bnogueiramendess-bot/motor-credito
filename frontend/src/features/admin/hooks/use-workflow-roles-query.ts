"use client";

import { useQuery } from "@tanstack/react-query";

import { listWorkflowRoles } from "@/features/admin/api/admin.api";
import { adminQueryKeys } from "@/features/admin/hooks/query-keys";

export function useWorkflowRolesQuery() {
  return useQuery({
    queryKey: adminQueryKeys.workflowRoles,
    queryFn: () => listWorkflowRoles()
  });
}
