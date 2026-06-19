"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  CompanyPolicyGovernanceUpdatePayload,
  CompanyUpdatePayload,
  getCompany,
  getCompanyPolicyGovernance,
  updateCompany,
  updateCompanyPolicyGovernance,
} from "@/features/admin/api/admin.api";

const companyQueryKey = ["admin", "company"] as const;
const companyPolicyGovernanceQueryKey = ["admin", "company", "policy-governance"] as const;

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

export function useCompanyPolicyGovernanceQuery() {
  return useQuery({
    queryKey: companyPolicyGovernanceQueryKey,
    queryFn: () => getCompanyPolicyGovernance()
  });
}

export function useUpdateCompanyPolicyGovernanceMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CompanyPolicyGovernanceUpdatePayload) => updateCompanyPolicyGovernance(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: companyPolicyGovernanceQueryKey });
    }
  });
}
