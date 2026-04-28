export type UploadFileMetadataInput = {
  original_filename: string;
  mime_type: string;
  file_size: number;
};

export type ManualInputBlock = {
  enabled: boolean;
  negativations_count: number;
  negativations_amount: number;
  protests_count: number;
  protests_amount: number;
  active_lawsuits: boolean;
  observations: string;
  comments: string;
  has_commercial_history: boolean;
  commercial_history_revenue: number | null;
  contractual_avg_term_days: number | null;
  effective_avg_term_days: number | null;
};

export type OcrInputBlock = {
  enabled: boolean;
  active: number | null;
  liabilities: number | null;
  equity: number | null;
  gross_revenue: number | null;
  net_revenue: number | null;
  costs: number | null;
  expenses: number | null;
  profit: number | null;
  additional_fields: string;
  files: UploadFileMetadataInput[];
};

export type InternalImportInputBlock = {
  enabled: boolean;
  rows_count: number | null;
  template_validated: boolean;
  notes: string;
  files: UploadFileMetadataInput[];
};

export type ExternalImportInputBlock = {
  enabled: boolean;
  source_type: "agrisk" | "serasa" | "scr" | "other";
  coface_read_id: number | null;
  coface_decision_amount: number | null;
  source_score: number | null;
  source_rating: string;
  negativations_count: number;
  protests_count: number;
  lawsuits_count: number;
  has_restrictions: boolean;
  notes: string;
  files: UploadFileMetadataInput[];
};

export type AnalysisJourneySubmitRequest = {
  existing_customer_id: number | null;
  customer: {
    company_name: string;
    document_number: string;
    segment: string;
    region: string;
    relationship_start_date: string | null;
    address: string;
    phone: string;
  };
  analysis: {
    requested_limit: number;
    current_limit: number;
    used_limit: number;
    guarantee_limit: number;
    guarantee_limit_source: "manual" | "coface_report";
    exposure_amount: number;
    annual_revenue_estimated: number;
    assigned_analyst_name: string;
  };
  inputs: {
    manual: ManualInputBlock;
    ocr: OcrInputBlock;
    internal_import: InternalImportInputBlock;
    external_import: ExternalImportInputBlock;
  };
};

export type AnalysisJourneySubmitResponse = {
  analysis_id: number;
  customer_id: number;
  score_calculated: boolean;
  decision_calculated: boolean;
  warnings: string[];
};

export type ReportImportStatus = "pending" | "processing" | "valid" | "valid_with_warnings" | "invalid" | "error";
export type AgriskImportStatus = ReportImportStatus;

export type AgriskReportReadResponse = {
  id: number;
  source_type: "agrisk";
  status: ReportImportStatus;
  original_filename: string;
  mime_type: string;
  file_size: number;
  customer_document_number: string;
  report_document_number: string | null;
  is_document_match: boolean;
  validation_message: string | null;
  score_primary: number | null;
  score_source: string | null;
  warnings: string[];
  confidence: "high" | "medium" | "low" | null;
  read_payload: {
    company?: {
      name?: string | null;
      document?: string | null;
      opened_at?: string | null;
      age_years?: number | null;
      legal_nature?: string | null;
      capital_social?: number | null;
      status?: string | null;
    };
    credit?: {
      score?: number | null;
      score_source?: string | null;
      rating?: string | null;
      default_probability?: number | null;
      default_probability_label?: string | null;
      secondary_scores?: Array<{
        source?: string | null;
        score?: number | null;
        rating?: string | null;
        default_probability?: number | null;
      }>;
    };
    restrictions?: {
      negative_events_count?: number;
      negative_events_total_amount?: number;
      last_negative_event_at?: string | null;
    };
    protests?: {
      count?: number;
      total_amount?: number;
    };
    checks_without_funds?: {
      has_records?: boolean;
      items?: string[];
    };
    consultations?: {
      total?: number;
      items?: string[];
    };
    ownership?: {
      shareholding?: string[];
      partners?: string[];
    };
    read_quality?: {
      confidence?: "high" | "medium" | "low";
      warnings?: string[];
      anchors_found?: string[];
      anchors_missing?: string[];
    };
  };
  created_at: string;
};

export type CofaceReportReadResponse = {
  id: number;
  source_type: "coface";
  status: ReportImportStatus;
  original_filename: string;
  mime_type: string;
  file_size: number;
  customer_document_number: string;
  report_document_number: string | null;
  is_document_match: boolean;
  validation_message: string | null;
  score_primary: number | null;
  score_source: string | null;
  warnings: string[];
  confidence: "high" | "medium" | "low" | null;
  read_payload: {
    company?: {
      name?: string | null;
      document?: string | null;
      document_type?: "cnpj" | null;
      address?: string | null;
    };
    coface?: {
      easy_number?: string | null;
      cra?: string | null;
      dra?: number | null;
      decision_status?: string | null;
      decision_amount?: number | null;
      decision_currency?: string | null;
      decision_effective_date?: string | null;
      notation?: string | null;
    };
    read_quality?: {
      confidence?: "high" | "medium" | "low";
      warnings?: string[];
    };
  };
  created_at: string;
};

export type ExternalCnpjLookupResponse = {
  status: "ok" | "not_found" | "unavailable" | "invalid_input";
  message: string | null;
  data: {
    cnpj: string;
    razao_social: string | null;
    nome_fantasia: string | null;
    email: string | null;
    telefone: string | null;
    address: {
      cep: string | null;
      logradouro: string | null;
      numero: string | null;
      complemento: string | null;
      bairro: string | null;
      municipio: string | null;
      uf: string | null;
    };
  } | null;
};
