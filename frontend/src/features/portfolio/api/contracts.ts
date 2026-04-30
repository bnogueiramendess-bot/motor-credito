export type PortfolioBodRiskBandDto = {
  amount?: number | string | null;
  customers_count?: number | null;
};

export type PortfolioBodAgingBucketDto = {
  label: string;
  amount: number | string;
};

export type PortfolioBodSnapshotDto = {
  risk?: {
    probable?: PortfolioBodRiskBandDto;
    possible?: PortfolioBodRiskBandDto;
    rare?: PortfolioBodRiskBandDto;
  };
  aging_buckets?: {
    not_due?: PortfolioBodAgingBucketDto[];
    overdue?: PortfolioBodAgingBucketDto[];
  };
  totals?: Record<string, unknown>;
  warnings?: string[];
} | null;

export type PortfolioAgingLatestDto = {
  total_open_amount: number | string | null;
  total_overdue_amount: number | string | null;
  total_not_due_amount: number | string | null;
  insured_limit_amount?: number | string | null;
  total_insured_limit_amount?: number | string | null;
  bod_snapshot?: PortfolioBodSnapshotDto;
  [key: string]: unknown;
};

export type PortfolioCustomerDto = {
  id?: number;
  customer_id?: number;
  company_name?: string | null;
  legal_name?: string | null;
  trade_name?: string | null;
  document_number?: string | null;
  cnpj?: string | null;
  score?: unknown;
  decision?: unknown;
  requested_limit?: number | string | null;
  suggested_limit?: number | string | null;
  final_limit?: number | string | null;
  [key: string]: unknown;
};
