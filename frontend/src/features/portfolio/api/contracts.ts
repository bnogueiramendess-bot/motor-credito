export type PortfolioAgingLatestDto = {
  total_open_amount: number | string | null;
  total_overdue_amount: number | string | null;
  total_not_due_amount: number | string | null;
  insured_limit_amount?: number | string | null;
  total_insured_limit_amount?: number | string | null;
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
