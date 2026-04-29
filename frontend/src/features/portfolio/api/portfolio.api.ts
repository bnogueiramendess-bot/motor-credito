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
  const payload = await apiClient.get<unknown>(`/api/portfolio/aging/latest${buildQuery(params)}`);

  if (!payload || typeof payload !== "object") {
    return null;
  }

  const asRecord = payload as Record<string, unknown>;
  const candidate = (asRecord.totals ?? asRecord.data ?? asRecord.result ?? asRecord.aging ?? payload) as unknown;

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  return candidate as PortfolioAgingLatestDto;
}

export async function getPortfolioCustomers(params?: PortfolioQueryParams) {
  const payload = await apiClient.get<unknown>(`/api/portfolio/customers${buildQuery(params)}`);

  if (Array.isArray(payload)) {
    return payload as PortfolioCustomerDto[];
  }

  if (payload && typeof payload === "object") {
    const asRecord = payload as Record<string, unknown>;
    const listCandidate = asRecord.items ?? asRecord.results ?? asRecord.data ?? asRecord.customers;
    if (Array.isArray(listCandidate)) {
      return listCandidate as PortfolioCustomerDto[];
    }
  }

  return [];
}
