"use client";

import { useQuery } from "@tanstack/react-query";

import { getPortfolioCustomerOpenInvoices, getPortfolioGroupOpenInvoices } from "@/features/portfolio/api/portfolio.api";

type UsePortfolioOpenInvoicesQueryParams = {
  economicGroup?: string | null;
  cnpj?: string | null;
  snapshotId?: string | null;
  enabled?: boolean;
};

export function usePortfolioOpenInvoicesQuery(params: UsePortfolioOpenInvoicesQueryParams) {
  return useQuery({
    queryKey: ["portfolio-open-invoices", params.economicGroup ?? null, params.cnpj ?? null, params.snapshotId ?? "current"],
    queryFn: async () => {
      if (params.economicGroup) {
        return getPortfolioGroupOpenInvoices(params.economicGroup, params.snapshotId ?? undefined);
      }
      if (params.cnpj) {
        return getPortfolioCustomerOpenInvoices(params.cnpj, params.snapshotId ?? undefined);
      }
      return [];
    },
    enabled: Boolean(params.enabled && (params.economicGroup || params.cnpj))
  });
}
