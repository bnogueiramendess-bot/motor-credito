"use client";

import { useQuery } from "@tanstack/react-query";

import { listAdminUsers } from "@/features/admin/api/admin.api";
import { adminQueryKeys } from "@/features/admin/hooks/query-keys";

export function useAdminUsersQuery() {
  return useQuery({
    queryKey: adminQueryKeys.users,
    queryFn: () => listAdminUsers()
  });
}
