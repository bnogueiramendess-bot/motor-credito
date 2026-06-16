import { apiClient } from "@/shared/lib/http/http-client";

import {
  PolicyGovernanceDecisionRequest,
  PolicyGovernanceExecutiveSummaryResponse,
  PolicyGovernanceRequestDto,
} from "@/features/credit-decision-policy/api/policy-governance.contracts";

export async function listPolicyGovernanceRequests() {
  return apiClient.get<PolicyGovernanceRequestDto[]>("/api/credit-decision-policies/governance-requests");
}

export async function getPolicyGovernanceExecutiveSummary(requestId: number) {
  return apiClient.get<PolicyGovernanceExecutiveSummaryResponse>(
    `/api/credit-decision-policies/governance-requests/${requestId}/executive-summary`,
  );
}

export async function approvePolicyGovernanceRequest(
  requestId: number,
  payload: PolicyGovernanceDecisionRequest,
) {
  return apiClient.post<unknown, PolicyGovernanceDecisionRequest>(
    `/api/credit-decision-policies/governance-requests/${requestId}/approve`,
    payload,
  );
}

export async function rejectPolicyGovernanceRequest(
  requestId: number,
  payload: PolicyGovernanceDecisionRequest,
) {
  return apiClient.post<unknown, PolicyGovernanceDecisionRequest>(
    `/api/credit-decision-policies/governance-requests/${requestId}/reject`,
    payload,
  );
}
