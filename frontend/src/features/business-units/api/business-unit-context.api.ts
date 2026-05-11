import { apiClient } from "@/shared/lib/http/http-client";

export type BusinessUnitContextDto = {
  allowed_business_units: Array<{ id: number; code: string; name: string }>;
  can_view_consolidated: boolean;
  is_global_scope: boolean;
  default_context: { consolidated: boolean; business_unit_code?: string | null };
  consolidated_label: string;
};

export async function getBusinessUnitContext() {
  return apiClient.get<BusinessUnitContextDto>("/api/auth/me/business-units/context");
}
