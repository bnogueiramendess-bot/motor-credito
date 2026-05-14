"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { toNumber } from "@/features/credit-analyses/utils/formatters";
import { DashboardAnalysisGrid } from "@/features/dashboard/components/dashboard-analysis-grid";
import { DashboardAnalysisCardViewModel } from "@/features/dashboard/utils/dashboard-analysis-view-models";
import { formatCurrencyInThousands } from "@/features/dashboard/utils/dashboard-formatters";
import { PortfolioCustomerDto } from "@/features/portfolio/api/contracts";
import { usePortfolioAgingLatestQuery } from "@/features/portfolio/hooks/use-portfolio-aging-latest-query";
import { usePortfolioCustomersQuery } from "@/features/portfolio/hooks/use-portfolio-customers-query";
import { ErrorState } from "@/shared/components/states/error-state";
import { PermissionDeniedState } from "@/shared/components/states/permission-denied-state";
import { getEffectivePermissions, hasPermission } from "@/shared/lib/auth/permissions";

type StatusFilter = "all" | "created" | "in_progress" | "completed";

type OperationSummary = {
  approved: number;
  rejected: number;
  manualReview: number;
  pendingDecision: number;
  avgLimit: number | null;
  latestProtocol: string;
};

function textIncludes(base: string | number | null | undefined, search: string) {
  if (base === null || base === undefined) {
    return false;
  }

  return String(base).toLowerCase().includes(search);
}

function normalizeDigits(value: string) {
  return value.replace(/\D/g, "");
}

function formatKpiCurrencyInThousands(value: number | string | null | undefined) {
  return formatCurrencyInThousands(value);
}


function mapPortfolioCustomerToCard(item: PortfolioCustomerDto, index: number): DashboardAnalysisCardViewModel {
  const scoreBandRaw = typeof item.score === "object" && item.score !== null ? (item.score as { score_band?: unknown }).score_band : null;
  const scoreBand = scoreBandRaw === "A" || scoreBandRaw === "B" || scoreBandRaw === "C" || scoreBandRaw === "D" ? scoreBandRaw : null;

  const scoreValue = typeof item.score === "object" && item.score !== null ? (item.score as { final_score?: unknown }).final_score : null;
  const finalScore = toNumber(scoreValue as string | number | null | undefined);
  const scoreLabel = scoreBand ?? (finalScore !== null ? String(finalScore) : "Pendente");

  const decisionValue = (typeof item.decision === "string" ? item.decision : null) ?? null;
  const statusLabel = decisionValue === "approved" ? "Aprovado" : decisionValue === "rejected" ? "Recusado" : "N/D";
  const statusTone = decisionValue === "approved" ? "success" : decisionValue === "rejected" ? "danger" : "warning";
  const statusGroup = decisionValue === "approved" ? "approved" : decisionValue === "rejected" ? "rejected" : "pending";

  const scoreTone =
    scoreBand === "A" ? "positive" : scoreBand === "B" ? "good" : scoreBand === "C" ? "warning" : scoreBand === "D" ? "danger" : "neutral";

  const limitBase = item.final_limit ?? item.suggested_limit ?? item.requested_limit;

  return {
    id: Number(item.id ?? item.customer_id ?? index + 1),
    companyName: item.company_name ?? item.legal_name ?? item.trade_name ?? `Cliente #${item.customer_id ?? index + 1}`,
    documentNumber: item.document_number ?? item.cnpj ?? "CNPJ não informado",
    statusLabel,
    statusTone,
    statusGroup,
    scoreLabel,
    scoreTone,
    scoreBand,
    limitLabel: formatCurrencyInThousands(limitBase)
  };
}

const statusFilters: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Todas" },
  { value: "created", label: "Criação" },
  { value: "in_progress", label: "Em andamento" },
  { value: "completed", label: "Concluídas" }
];

export function DashboardPageViewLegacy() {
  const permissions = getEffectivePermissions();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const normalizedSearch = search.trim().toLowerCase();
  const digits = normalizeDigits(search);
  const cnpjSearch = digits.length >= 8 ? digits : undefined;

  const agingQuery = usePortfolioAgingLatestQuery();
  const customersQuery = usePortfolioCustomersQuery({ cnpj: cnpjSearch });

  const customers = useMemo(() => (Array.isArray(customersQuery.data) ? customersQuery.data : []), [customersQuery.data]);

  const kpis = useMemo(() => {
    const avgSuggestedLimitList = customers
      .map((item) => toNumber(item.suggested_limit ?? item.final_limit ?? item.requested_limit))
      .filter((item): item is number => item !== null && Number.isFinite(item) && item > 0);

    const avgSuggestedLimit =
      avgSuggestedLimitList.length > 0
        ? avgSuggestedLimitList.reduce((acc, value) => acc + value, 0) / avgSuggestedLimitList.length
        : null;

    const aging = agingQuery.data;

    return {
      totalOpenAmount: toNumber(aging?.total_open_amount),
      totalOverdueAmount: toNumber(aging?.total_overdue_amount),
      totalNotDueAmount: toNumber(aging?.total_not_due_amount),
      insuredLimitAmount: toNumber(aging?.insured_limit_amount ?? aging?.total_insured_limit_amount),
      customersCount: customers.length,
      avgSuggestedLimit
    };
  }, [agingQuery.data, customers]);

  const operationSummary = useMemo<OperationSummary>(() => {
    let approved = 0;
    let rejected = 0;
    let manualReview = 0;
    let pendingDecision = 0;
    let totalLimit = 0;
    let limitCount = 0;

    for (const item of customers) {
      const decision = typeof item.decision === "string" ? item.decision : null;

      if (decision === "approved") {
        approved += 1;
      } else if (decision === "rejected") {
        rejected += 1;
      } else if (decision === "manual_review") {
        manualReview += 1;
      } else {
        pendingDecision += 1;
      }

      const effectiveLimit = toNumber(item.final_limit ?? item.suggested_limit ?? item.requested_limit);
      if (effectiveLimit !== null && effectiveLimit > 0) {
        totalLimit += effectiveLimit;
        limitCount += 1;
      }
    }

    return {
      approved,
      rejected,
      manualReview,
      pendingDecision,
      avgLimit: limitCount ? totalLimit / limitCount : null,
      latestProtocol: "-"
    };
  }, [customers]);

  if (!hasPermission("credit.dashboard.view", permissions)) {
    return <PermissionDeniedState />;
  }

  if (agingQuery.isLoading || customersQuery.isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-28 animate-pulse rounded-2xl bg-white" />
        <div className="h-28 animate-pulse rounded-2xl bg-white" />
        <div className="h-80 animate-pulse rounded-2xl bg-white" />
      </div>
    );
  }

  if (agingQuery.isError || customersQuery.isError) {
    const errorMessage = agingQuery.isError
      ? agingQuery.error.message
      : customersQuery.error?.message ?? "Falha ao carregar dados da carteira.";

    return (
      <ErrorState
        title="Não foi possível carregar o dashboard"
        description={errorMessage}
        onRetry={() => {
          void agingQuery.refetch();
          void customersQuery.refetch();
        }}
      />
    );
  }

  const mappedCards = customers.map(mapPortfolioCustomerToCard);

  const filtered = mappedCards.filter((analysis) => {
    if (statusFilter !== "all") {
      return true;
    }

    if (!normalizedSearch) {
      return true;
    }

    return textIncludes(analysis.companyName, normalizedSearch) || textIncludes(analysis.documentNumber, normalizedSearch) || textIncludes(analysis.id, normalizedSearch);
  });

  const highlightedAnalyses = filtered.slice(0, 12);
  const hasNoImport =
    customers.length === 0 &&
    kpis.totalOpenAmount === null &&
    kpis.totalOverdueAmount === null &&
    kpis.totalNotDueAmount === null &&
    kpis.insuredLimitAmount === null;

  return (
    <section className="space-y-6">
      {hasNoImport ? (
        <div className="rounded-2xl border border-[#f5d0d0] bg-[#fff7f7] px-4 py-3 text-sm text-[#991b1b]">
          Nenhuma importação de carteira encontrada. Importe dados para visualizar o Aging AR.
        </div>
      ) : null}

      <div className="space-y-3">
        <div>
          <h2 className="text-xl font-semibold tracking-[-0.01em] text-[#111827]">Visão geral da carteira</h2>
          <p className="mt-1 text-sm text-[#6b7280]">Acompanhe o volume, o andamento e os resultados das análises de crédito.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <article className="flex min-h-[132px] flex-col justify-between rounded-2xl border border-[#e5e9f2] bg-white px-5 py-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-[#6b7280]">Total em aberto</p>
            <p className="whitespace-nowrap text-[34px] font-bold leading-none tracking-[-0.02em] text-[#111827]">{formatKpiCurrencyInThousands(kpis.totalOpenAmount)}</p>
          </article>

          <article className="flex min-h-[132px] flex-col justify-between rounded-2xl border border-blue-200 bg-blue-50/40 px-5 py-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-blue-700">Overdue</p>
            <p className="whitespace-nowrap text-[34px] font-bold leading-none tracking-[-0.02em] text-blue-900">{formatKpiCurrencyInThousands(kpis.totalOverdueAmount)}</p>
          </article>

          <article className="flex min-h-[132px] flex-col justify-between rounded-2xl border border-amber-200 bg-amber-50/45 px-5 py-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-amber-700">Not Due</p>
            <p className="whitespace-nowrap text-[34px] font-bold leading-none tracking-[-0.02em] text-amber-900">{formatKpiCurrencyInThousands(kpis.totalNotDueAmount)}</p>
          </article>

          <article className="flex min-h-[132px] flex-col justify-between rounded-2xl border border-emerald-200 bg-emerald-50/45 px-5 py-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-emerald-700">Limite segurado</p>
            <p className="whitespace-nowrap text-[34px] font-bold leading-none tracking-[-0.02em] text-emerald-900">{formatKpiCurrencyInThousands(kpis.insuredLimitAmount)}</p>
          </article>

          <article className="flex min-h-[132px] flex-col justify-between rounded-2xl border border-[#dde5f3] bg-[#f8fafe] px-5 py-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-[#64748b]">Clientes na carteira</p>
            <p className="whitespace-nowrap text-[32px] font-bold leading-none tracking-[-0.02em] text-[#0f172a]">{kpis.customersCount}</p>
          </article>
        </div>
      </div>

      <div className="rounded-2xl border border-[#e5e9f2] bg-white p-5 shadow-sm">
        <label htmlFor="dashboard-search" className="mb-2 block text-sm font-medium text-[#374151]">
          Buscar por razão social, CNPJ, protocolo ou ID da análise
        </label>
        <div className="flex items-center gap-3 rounded-xl border border-[#d7dde8] bg-[#fbfcfe] px-4">
          <Search className="h-4 w-4 text-[#94a3b8]" />
          <input
            id="dashboard-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Ex.: 12.345.678/0001-99, ACME, 42 ou protocolo"
            className="h-11 w-full border-none bg-transparent text-sm text-[#111827] outline-none placeholder:text-[#94a3b8]"
          />
        </div>

        <div className="mt-4 border-t border-[#eef2f7] pt-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.05em] text-[#6b7280]">Filtrar por status</p>
          <div className="flex flex-wrap gap-2">
            {statusFilters.map((filter) => {
              const active = statusFilter === filter.value;
              return (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => setStatusFilter(filter.value)}
                  className={
                    active
                      ? "rounded-full border border-[#1a2b5e] bg-[#1a2b5e] px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm"
                      : "rounded-full border border-[#d4dbe7] bg-white px-3.5 py-1.5 text-xs font-semibold text-[#4b5563] transition hover:border-[#c4cedd] hover:bg-[#f7f9fd]"
                  }
                >
                  {filter.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-12">
        <div className="xl:col-span-9">
          <DashboardAnalysisGrid analyses={highlightedAnalyses} filteredCount={filtered.length} />
        </div>

        <aside className="space-y-4 xl:col-span-3">
          <section className="rounded-2xl border border-[#e5e9f2] bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-[#111827]">Resumo da operação</p>
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
              <p className="text-xs font-medium uppercase tracking-[0.05em] text-amber-700">Pendentes para decisão</p>
              <p className="mt-1 text-3xl font-bold leading-none text-amber-900">{operationSummary.pendingDecision}</p>
            </div>
            <div className="mt-4 space-y-3 text-sm text-[#4b5563]">
              <p className="flex items-center justify-between">
                <span>Aprovadas</span>
                <strong className="text-lg font-semibold text-emerald-700">{operationSummary.approved}</strong>
              </p>
              <p className="flex items-center justify-between">
                <span>Recusadas</span>
                <strong className="text-lg font-semibold text-rose-700">{operationSummary.rejected}</strong>
              </p>
              <p className="flex items-center justify-between">
                <span>Revisão manual</span>
                <strong className="text-lg font-semibold text-amber-700">{operationSummary.manualReview}</strong>
              </p>
            </div>
          </section>

          <section className="rounded-2xl border border-[#e5e9f2] bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-[#111827]">Atalhos operacionais</p>
            <div className="mt-3 grid gap-2">
              <Link
                href="/analises"
                className="rounded-xl border border-[#d6dbe6] bg-[#f9fbff] px-3 py-2 text-sm font-medium text-[#1a2b5e] transition hover:bg-[#f1f5ff]"
              >
                Abrir fila de análises
              </Link>
              <Link
                href="/analises/nova"
                className="rounded-xl border border-[#d6dbe6] bg-[#f9fbff] px-3 py-2 text-sm font-medium text-[#1a2b5e] transition hover:bg-[#f1f5ff]"
              >
                Iniciar nova solicitação
              </Link>
            </div>
          </section>

          <section className="rounded-2xl border border-[#e5e9f2] bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-[#111827]">Legenda de status</p>
            <div className="mt-3 space-y-2 text-sm text-[#4b5563]">
              <p className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                <span>Aprovado</span>
              </p>
              <p className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
                <span>Recusado</span>
              </p>
              <p className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                <span>Pendente ou revisão manual</span>
              </p>
            </div>
          </section>
        </aside>
      </div>
    </section>
  );
}
