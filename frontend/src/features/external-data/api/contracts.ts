import { CreditAnalysisDto, CustomerDto, DecisionEventDto } from "@/features/credit-analyses/api/contracts";

export type EntryMethod = "manual" | "upload" | "automatic";
export type SourceType = "agrisk" | "serasa" | "scr" | "internal_sheet" | "other";

export type ExternalDataFileSummaryDto = {
  id: number;
  original_filename: string;
  stored_filename: string;
  mime_type: string;
  file_size: number;
  storage_path: string;
  uploaded_at: string;
};

export type ExternalDataEntryDto = {
  id: number;
  credit_analysis_id: number;
  entry_method: EntryMethod;
  source_type: SourceType;
  report_date: string | null;
  source_score: number | string | null;
  source_rating: string | null;
  has_restrictions: boolean;
  protests_count: number;
  protests_amount: number | string;
  lawsuits_count: number;
  lawsuits_amount: number | string;
  bounced_checks_count: number;
  declared_revenue: number | string | null;
  declared_indebtedness: number | string | null;
  notes: string | null;
  created_at: string;
};

export type ExternalDataEntryDashboardDto = ExternalDataEntryDto & {
  files: ExternalDataFileSummaryDto[];
  detail_fetch_status: "available" | "failed";
  detail_fetch_error: string | null;
};

export type ExternalDataDashboardApiResponse = {
  analysis: CreditAnalysisDto;
  customer: CustomerDto | null;
  events: DecisionEventDto[];
  entries: ExternalDataEntryDashboardDto[];
};
