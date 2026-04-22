"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { useCreditAnalysesQuery } from "@/features/credit-analyses/hooks/use-credit-analyses-query";
import { resolveDecision } from "@/features/credit-analyses/utils/analysis-view-models";
import { toNumber } from "@/features/credit-analyses/utils/formatters";
import { DashboardAnalysisGrid } from "@/features/dashboard/components/dashboard-analysis-grid";
import { prioritizeDashboardAnalyses, toDashboardAnalysisCard } from "@/features/dashboard/utils/dashboard-analysis-view-models";
import { formatCurrencyInThousands } from "@/features/dashboard/utils/dashboard-formatters";
import { ErrorState } from "@/shared/components/states/error-state";

type StatusFilter = "all" | "created" | "in_progress" | "completed";

function textIncludes(base: string | number | null | undefined, search: string) {
  if (base === null || base === undefined) {
    return false;
  }

  return String(base).toLowerCase().includes(search);
}

const statusFilters: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Todas" },
  { value: "created", label: "Criação" },
  { value: "in_progress", label: "Em andamento" },
  { value: "completed", label: "Concluídas" }
];

export function DashboardPageView() {
  const analysesQuery = useCreditAnalysesQuery();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const normalizedSearch = search.trim().toLowerCase();

  const analyses = useMemo(() => {
    return prioritizeDashboardAnalyses(analysesQuery.data ?? []);
  }, [analysesQuery.data]);

  const kpis = useMemo(() => {
    const total = analyses.length;
    const completed = analyses.filter((item) => item.analysis_status === "completed").length;
    const inProgress = analyses.filter((item) => item.analysis_status === "in_progress").length;
    const created = analyses.filter((item) => item.analysis_status === "created").length;
    const avgSuggestedLimitList = analyses
      .map((item) => Number(item.suggested_limit ?? 0))
      .filter((item) => Number.isFinite(item) && item > 0);

    const avgSuggestedLimit =
      avgSuggestedLimitList.length > 0
        ? avgSuggestedLimitList.reduce((acc, value) => acc + value, 0) / avgSuggestedLimitList.length
        : null;

    return {
      total,
      completed,
      inProgress,
      created,
      avgSuggestedLimit
    };
  }, [analyses]);

  const operationSummary = useMemo(() => {
    const stats = analyses.reduce(
      (acc, item) => {
        const decision = resolveDecision(item.final_decision, item.motor_result);
        if (decision === "approved") {
          acc.approved += 1;
        } else if (decision === "rejected") {
          acc.rejected += 1;
        } else if (decision === "manual_review") {
          acc.manualReview += 1;
        } else {
          acc.pendingDecision += 1;
        }

        const effectiveLimit = toNumber(item.final_limit ?? item.suggested_limit ?? item.requested_limit);
        if (effectiveLimit !== null && effectiveLimit > 0) {
          acc.totalLimit += effectiveLimit;
          acc.limitCount += 1;
        }

        return acc;
      },
      {
        approved: 0,
        rejected: 0,
        manualReview: 0,
        pendingDecision: 0,
        totalLimit: 0,
        limitCount: 0
      }
    );

    return {
      ...stats,
      avgLimit: stats.limitCount ? stats.totalLimit / stats.limitCount : null,
      latestProtocol: analyses[0]?.protocol_number ?? "-"
    };
  }, [analyses]);

  if (analysesQuery.isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-28 animate-pulse rounded-2xl bg-white" />
        <div className="h-28 animate-pulse rounded-2xl bg-white" />
        <div className="h-80 animate-pulse rounded-2xl bg-white" />
      </div>
    );
  }

  if (analysesQuery.isError) {
    return (
      <ErrorState
        title="Não foi possível carregar o dashboard"
        description={analysesQuery.error.message}
        onRetry={() => analysesQuery.refetch()}
      />
    );
  }

  const filtered = analyses.filter((analysis) => {
    if (statusFilter !== "all" && analysis.analysis_status !== statusFilter) {
      return false;
    }

    if (!normalizedSearch) {
      return true;
    }

    return (
      textIncludes(analysis.customer?.company_name, normalizedSearch) ||
      textIncludes(analysis.customer?.document_number, normalizedSearch) ||
      textIncludes(analysis.protocol_number, normalizedSearch) ||
      textIncludes(analysis.id, normalizedSearch)
    );
  });

  const highlightedAnalyses = filtered.slice(0, 12).map(toDashboardAnalysisCard);

  return (
    <section className="space-y-6">
      <div className="space-y-3">
        <div>
          <h2 className="text-xl font-semibold tracking-[-0.01em] text-[#111827]">Visão geral das análises</h2>
          <p className="mt-1 text-sm text-[#6b7280]">Acompanhe o volume, o andamento e os resultados das análises de crédito.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <article className="flex min-h-[132px] flex-col justify-between rounded-2xl border border-[#e5e9f2] bg-white px-5 py-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
          <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-[#6b7280]">Análises totais</p>
          <p className="whitespace-nowrap text-[34px] font-bold leading-none tracking-[-0.02em] text-[#111827]">{kpis.total}</p>
        </article>

        <article className="flex min-h-[132px] flex-col justify-between rounded-2xl border border-blue-200 bg-blue-50/40 px-5 py-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
          <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-blue-700">Em criação</p>
          <p className="whitespace-nowrap text-[34px] font-bold leading-none tracking-[-0.02em] text-blue-900">{kpis.created}</p>
        </article>

        <article className="flex min-h-[132px] flex-col justify-between rounded-2xl border border-amber-200 bg-amber-50/45 px-5 py-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
          <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-amber-700">Em andamento</p>
          <p className="whitespace-nowrap text-[34px] font-bold leading-none tracking-[-0.02em] text-amber-900">{kpis.inProgress}</p>
        </article>

        <article className="flex min-h-[132px] flex-col justify-between rounded-2xl border border-emerald-200 bg-emerald-50/45 px-5 py-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
          <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-emerald-700">Concluídas</p>
          <p className="whitespace-nowrap text-[34px] font-bold leading-none tracking-[-0.02em] text-emerald-900">{kpis.completed}</p>
        </article>

        <article className="flex min-h-[132px] flex-col justify-between rounded-2xl border border-[#dde5f3] bg-[#f8fafe] px-5 py-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
          <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-[#64748b]">Limite sugerido médio</p>
          <p className="whitespace-nowrap text-[32px] font-bold leading-none tracking-[-0.02em] text-[#0f172a]">
            {formatCurrencyInThousands(kpis.avgSuggestedLimit)}
          </p>
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
