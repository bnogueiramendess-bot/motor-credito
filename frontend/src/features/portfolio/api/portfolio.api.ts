import { apiClient } from "@/shared/lib/http/http-client";
import { ApiError } from "@/shared/lib/http/http-client";

import {
  PortfolioAgingAlertDto,
  PortfolioAgingLatestDto,
  PortfolioCustomerDto,
  PortfolioGroupCardDto,
  PortfolioMovementsLatestDto,
  PortfolioOpenInvoiceDto,
  PortfolioRiskSummaryDto,
  PortfolioSnapshotDto,
  PortfolioComparisonDto
} from "@/features/portfolio/api/contracts";

type PortfolioQueryParams = {
  cnpj?: string;
  bu?: string;
  snapshot_id?: string;
};

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function isNoAgingImportError(error: unknown) {
  if (!(error instanceof ApiError) || error.status !== 404) {
    return false;
  }

  const normalizedMessage = normalizeText(error.message ?? "");
  return normalizedMessage.includes("nao existe importacao aging ar valida");
}

function buildQuery(params?: PortfolioQueryParams) {
  const query = new URLSearchParams();

  if (params?.cnpj) {
    query.set("cnpj", params.cnpj);
  }

  if (params?.bu) {
    query.set("bu", params.bu);
  }
  if (params?.snapshot_id) {
    query.set("snapshot_id", params.snapshot_id);
  }

  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}

export async function getPortfolioAgingLatest(params?: Pick<PortfolioQueryParams, "bu">) {
  let payload: unknown;
  try {
    payload = await apiClient.get<unknown>(`/api/portfolio/aging/latest${buildQuery(params)}`);
  } catch (error) {
    if (isNoAgingImportError(error)) {
      return null;
    }
    throw error;
  }

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
  let payload: unknown;
  try {
    payload = await apiClient.get<unknown>(`/api/portfolio/customers${buildQuery(params)}`);
  } catch (error) {
    if (isNoAgingImportError(error)) {
      return [] as PortfolioCustomerDto[];
    }
    throw error;
  }

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
  let payload: unknown;
  try {
    payload = await apiClient.get<unknown>("/api/portfolio/aging/alerts/latest");
  } catch (error) {
    if (isNoAgingImportError(error)) {
      return [] as PortfolioAgingAlertDto[];
    }
    throw error;
  }
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

export async function getPortfolioAgingAlertsLatestBySnapshot(snapshotId?: string) {
  const suffix = snapshotId ? `?snapshot_id=${encodeURIComponent(snapshotId)}` : "";
  let payload: unknown;
  try {
    payload = await apiClient.get<unknown>(`/api/portfolio/aging/alerts/latest${suffix}`);
  } catch (error) {
    if (isNoAgingImportError(error)) {
      return [] as PortfolioAgingAlertDto[];
    }
    throw error;
  }
  if (!payload || typeof payload !== "object") {
    return [] as PortfolioAgingAlertDto[];
  }
  const asRecord = payload as Record<string, unknown>;
  return Array.isArray(asRecord.alerts) ? (asRecord.alerts as PortfolioAgingAlertDto[]) : [];
}

export async function getPortfolioAgingMovementsLatest(snapshotId?: string) {
  const suffix = snapshotId ? `?snapshot_id=${encodeURIComponent(snapshotId)}` : "";
  let payload: unknown;
  try {
    payload = await apiClient.get<unknown>(`/api/portfolio/aging/movements/latest${suffix}`);
  } catch (error) {
    if (isNoAgingImportError(error)) {
      return {
        base_date: "",
        previous_base_date: null,
        message: "Ainda não há base importada de Aging AR.",
        movements: []
      } as PortfolioMovementsLatestDto;
    }
    throw error;
  }
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
  let payload: unknown;
  try {
    payload = await apiClient.get<unknown>("/api/portfolio/risk-summary");
  } catch (error) {
    if (isNoAgingImportError(error)) {
      return null;
    }
    throw error;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const asRecord = payload as Record<string, unknown>;
  if (!asRecord.distribution || typeof asRecord.distribution !== "object" || Array.isArray(asRecord.distribution)) {
    return null;
  }

  return asRecord as unknown as PortfolioRiskSummaryDto;
}

export async function getPortfolioRiskSummaryBySnapshot(snapshotId?: string) {
  const suffix = snapshotId ? `?snapshot_id=${encodeURIComponent(snapshotId)}` : "";
  let payload: unknown;
  try {
    payload = await apiClient.get<unknown>(`/api/portfolio/risk-summary${suffix}`);
  } catch (error) {
    if (isNoAgingImportError(error)) {
      return null;
    }
    throw error;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const asRecord = payload as Record<string, unknown>;
  if (!asRecord.distribution || typeof asRecord.distribution !== "object" || Array.isArray(asRecord.distribution)) {
    return null;
  }
  return asRecord as unknown as PortfolioRiskSummaryDto;
}

export async function getPortfolioGroupOpenInvoices(economicGroup: string, snapshotId?: string) {
  const encodedGroup = encodeURIComponent(economicGroup);
  const suffix = snapshotId ? `?snapshot_id=${encodeURIComponent(snapshotId)}` : "";
  const payload = await apiClient.get<unknown>(`/api/portfolio/groups/${encodedGroup}/open-invoices${suffix}`);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [] as PortfolioOpenInvoiceDto[];
  }
  const asRecord = payload as Record<string, unknown>;
  return Array.isArray(asRecord.items) ? (asRecord.items as PortfolioOpenInvoiceDto[]) : [];
}

export async function getPortfolioCustomerOpenInvoices(cnpj: string, snapshotId?: string) {
  const encodedCnpj = encodeURIComponent(cnpj);
  const suffix = snapshotId ? `?snapshot_id=${encodeURIComponent(snapshotId)}` : "";
  const payload = await apiClient.get<unknown>(`/api/portfolio/customers/${encodedCnpj}/open-invoices${suffix}`);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [] as PortfolioOpenInvoiceDto[];
  }
  const asRecord = payload as Record<string, unknown>;
  return Array.isArray(asRecord.items) ? (asRecord.items as PortfolioOpenInvoiceDto[]) : [];
}

export async function getPortfolioGroups(params?: { bu?: string; q?: string; snapshot_id?: string }) {
  const query = new URLSearchParams();
  if (params?.bu) query.set("bu", params.bu);
  if (params?.q) query.set("q", params.q);
  if (params?.snapshot_id) query.set("snapshot_id", params.snapshot_id);
  const suffix = query.toString();
  let payload: unknown;
  try {
    payload = await apiClient.get<unknown>(`/api/portfolio/groups${suffix ? `?${suffix}` : ""}`);
  } catch (error) {
    if (isNoAgingImportError(error)) {
      return [] as PortfolioGroupCardDto[];
    }
    throw error;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [] as PortfolioGroupCardDto[];
  }
  const asRecord = payload as Record<string, unknown>;
  return Array.isArray(asRecord.items) ? (asRecord.items as PortfolioGroupCardDto[]) : [];
}

export async function getPortfolioSnapshots() {
  let payload: unknown;
  try {
    payload = await apiClient.get<unknown>("/api/portfolio/snapshots");
  } catch (error) {
    if (isNoAgingImportError(error)) {
      return [] as PortfolioSnapshotDto[];
    }
    throw error;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [] as PortfolioSnapshotDto[];
  }
  const asRecord = payload as Record<string, unknown>;
  return Array.isArray(asRecord.items) ? (asRecord.items as PortfolioSnapshotDto[]) : [];
}

export async function getPortfolioComparison(fromSnapshotId: string, toSnapshotId: string) {
  const query = new URLSearchParams();
  query.set("from_snapshot_id", fromSnapshotId);
  query.set("to_snapshot_id", toSnapshotId);
  const payload = await apiClient.get<PortfolioComparisonDto>(`/api/portfolio/comparison?${query.toString()}`);
  const asNumber = (value: number | string | null | undefined) => {
    if (typeof value === "number") return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  };

  if (!payload.waterfall) {
    return payload;
  }

  return {
    ...payload,
    waterfall: {
      starting_amount: asNumber(payload.waterfall.starting_amount),
      new_groups_amount: asNumber(payload.waterfall.new_groups_amount),
      existing_growth_amount: asNumber(payload.waterfall.existing_growth_amount),
      existing_reduction_amount: asNumber(payload.waterfall.existing_reduction_amount),
      removed_groups_amount: asNumber(payload.waterfall.removed_groups_amount),
      ending_amount: asNumber(payload.waterfall.ending_amount)
    }
  };
}
