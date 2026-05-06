import { apiClient } from "@/shared/lib/http/http-client";

export type ResetOperationalDataResponse = {
  status: string;
  total_deleted: number;
  tables: Array<{
    table: string;
    deleted: number;
    sequence_reset: boolean;
  }>;
};

export async function resetOperationalData(confirm: string) {
  return apiClient.post<ResetOperationalDataResponse, { confirm: string }>(
    "/api/admin/reset-operational-data",
    { confirm }
  );
}

