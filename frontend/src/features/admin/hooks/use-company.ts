"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getCompany, updateCompany, CompanyUpdatePayload } from "@/features/admin/api/admin.api";

const companyQueryKey = ["admin", "company"] as const;

export function useCompanyQuery() {
  return useQuery({
    queryKey: companyQueryKey,
    queryFn: () => getCompany()
  });
}

export function useUpdateCompanyMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CompanyUpdatePayload) => updateCompany(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: companyQueryKey });
    }
  });
}
