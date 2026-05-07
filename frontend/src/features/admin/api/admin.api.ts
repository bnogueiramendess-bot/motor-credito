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
  full_name: string;
  email: string;
  role: string;
  is_active: boolean;
  business_unit_ids: number[];
};

export type InviteUserPayload = {
  full_name: string;
  email: string;
  role: "administrador_master" | "administrador_bu" | "analista" | "visualizador";
  business_unit_ids: number[];
};

export type InviteUserResponse = {
  invitation_token: string;
  email: string;
};

export type ResetOperationalDataResponse = {
  status: string;
  total_deleted: number;
  tables: Array<{
    table: string;
    deleted: number;
    sequence_reset: boolean;
  }>;
};

export async function listAdminUsers() {
  return apiClient.get<AdminUserDto[]>("/api/admin/users");
}

export async function listBusinessUnits() {
  return apiClient.get<BusinessUnitDto[]>("/api/admin/business-units");
}

export type BusinessUnitPayload = {
  name: string;
  code?: string | null;
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

export async function inviteAdminUser(payload: InviteUserPayload) {
  return apiClient.post<InviteUserResponse, InviteUserPayload>("/api/admin/users/invite", payload);
}

export async function resetOperationalData(confirm: string) {
  return apiClient.post<ResetOperationalDataResponse, { confirm: string }>(
    "/api/admin/reset-operational-data",
    { confirm }
  );
}
