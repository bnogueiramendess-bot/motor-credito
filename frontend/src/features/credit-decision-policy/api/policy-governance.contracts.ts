export type PolicyGovernanceDecisionRequest = {
  workflow_role_code?: string | null;
  justification?: string | null;
};

export type PolicyGovernanceActionRequest = {
  justification?: string | null;
  metadata_json?: Record<string, unknown>;
};

export type PolicyGovernanceRequestApprovalDto = {
  workflow_role_code: string;
  decision: "approved" | "rejected" | null | string;
  approved_by_user_id: number | null;
  justification: string | null;
  decided_at: string | null;
};

export type PolicyGovernanceRequestDto = {
  request_id: number;
  company_id: number;
  policy_id: number | null;
  action_type: string;
  approval_item_type: string;
  status: string;
  requested_by_user_id: number | null;
  requested_at: string | null;
  justification: string | null;
  metadata_json: Record<string, unknown>;
  approved_at: string | null;
  rejected_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  required_roles: string[];
  approved_roles: string[];
  rejected_roles: string[];
  pending_roles: string[];
  approvals: PolicyGovernanceRequestApprovalDto[];
};

export type PolicyGovernanceRequesterDto = {
  id: number | null;
  name: string | null;
  email: string | null;
} | null;

export type PolicyGovernanceSummaryRequestDto = {
  id: number;
  approval_item_type: "CREDIT_POLICY" | string;
  action_type: string;
  status: string;
  requested_at: string | null;
  requested_by: PolicyGovernanceRequesterDto;
  justification: string | null;
  metadata_json?: Record<string, unknown> | null;
};

export type PolicyGovernanceSummaryPolicyDto = {
  id: number;
  code: string | null;
  name: string | null;
  version: number | string | null;
  status: string | null;
  description?: string | null;
  effective_from?: string | null;
  effective_to?: string | null;
  activated_at?: string | null;
} | null;

export type PolicyGovernanceSummaryGovernanceDto = {
  required_roles: string[];
  approved_roles: string[];
  pending_roles: string[];
  rejected_roles: string[];
  can_current_user_decide: boolean;
  current_user_decision_roles: string[];
  approvals?: PolicyGovernanceRequestApprovalDto[];
};

export type PolicyGovernanceExecutiveSummaryDto = {
  title: string | null;
  description: string | null;
  action_label: string | null;
  risk_level: "low" | "medium" | "high" | string | null;
  impact_summary: string[];
};

export type PolicyGovernancePillarSnapshotDto = {
  code: string | null;
  name: string | null;
  weight: number | string | null;
  status: string | null;
  subgroups_count?: number | null;
  indicators_count?: number | null;
};

export type PolicyGovernanceSnapshotDto = {
  pillars: PolicyGovernancePillarSnapshotDto[];
  total_weight: number | string | null;
  configured_pillars: number | null;
  planned_pillars: number | null;
  warnings?: string[];
};

export type PolicyGovernanceChangeDto = {
  change_type: string;
  area: string | null;
  label: string | null;
  before: unknown;
  after: unknown;
  severity: "low" | "medium" | "high" | string;
};

export type PolicyGovernanceChangesDto = {
  has_comparison: boolean;
  base_policy_id: number | null;
  target_policy_id: number | null;
  summary: PolicyGovernanceChangeDto[];
  critical_changes: PolicyGovernanceChangeDto[];
  warnings: string[];
};

export type PolicyGovernanceExecutiveSummaryResponse = {
  request: PolicyGovernanceSummaryRequestDto;
  policy: PolicyGovernanceSummaryPolicyDto;
  governance: PolicyGovernanceSummaryGovernanceDto;
  executive_summary: PolicyGovernanceExecutiveSummaryDto;
  policy_snapshot: PolicyGovernanceSnapshotDto;
  changes: PolicyGovernanceChangesDto;
};
