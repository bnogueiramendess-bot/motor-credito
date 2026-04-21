"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { useCreditAnalysesQuery } from "@/features/credit-analyses/hooks/use-credit-analyses-query";
import { formatCurrency } from "@/features/credit-analyses/utils/formatters";
import { EmptyState } from "@/shared/components/states/empty-state";
import { ErrorState } from "@/shared/components/states/error-state";

function textIncludes(base: string | number | null | undefined, search: string) {
  if (base === null || base === undefined) {
    return false;
  }
  return String(base).toLowerCase().includes(search);
}

export function DashboardPageView() {
  const analysesQuery = useCreditAnalysesQuery();
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLowerCase();
  const analyses = useMemo(() => analysesQuery.data ?? [], [analysesQuery.data]);

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

  if (analysesQuery.isLoading) {
    return (
      <div className="space-y-3">
        <div className="h-24 animate-pulse rounded-[10px] bg-white" />
        <div className="h-64 animate-pulse rounded-[10px] bg-white" />
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

  const filtered = normalizedSearch
    ? analyses.filter((analysis) => {
        return (
          textIncludes(analysis.customer?.company_name, normalizedSearch) ||
          textIncludes(analysis.customer?.document_number, normalizedSearch) ||
          textIncludes(analysis.protocol_number, normalizedSearch) ||
          textIncludes(analysis.id, normalizedSearch)
        );
      })
    : analyses;

  return (
    <section className="space-y-4">
      <div className="rounded-[10px] border border-[#e2e5eb] bg-white p-4">
        <p className="text-[18px] font-medium text-[#111827]">Dashboard operacional</p>
        <p className="mt-1 text-[12px] text-[#6b7280]">
          Baseado apenas nos dados reais disponíveis hoje no backend de análises, clientes e resultados já calculados.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href="/analises/nova"
            className="inline-flex h-9 items-center rounded-[6px] bg-[#1a2b5e] px-3 text-[12px] font-medium text-white hover:bg-[#233a7d]"
          >
            Nova análise de crédito
          </Link>
          <Link
            href="/analises"
            className="inline-flex h-9 items-center rounded-[6px] border border-[#d1d5db] bg-white px-3 text-[12px] font-medium text-[#374151] hover:bg-[#f9fafb]"
          >
            Continuar ou localizar análise
          </Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <article className="rounded-[10px] border border-[#e2e5eb] bg-white p-3">
          <p className="text-[11px] text-[#6b7280]">Análises totais</p>
          <p className="mt-1 text-[20px] font-medium text-[#111827]">{kpis.total}</p>
        </article>
        <article className="rounded-[10px] border border-[#e2e5eb] bg-white p-3">
          <p className="text-[11px] text-[#6b7280]">Em criação</p>
          <p className="mt-1 text-[20px] font-medium text-[#1a2b5e]">{kpis.created}</p>
        </article>
        <article className="rounded-[10px] border border-[#e2e5eb] bg-white p-3">
          <p className="text-[11px] text-[#6b7280]">Em andamento</p>
          <p className="mt-1 text-[20px] font-medium text-[#d97706]">{kpis.inProgress}</p>
        </article>
        <article className="rounded-[10px] border border-[#e2e5eb] bg-white p-3">
          <p className="text-[11px] text-[#6b7280]">Concluídas</p>
          <p className="mt-1 text-[20px] font-medium text-[#059669]">{kpis.completed}</p>
        </article>
        <article className="rounded-[10px] border border-[#e2e5eb] bg-white p-3">
          <p className="text-[11px] text-[#6b7280]">Limite sugerido médio</p>
          <p className="mt-1 text-[20px] font-medium text-[#111827]">{formatCurrency(kpis.avgSuggestedLimit)}</p>
        </article>
      </div>

      <div className="rounded-[10px] border border-[#e2e5eb] bg-white p-4">
        <label className="mb-2 block text-[11px] font-medium uppercase tracking-[0.04em] text-[#6b7280]">
          Busca por razão social, CNPJ, protocolo ou ID da análise
        </label>
        <div className="flex items-center gap-2 rounded-[8px] border border-[#d1d5db] bg-white px-3">
          <Search className="h-4 w-4 text-[#9ca3af]" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Ex.: 12.345.678/0001-99, ACME, 42, PROTOCOLO"
            className="h-9 w-full border-none bg-transparent text-[12px] text-[#374151] outline-none placeholder:text-[#9ca3af]"
          />
        </div>
      </div>

      {!filtered.length ? (
        <EmptyState title="Nenhum resultado encontrado" description="Ajuste o termo da busca para localizar análises existentes." />
      ) : (
        <div className="overflow-hidden rounded-[10px] border border-[#e2e5eb] bg-white">
          <div className="grid grid-cols-[90px_1fr_160px_140px_140px] bg-[#f9fafb] px-4 py-2 text-[10px] font-medium uppercase tracking-[0.04em] text-[#6b7280]">
            <span>ID</span>
            <span>Cliente</span>
            <span>CNPJ</span>
            <span>Status</span>
            <span className="text-right">Ações</span>
          </div>
          {filtered.slice(0, 20).map((analysis) => (
            <div
              key={analysis.id}
              className="grid grid-cols-[90px_1fr_160px_140px_140px] items-center border-t border-[#f3f4f6] px-4 py-2 text-[12px]"
            >
              <span className="font-medium text-[#374151]">#{analysis.id}</span>
              <span className="truncate text-[#111827]">{analysis.customer?.company_name ?? `Cliente #${analysis.customer_id}`}</span>
              <span className="text-[#6b7280]">{analysis.customer?.document_number ?? "Não informado"}</span>
              <span className="text-[#6b7280]">{analysis.analysis_status}</span>
              <div className="text-right">
                <Link href={`/analises/${analysis.id}`} className="text-[#1a2b5e] hover:underline">
                  Abrir análise
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
