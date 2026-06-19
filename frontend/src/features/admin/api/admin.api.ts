import { apiClient } from "@/shared/lib/http/http-client";

export type BusinessUnitDto = {
  id: number;
  company_id: number;
  code: string;
  name: string;
  head_name: string;
  head_email: string;
  is_active: boolean;
};

export type CompanyDto = {
  id: number;
  legal_name: string;
  trade_name: string | null;
  cnpj: string | null;
  is_active: boolean;
  corporate_email_required: boolean;
  allowed_domains: string[];
};

export type CompanyUpdatePayload = {
  legal_name: string;
  trade_name: string | null;
  cnpj: string;
  is_active: boolean;
  corporate_email_required: boolean;
  allowed_domains: string[];
};

export type AdminUserDto = {
  id: number;
  user_code: string;
  username: string;
  full_name: string;
  email: string;
  phone: string | null;
  profile_name: string;
  is_administrator: boolean;
  can_import_ar_aging: boolean;
  is_active: boolean;
  first_access_pending: boolean;
  business_unit_ids: number[];
  business_unit_names: string[];
  workflow_role_codes: string[];
};

export type WorkflowRoleType = "operational" | "governance" | "approval";

export type WorkflowRoleDto = {
  id: number;
  code: string;
  name: string;
  description: string;
  type: WorkflowRoleType;
  is_active: boolean;
};

export type PolicyGovernanceApprovalType = "POLICY_PUBLISH" | "POLICY_ARCHIVE" | "POLICY_STRUCTURE_CHANGE";

export type CompanyPolicyGovernanceRoleDto = {
  role_id: number;
  role_code: string;
  role_name: string;
};

export type CompanyPolicyGovernanceDto = {
  company_id: number;
  approval_roles: Record<PolicyGovernanceApprovalType, CompanyPolicyGovernanceRoleDto[]>;
  fallback_used: Partial<Record<PolicyGovernanceApprovalType, boolean>>;
};

export type CompanyPolicyGovernanceUpdatePayload = {
  approval_roles: Record<PolicyGovernanceApprovalType, number[]>;
};

export type UserWorkflowRoleDto = {
  role_id: number;
  code: string;
  name: string;
  description: string;
  type: WorkflowRoleType;
  business_unit_id: number | null;
  business_unit_name: string | null;
};

export type WorkflowRoleAssignmentPayload = {
  code: string;
  business_unit_id: number | null;
};

export type InviteUserPayload = {
  full_name: string;
  email: string;
  phone: string;
  profile_id: number | null;
  is_administrator?: boolean;
  can_import_ar_aging?: boolean;
  business_unit_ids: number[];
  workflow_role_assignments?: WorkflowRoleAssignmentPayload[];
};

export type InviteUserResponse = {
  invitation_token: string;
  email: string;
};

export type UpdateAdminUserPayload = {
  full_name: string;
  phone: string;
  profile_id: number | null;
  is_administrator?: boolean;
  can_import_ar_aging?: boolean;
  business_unit_ids: number[];
  workflow_role_assignments?: WorkflowRoleAssignmentPayload[];
};

export type ResetOperationalDataResponse = {
  status: string;
  reset_scope?: "total_operational" | "partial_operational" | string;
  domains?: string[];
  domain_summary?: Array<{
    key: string;
    label: string;
    description: string;
    tables: string[];
  }>;
  total_deleted: number;
  master_admin?: {
    status: "preserved" | "recreated" | string;
    email: string;
    profile: string;
    is_active: boolean;
    full_access: boolean;
  };
  coverage?: {
    missing_in_registry: string[];
    unknown_in_registry: string[];
  };
  default_master_user?: {
    email: string;
    password_reset_required: boolean;
  };
  tables: Array<{
    table: string;
    deleted: number;
    sequence_reset: boolean;
  }>;
};

export type ResetDomainKey =
  | "credit_analysis"
  | "external_reports"
  | "portfolio_ar"
  | "customers"
  | "operational_users"
  | "governance"
  | "credit_policies";

export type RoleMatrixItemDto = {
  role: string;
  permissions: string[];
};

export type ProfileStatus = "active" | "inactive";

export type AdminProfileDto = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  type: string;
  status: ProfileStatus;
  permission_keys: string[];
  is_protected: boolean;
};

export type UpsertAdminProfilePayload = {
  name: string;
  description: string | null;
  status: ProfileStatus;
  permission_keys: string[];
};

export type ApprovalMatrixRuleRoleDto = {
  workflow_role_id: number;
  workflow_role_code: string;
  workflow_role_name: string;
  workflow_role_type: WorkflowRoleType;
};

export type ApprovalMatrixRuleDto = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  is_active: boolean;
  min_amount: string | null;
  max_amount: string | null;
  currency: string;
  required_approvals: number;
  requires_committee: boolean;
  requires_unanimous: boolean;
  business_unit_id: number | null;
  business_unit_name: string | null;
  priority: number;
  roles: ApprovalMatrixRuleRoleDto[];
};

export type ApprovalMatrixRuleWritePayload = {
  code: string;
  name: string;
  description: string | null;
  is_active: boolean;
  min_amount: string | null;
  max_amount: string | null;
  currency: string;
  required_approvals: number;
  requires_committee: boolean;
  requires_unanimous: boolean;
  business_unit_id: number | null;
  priority: number;
  workflow_role_codes: string[];
};

export type ApprovalMatrixOptionsDto = {
  workflow_roles: Array<{ id: number; code: string; name: string; description?: string; type: WorkflowRoleType | string; is_active?: boolean }>;
  business_units: Array<{ id: number; code: string; name: string }>;
};

export type ApprovalMatrixNextCodeDto = {
  code: string;
};

export async function listAdminUsers() {
  return apiClient.get<AdminUserDto[]>("/api/admin/users");
}

export async function listBusinessUnits() {
  return apiClient.get<BusinessUnitDto[]>("/api/admin/business-units");
}

export type BusinessUnitPayload = {
  name: string;
  head_name: string;
  head_email: string;
  is_active: boolean;
};

export async function createBusinessUnit(payload: BusinessUnitPayload) {
  return apiClient.post<BusinessUnitDto, BusinessUnitPayload>("/api/admin/business-units", payload);
}

export async function updateBusinessUnit(id: number, payload: BusinessUnitPayload) {
  return apiClient.patch<BusinessUnitDto, BusinessUnitPayload>(`/api/admin/business-units/${id}`, payload);
}

export async function updateBusinessUnitStatus(id: number, isActive: boolean) {
  return apiClient.patch<BusinessUnitDto, { is_active: boolean }>(`/api/admin/business-units/${id}/status`, {
    is_active: isActive
  });
}

export async function getCompany() {
  return apiClient.get<CompanyDto>("/api/admin/company");
}

export async function updateCompany(payload: CompanyUpdatePayload) {
  return apiClient.patch<CompanyDto, CompanyUpdatePayload>("/api/admin/company", payload);
}

export async function getCompanyPolicyGovernance() {
  return apiClient.get<CompanyPolicyGovernanceDto>("/api/admin/company/policy-governance");
}

export async function updateCompanyPolicyGovernance(payload: CompanyPolicyGovernanceUpdatePayload) {
  return apiClient.put<CompanyPolicyGovernanceDto, CompanyPolicyGovernanceUpdatePayload>(
    "/api/admin/company/policy-governance",
    payload
  );
}

export async function inviteAdminUser(payload: InviteUserPayload) {
  return apiClient.post<InviteUserResponse, InviteUserPayload>("/api/admin/users/invite", payload);
}

export async function listWorkflowRoles() {
  return apiClient.get<WorkflowRoleDto[]>("/api/admin/workflow-roles");
}

export async function updateAdminUser(id: number, payload: UpdateAdminUserPayload) {
  return apiClient.patch<AdminUserDto, UpdateAdminUserPayload>(`/api/admin/users/${id}`, payload);
}

export async function listUserWorkflowRoles(userId: number) {
  return apiClient.get<UserWorkflowRoleDto[]>(`/api/admin/users/${userId}/workflow-roles`);
}

export async function updateUserWorkflowRoles(userId: number, assignments: WorkflowRoleAssignmentPayload[]) {
  return apiClient.put<UserWorkflowRoleDto[], { assignments: WorkflowRoleAssignmentPayload[] }>(
    `/api/admin/users/${userId}/workflow-roles`,
    { assignments }
  );
}

export async function updateAdminUserStatus(id: number, isActive: boolean) {
  return apiClient.patch<AdminUserDto, { is_active: boolean }>(`/api/admin/users/${id}/status`, { is_active: isActive });
}

export async function regenerateAdminUserInviteToken(id: number) {
  return apiClient.post<InviteUserResponse, Record<string, never>>(`/api/admin/users/${id}/invite-token`, {});
}

export async function resetOperationalData(confirm: string, domains?: string[]) {
  return apiClient.post<ResetOperationalDataResponse, { confirm: string; domains?: string[] }>(
    "/api/admin/reset-operational-data",
    { confirm, domains }
  );
}

export async function getRoleMatrix() {
  return apiClient.get<RoleMatrixItemDto[]>("/api/admin/roles/matrix");
}

export async function listAdminProfiles() {
  return apiClient.get<AdminProfileDto[]>("/api/admin/profiles");
}

export async function getAdminProfile(id: number) {
  return apiClient.get<AdminProfileDto>(`/api/admin/profiles/${id}`);
}

export async function createAdminProfile(payload: UpsertAdminProfilePayload) {
  return apiClient.post<AdminProfileDto, UpsertAdminProfilePayload>("/api/admin/profiles", payload);
}

export async function updateAdminProfile(id: number, payload: UpsertAdminProfilePayload) {
  return apiClient.patch<AdminProfileDto, UpsertAdminProfilePayload>(`/api/admin/profiles/${id}`, payload);
}

export async function updateAdminProfileStatus(id: number, status: ProfileStatus) {
  return apiClient.patch<AdminProfileDto, { status: ProfileStatus }>(`/api/admin/profiles/${id}/status`, { status });
}

export async function listApprovalMatrixRules() {
  return apiClient.get<ApprovalMatrixRuleDto[]>("/api/admin/approval-matrix");
}

export async function getApprovalMatrixOptions() {
  return apiClient.get<ApprovalMatrixOptionsDto>("/api/admin/approval-matrix/options");
}

export async function getApprovalMatrixNextCode() {
  return apiClient.get<ApprovalMatrixNextCodeDto>("/api/admin/approval-matrix/next-code");
}

export async function createApprovalMatrixRule(payload: ApprovalMatrixRuleWritePayload) {
  return apiClient.post<ApprovalMatrixRuleDto, ApprovalMatrixRuleWritePayload>("/api/admin/approval-matrix", payload);
}

export async function updateApprovalMatrixRule(id: number, payload: ApprovalMatrixRuleWritePayload) {
  return apiClient.put<ApprovalMatrixRuleDto, ApprovalMatrixRuleWritePayload>(`/api/admin/approval-matrix/${id}`, payload);
}
