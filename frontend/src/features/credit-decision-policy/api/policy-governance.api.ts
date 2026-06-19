import { apiClient } from "@/shared/lib/http/http-client";

import {
  PolicyGovernanceActionRequest,
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

export async function requestPolicyPublication(
  policyId: number,
  payload: PolicyGovernanceActionRequest,
) {
  return apiClient.post<PolicyGovernanceRequestDto, PolicyGovernanceActionRequest>(
    `/api/credit-decision-policies/${policyId}/request-publication`,
    payload,
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
