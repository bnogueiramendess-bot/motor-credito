import { apiClient } from "@/shared/lib/http/http-client";

import { PortfolioAgingLatestDto, PortfolioCustomerDto } from "@/features/portfolio/api/contracts";

type PortfolioQueryParams = {
  cnpj?: string;
  bu?: string;
};

function buildQuery(params?: PortfolioQueryParams) {
  const query = new URLSearchParams();

  if (params?.cnpj) {
    query.set("cnpj", params.cnpj);
  }

  if (params?.bu) {
    query.set("bu", params.bu);
  }

  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}

export async function getPortfolioAgingLatest(params?: Pick<PortfolioQueryParams, "bu">) {
  return apiClient.get<PortfolioAgingLatestDto | null>(`/api/portfolio/aging/latest${buildQuery(params)}`);
}

export async function getPortfolioCustomers(params?: PortfolioQueryParams) {
  return apiClient.get<PortfolioCustomerDto[]>(`/api/portfolio/customers${buildQuery(params)}`);
}
