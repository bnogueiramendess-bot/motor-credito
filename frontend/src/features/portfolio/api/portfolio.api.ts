import { apiClient } from "@/shared/lib/http/http-client";

import {
  PortfolioAgingAlertDto,
  PortfolioAgingLatestDto,
  PortfolioCustomerDto,
  PortfolioGroupCardDto,
  PortfolioMovementsLatestDto,
  PortfolioOpenInvoiceDto,
  PortfolioRiskSummaryDto
} from "@/features/portfolio/api/contracts";

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

  const base = candidate as Record<string, unknown>;
  const snapshotCandidate = asRecord.bod_snapshot;
  const bodSnapshot =
    snapshotCandidate === null
      ? null
      : snapshotCandidate && typeof snapshotCandidate === "object" && !Array.isArray(snapshotCandidate)
        ? snapshotCandidate
        : undefined;

  return {
    ...(base as PortfolioAgingLatestDto),
    import_meta:
      asRecord.import_meta && typeof asRecord.import_meta === "object" && !Array.isArray(asRecord.import_meta)
        ? (asRecord.import_meta as PortfolioAgingLatestDto["import_meta"])
        : undefined,
    bod_snapshot: bodSnapshot
  } as PortfolioAgingLatestDto;
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

export async function getPortfolioAgingAlertsLatest() {
  const payload = await apiClient.get<unknown>("/api/portfolio/aging/alerts/latest");
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const asRecord = payload as Record<string, unknown>;
  const alertsCandidate = asRecord.alerts;
  if (!Array.isArray(alertsCandidate)) {
    return [];
  }

  return alertsCandidate as PortfolioAgingAlertDto[];
}

export async function getPortfolioAgingMovementsLatest() {
  const payload = await apiClient.get<unknown>("/api/portfolio/aging/movements/latest");
  if (!payload || typeof payload !== "object") {
    return { base_date: "", previous_base_date: null, message: "Ainda não há base anterior suficiente para comparação.", movements: [] } as PortfolioMovementsLatestDto;
  }
  const asRecord = payload as Record<string, unknown>;
  return {
    base_date: String(asRecord.base_date ?? ""),
    previous_base_date: (asRecord.previous_base_date as string | null | undefined) ?? null,
    message: (asRecord.message as string | null | undefined) ?? null,
    movements: Array.isArray(asRecord.movements) ? (asRecord.movements as PortfolioMovementsLatestDto["movements"]) : []
  };
}

export async function getPortfolioRiskSummary() {
  const payload = await apiClient.get<unknown>("/api/portfolio/risk-summary");
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const asRecord = payload as Record<string, unknown>;
  if (!asRecord.distribution || typeof asRecord.distribution !== "object" || Array.isArray(asRecord.distribution)) {
    return null;
  }

  return asRecord as unknown as PortfolioRiskSummaryDto;
}

export async function getPortfolioGroupOpenInvoices(economicGroup: string) {
  const encodedGroup = encodeURIComponent(economicGroup);
  const payload = await apiClient.get<unknown>(`/api/portfolio/groups/${encodedGroup}/open-invoices`);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [] as PortfolioOpenInvoiceDto[];
  }
  const asRecord = payload as Record<string, unknown>;
  return Array.isArray(asRecord.items) ? (asRecord.items as PortfolioOpenInvoiceDto[]) : [];
}

export async function getPortfolioCustomerOpenInvoices(cnpj: string) {
  const encodedCnpj = encodeURIComponent(cnpj);
  const payload = await apiClient.get<unknown>(`/api/portfolio/customers/${encodedCnpj}/open-invoices`);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [] as PortfolioOpenInvoiceDto[];
  }
  const asRecord = payload as Record<string, unknown>;
  return Array.isArray(asRecord.items) ? (asRecord.items as PortfolioOpenInvoiceDto[]) : [];
}

export async function getPortfolioGroups(params?: { bu?: string; q?: string }) {
  const query = new URLSearchParams();
  if (params?.bu) query.set("bu", params.bu);
  if (params?.q) query.set("q", params.q);
  const suffix = query.toString();
  const payload = await apiClient.get<unknown>(`/api/portfolio/groups${suffix ? `?${suffix}` : ""}`);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [] as PortfolioGroupCardDto[];
  }
  const asRecord = payload as Record<string, unknown>;
  return Array.isArray(asRecord.items) ? (asRecord.items as PortfolioGroupCardDto[]) : [];
}
