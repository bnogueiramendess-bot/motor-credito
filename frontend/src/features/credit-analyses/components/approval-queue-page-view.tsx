"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, ChevronDown, ChevronsLeft, ChevronsRight, Filter, Search, ShieldAlert, UserRoundCheck } from "lucide-react";

import { useCreditAnalysesApprovalQueueQuery } from "@/features/credit-analyses/hooks/use-credit-analyses-approval-queue-query";
import { BusinessUnitContextSelector } from "@/features/business-units/components/business-unit-context-selector";
import { useBusinessUnitContextQuery } from "@/features/business-units/hooks/use-business-unit-context-query";
import { OperationalContextBar } from "@/shared/components/layout/operational-context-bar";
import { EmptyState } from "@/shared/components/states/empty-state";
import { ErrorState } from "@/shared/components/states/error-state";

function formatCurrencyNoCents(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "-";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "-";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(parsed);
}

function mapActionLabel(actions: string[]): string {
  if (actions.includes("approve")) return "Aprovar";
  if (actions.includes("reject")) return "Rejeitar";
  if (actions.includes("request_changes")) return "Devolver para ajustes";
  if (actions.includes("view_dossier")) return "Ver dossiê";
  return "Acompanhar";
}

export function ApprovalQueuePageView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const businessUnitContext = searchParams.get("business_unit_context") ?? "";
  const buContextQuery = useBusinessUnitContextQuery();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [filters, setFilters] = useState({ q: "", status_filter: "", bu: "", aging: "", assigned_analyst: "" });

  const params = useMemo(
    () => ({ ...filters, page, page_size: pageSize, business_unit_context: businessUnitContext || undefined }),
    [filters, page, pageSize, businessUnitContext]
  );
  const queueQuery = useCreditAnalysesApprovalQueueQuery(params);
  if (queueQuery.isLoading) return <div className="rounded-[12px] border border-[#D7E1EC] bg-white p-6 text-[13px] text-[#4F647A]">Carregando fila de aprovação...</div>;
  if (queueQuery.isError) return <ErrorState title="Não foi possível carregar a fila de aprovação" description={queueQuery.error.message} onRetry={() => queueQuery.refetch()} />;

  const payload = queueQuery.data;
  const items = payload?.items ?? [];
  if (!items.length) {
    return <EmptyState title="Nenhuma análise em aprovação para sua alçada." description="Quando houver solicitações no seu escopo de aprovação, elas aparecerão aqui." />;
  }
  const total = payload?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);

  return (
    <section className="readability-standard rounded-[12px] border border-[#E2E8F0] bg-[#F8FAFC] p-4">
      <div className="mb-3">
        <p className="text-[30px] font-semibold tracking-[-0.02em] text-[#0F172A]">Fila de Aprovação</p>
        <p className="text-[14px] text-[#64748B]">Priorize decisões pendentes com visão de alçada, BU e SLA em tempo real.</p>
      </div>
      {buContextQuery.data ? (
        <OperationalContextBar className="mb-3">
          <BusinessUnitContextSelector
            value={businessUnitContext || (buContextQuery.data.default_context.consolidated ? "consolidated" : String(buContextQuery.data.default_context.business_unit_code ?? ""))}
            onChange={(value) => {
              const next = new URLSearchParams(searchParams.toString());
              next.set("business_unit_context", value);
              router.replace(`?${next.toString()}`);
              setPage(1);
            }}
            label="Visão"
            consolidatedLabel={buContextQuery.data.consolidated_label}
            canViewConsolidated={buContextQuery.data.can_view_consolidated}
            options={buContextQuery.data.allowed_business_units.map((item) => ({ code: item.code, name: item.name }))}
            compact
          />
        </OperationalContextBar>
      ) : null}

      <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-[12px] border border-[#E2E8F0] bg-white px-3 py-2.5"><p className="text-[11px] text-[#64748B]">Total em aprovação</p><p className="text-[24px] font-semibold text-[#0F172A]">{payload?.kpis.total ?? 0}</p></article>
        <article className="rounded-[12px] border border-[#E2E8F0] bg-white px-3 py-2.5"><p className="text-[11px] text-[#64748B]">SLA &gt; 5 dias</p><p className="text-[24px] font-semibold text-[#B91C1C]">{payload?.kpis.overdue_sla ?? 0}</p></article>
        <article className="rounded-[12px] border border-[#E2E8F0] bg-white px-3 py-2.5"><p className="text-[11px] text-[#64748B]">Alto valor ({">="} R$ 1MM)</p><p className="text-[24px] font-semibold text-[#7C3AED]">{payload?.kpis.high_value ?? 0}</p></article>
        <article className="rounded-[12px] border border-[#E2E8F0] bg-white px-3 py-2.5"><p className="text-[11px] text-[#64748B]">Aguardando decisão</p><p className="text-[24px] font-semibold text-[#1D4ED8]">{payload?.kpis.awaiting_approval ?? 0}</p></article>
      </div>

      <div className="mb-3 rounded-[12px] border border-[#E2E8F0] bg-white p-2.5">
        <div className="grid gap-2 xl:grid-cols-[2fr_1.1fr_1.1fr_1.1fr_1.2fr_auto]">
          <label className="flex h-10 items-center rounded-[10px] border border-[#E2E8F0] px-3 text-[12px] text-[#64748B]"><Search className="mr-2 h-4 w-4 text-[#94A3B8]" /><input value={filters.q} onChange={(e) => { setPage(1); setFilters((p) => ({ ...p, q: e.target.value })); }} placeholder="Buscar por cliente, CNPJ ou protocolo" className="w-full bg-transparent outline-none" /></label>
          <select value={filters.status_filter} onChange={(e) => { setPage(1); setFilters((p) => ({ ...p, status_filter: e.target.value })); }} className="h-10 rounded-[10px] border border-[#E2E8F0] px-3 text-[12px]"><option value="">Status</option><option value="in_approval">Em aprovação</option></select>
          <select value={filters.bu} onChange={(e) => { setPage(1); setFilters((p) => ({ ...p, bu: e.target.value })); }} className="h-10 rounded-[10px] border border-[#E2E8F0] px-3 text-[12px]"><option value="">BU</option>{[...new Set(items.map((item) => item.business_unit).filter(Boolean))].map((option) => <option key={option as string} value={option as string}>{option}</option>)}</select>
          <select value={filters.aging} onChange={(e) => { setPage(1); setFilters((p) => ({ ...p, aging: e.target.value })); }} className="h-10 rounded-[10px] border border-[#E2E8F0] px-3 text-[12px]"><option value="">Aging</option><option value="over_5">Acima de 5 dias</option><option value="over_10">Acima de 10 dias</option></select>
          <label className="flex h-10 items-center rounded-[10px] border border-[#E2E8F0] px-3 text-[12px] text-[#64748B]"><UserRoundCheck className="mr-2 h-4 w-4 text-[#94A3B8]" /><input value={filters.assigned_analyst} onChange={(e) => { setPage(1); setFilters((p) => ({ ...p, assigned_analyst: e.target.value })); }} placeholder="Analista" className="w-full bg-transparent outline-none" /></label>
          <button type="button" className="flex h-10 items-center justify-center rounded-[10px] border border-[#E2E8F0] px-3 text-[12px] text-[#64748B]"><Filter className="mr-2 h-4 w-4" /> Filtros</button>
        </div>
      </div>

      <div className="overflow-hidden rounded-[12px] border border-[#E2E8F0] bg-white">
        <div className="overflow-x-auto">
          <div className="min-w-[1700px]">
            <div className="grid grid-cols-[minmax(280px,1.55fr)_120px_120px_145px_145px_125px_165px_110px_120px_145px_165px] gap-3 border-b border-[#EEF2F7] bg-[#F8FAFC] px-4 py-2 text-[11px] font-medium text-[#64748B]">
              <p>Cliente / Protocolo</p><p>Status</p><p>BU</p><p>Solicitado</p><p>Recomendado</p><p>Impacto</p><p>DOA/Faixa</p><p>Aging SLA</p><p>Analista</p><p>Próxima etapa</p><p className="text-right">Ação</p>
            </div>
            {items.map((item) => (
              <article key={item.analysis_id} className="grid grid-cols-[minmax(280px,1.55fr)_120px_120px_145px_145px_125px_165px_110px_120px_145px_165px] gap-3 border-b border-[#F1F5F9] px-4 py-3 text-[12px]">
                <div><p className="truncate font-semibold text-[#0F172A]">{item.customer_name}</p><p className="truncate text-[11px] text-[#64748B]">{item.cnpj ?? "-"} • {item.protocol}</p></div>
                <div><span className="inline-flex rounded-full border border-[#C7D2FE] bg-[#EEF2FF] px-2 py-0.5 text-[10px] font-medium text-[#4338CA]">Em aprovação</span></div>
                <p className="truncate text-[#0F172A]">{item.business_unit ?? "-"}</p>
                <p className="font-semibold text-[#0F172A]">{formatCurrencyNoCents(item.requested_limit)}</p>
                <p className="font-semibold text-[#0F172A]">{formatCurrencyNoCents(item.recommended_limit)}</p>
                <p className="font-semibold text-[#334155]">{formatCurrencyNoCents(item.financial_impact)}</p>
                <p className="text-[#334155]">{item.applicable_doa_code ?? "-"} {item.applicable_doa_range ? `• ${item.applicable_doa_range}` : ""}</p>
                <p className={item.stage_aging_days > 5 ? "font-semibold text-[#B91C1C]" : "font-semibold text-[#047857]"}>{item.stage_aging_days} dia(s)</p>
                <p className="truncate text-[#334155]">{item.assigned_analyst_name ?? "-"}</p>
                <p className="text-[#334155]">Decisão de alçada</p>
                <div className="flex justify-end">
                  {item.available_actions.some((action) => ["approve", "reject", "request_changes", "view_dossier", "view_result"].includes(action)) ? (
                    <Link href={`/analises/${item.analysis_id}`} className="inline-flex h-9 min-w-[150px] items-center justify-center rounded-[10px] border border-[#D7E1EC] bg-white px-3 font-medium text-[#1D4ED8] hover:bg-[#F8FAFC]">{mapActionLabel(item.available_actions)} <ChevronDown className="ml-2 h-4 w-4" /></Link>
                  ) : (
                    <button type="button" disabled className="inline-flex h-9 min-w-[150px] items-center justify-center rounded-[10px] border border-[#E2E8F0] bg-[#F8FAFC] px-3 text-[#94A3B8]"><ShieldAlert className="mr-2 h-4 w-4" />Sem ação disponível</button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#EEF2F7] px-4 py-2.5 text-[12px] text-[#64748B]">
          <p>Mostrando {start} a {end} de {total} solicitações</p>
          <div className="flex items-center gap-2">
            <select value={pageSize} onChange={(e) => { setPage(1); setPageSize(Number(e.target.value)); }} className="h-8 rounded-[8px] border border-[#E2E8F0] px-2 text-[12px]"><option value={10}>10 por página</option><option value={20}>20 por página</option><option value={50}>50 por página</option></select>
            <button type="button" onClick={() => setPage(1)} disabled={page <= 1} className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#E2E8F0] disabled:opacity-40"><ChevronsLeft className="h-4 w-4" /></button>
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#E2E8F0] disabled:opacity-40">‹</button>
            <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-[8px] bg-[#2563EB] px-2 font-medium text-white">{page}</span>
            <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#E2E8F0] disabled:opacity-40">›</button>
            <button type="button" onClick={() => setPage(totalPages)} disabled={page >= totalPages} className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#E2E8F0] disabled:opacity-40"><ChevronsRight className="h-4 w-4" /></button>
          </div>
        </div>
      </div>
      <div className="mt-2 text-[11px] text-[#64748B]"><CalendarDays className="mr-1 inline h-3.5 w-3.5" /> A fila exibe apenas análises em aprovação no seu escopo operacional.</div>
    </section>
  );
}

