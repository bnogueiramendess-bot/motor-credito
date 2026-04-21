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

export type ExternalCnpjLookupResponse = {
  status: "ok" | "not_found" | "unavailable";
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
