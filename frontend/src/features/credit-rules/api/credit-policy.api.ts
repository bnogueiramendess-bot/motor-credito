import { apiClient } from "@/shared/lib/http/http-client";

import {
  CreateCreditPolicyDraftRulePayload,
  CreditPolicyDto,
  CreditPolicyRuleDto,
  UpdateCreditPolicyDraftRulePayload
} from "@/features/credit-rules/api/credit-policy.contracts";

export async function getActiveCreditPolicy() {
  return apiClient.get<CreditPolicyDto>("/api/credit-policy/active");
}

export async function getDraftCreditPolicy() {
  return apiClient.get<CreditPolicyDto>("/api/credit-policy/draft");
}

export async function createCreditPolicyDraftRule(payload: CreateCreditPolicyDraftRulePayload) {
  return apiClient.post<CreditPolicyRuleDto, CreateCreditPolicyDraftRulePayload>("/api/credit-policy/draft/rules", payload);
}

export async function updateCreditPolicyDraftRule(ruleId: number, payload: UpdateCreditPolicyDraftRulePayload) {
  return apiClient.patch<CreditPolicyRuleDto, UpdateCreditPolicyDraftRulePayload>(`/api/credit-policy/draft/rules/${ruleId}`, payload);
}

export async function deleteCreditPolicyDraftRule(ruleId: number) {
  return apiClient.delete(`/api/credit-policy/draft/rules/${ruleId}`);
}

export async function publishCreditPolicyDraft() {
  return apiClient.post<CreditPolicyDto, Record<string, never>>("/api/credit-policy/draft/publish", {});
}

export async function resetCreditPolicyDraft() {
  return apiClient.post<CreditPolicyDto, Record<string, never>>("/api/credit-policy/draft/reset", {});
}
