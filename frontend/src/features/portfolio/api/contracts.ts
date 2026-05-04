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
  distinct_customers?: number | null;
  insured_limit_amount?: number | string | null;
  total_insured_limit_amount?: number | string | null;
  import_meta?: {
    import_run_id?: number;
    base_date?: string;
    status?: string;
    created_at?: string;
    imported_at?: string;
    imported_by?: string | null;
  };
  bod_snapshot?: PortfolioBodSnapshotDto;
  bu_breakdown?: Array<{
    bu: string;
    total_open: number | string;
    overdue: number | string;
    not_due: number | string;
    insured_limit: number | string;
    uncovered_exposure: number | string;
  }>;
  litigation_summary?: {
    total_open: number | string;
    overdue: number | string;
    not_due: number | string;
    insured_limit: number | string;
    uncovered_exposure: number | string;
  };
  litigation_by_bu?: Array<{
    bu: string;
    total_open: number | string;
    overdue: number | string;
    not_due: number | string;
  }>;
  aging_buckets_by_bu?: {
    not_due?: Array<{ bucket: string; values: Array<{ bu: string; amount: number | string }> }>;
    overdue?: Array<{ bucket: string; values: Array<{ bu: string; amount: number | string }> }>;
  };
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

export type PortfolioAgingAlertSeverity = "critical" | "warning" | "info";

export type PortfolioAgingAlertDto = {
  id: string;
  severity: PortfolioAgingAlertSeverity;
  title: string;
  message: string;
  metric?: string | null;
  value?: number | null;
  base_date?: string | null;
  delta?: {
    direction: "up" | "down" | "flat";
    value: number;
    formatted: string;
  } | null;
};

export type PortfolioMovementSeverity = "critical" | "warning" | "info";
export type PortfolioMovementDirection = "up" | "down" | "flat";

export type PortfolioMovementDto = {
  id: string;
  entity_type: "customer" | "group";
  entity_name: string;
  cnpj?: string | null;
  metric: "overdue_amount" | "total_open_amount" | "uncovered_exposure" | "probable_amount";
  direction: PortfolioMovementDirection;
  delta: number;
  current_value: number;
  previous_value: number;
  severity: PortfolioMovementSeverity;
  message: string;
};

export type PortfolioMovementsLatestDto = {
  base_date: string;
  previous_base_date?: string | null;
  message?: string | null;
  movements: PortfolioMovementDto[];
};

export type PortfolioRiskSummaryDto = {
  at_risk_amount: number;
  at_risk_percentage: number;
  healthy_percentage: number;
  clients_at_risk: number;
  distribution: {
    critical: { amount: number; percentage: number; clients: number };
    attention: { amount: number; percentage: number; clients: number };
    healthy: { amount: number; percentage: number; clients: number };
  };
};
