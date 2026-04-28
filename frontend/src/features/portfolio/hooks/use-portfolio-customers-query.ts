"use client";

import { useQuery } from "@tanstack/react-query";

import { getPortfolioCustomers } from "@/features/portfolio/api/portfolio.api";

type UsePortfolioCustomersQueryParams = {
  cnpj?: string;
  bu?: string;
};

export function usePortfolioCustomersQuery(params?: UsePortfolioCustomersQueryParams) {
  return useQuery({
    queryKey: ["portfolio-customers", params?.cnpj ?? null, params?.bu ?? null],
    queryFn: () => getPortfolioCustomers(params)
  });
}
