import { apiClient } from "@/shared/lib/http/http-client";

export type AgingImportStatus = "processing" | "valid" | "valid_with_warnings" | "error";

export type AgingImportItem = {
  id: number;
  base_date: string;
  status: AgingImportStatus;
  original_filename: string;
  mime_type: string;
  file_size: number;
  warnings: string[];
  totals: Record<string, unknown>;
  created_at: string;
  imported_by?: string | null;
  snapshot_type?: "daily" | "monthly_closing";
  is_month_end_closing?: boolean;
  closing_month?: number | null;
  closing_year?: number | null;
  closing_label?: string | null;
  closing_status?: "official" | "superseded" | "cancelled" | null;
};

type AgingImportHistoryResponse = {
  items: AgingImportItem[];
};

export type CreateAgingImportInput = {
  original_filename: string;
  mime_type: string;
  file_size: number;
  file_content_base64: string;
  overwrite?: boolean;
  imported_by?: string;
  snapshot_type?: "daily" | "monthly_closing";
  closing_month?: number;
  closing_year?: number;
};

export async function createAgingImport(payload: CreateAgingImportInput) {
  return apiClient.post<AgingImportItem, CreateAgingImportInput>("/api/ar-aging-imports", payload);
}

export async function getAgingImportsHistory(limit = 10) {
  const payload = await apiClient.get<AgingImportHistoryResponse | AgingImportItem[]>("/api/ar-aging-imports/history?limit=" + limit);
  if (Array.isArray(payload)) {
    return payload;
  }
  return Array.isArray(payload.items) ? payload.items : [];
}
