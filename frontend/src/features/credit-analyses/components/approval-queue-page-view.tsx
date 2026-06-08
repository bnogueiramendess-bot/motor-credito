"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Check, ChevronDown, ChevronsLeft, ChevronsRight, Filter, Search, ShieldAlert, UserRoundCheck } from "lucide-react";

import { executeCreditAnalysisWorkflowAction } from "@/features/credit-analyses/api/credit-analyses.api";
import { CreditAnalysisMonitorItemDto, WorkflowActionRequest } from "@/features/credit-analyses/api/contracts";
import { useCreditAnalysesApprovalQueueQuery } from "@/features/credit-analyses/hooks/use-credit-analyses-approval-queue-query";
import { BusinessUnitContextSelector } from "@/features/business-units/components/business-unit-context-selector";
import { useBusinessUnitContextQuery } from "@/features/business-units/hooks/use-business-unit-context-query";
import { OperationalContextBar } from "@/shared/components/layout/operational-context-bar";
import { EmptyState } from "@/shared/components/states/empty-state";
import { ErrorState } from "@/shared/components/states/error-state";

type DecisionAction = "approve" | "reject" | "request_changes";

type ReturnModalState = {
  analysisId: number;
  customerName: string;
} | null;

const DECISION_ACTIONS: Array<{ value: DecisionAction; label: string }> = [
  { value: "approve", label: "Aprovar" },
  { value: "reject", label: "Rejeitar" },
  { value: "request_changes", label: "Devolver para ajustes" },
];

function formatCompactCurrency(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;

  const abs = Math.abs(parsed);
  if (abs >= 1_000_000) {
    const raw = (parsed / 1_000_000).toFixed(1).replace(".", ",");
    return `R$ ${raw}MM`;
  }
  if (abs >= 1_000) {
    const raw = (parsed / 1_000).toFixed(0);
    return `R$ ${raw}K`;
  }

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(parsed);
}

function resolveDecisionImpact(item: CreditAnalysisMonitorItemDto): { label: string; pct: string; cls: string } {
  const impact = item.financial_impact != null ? Number(item.financial_impact) : null;
  const baselineRaw = item.approved_limit ?? item.total_limit;
  const baseline = baselineRaw != null ? Number(baselineRaw) : null;

  if (impact !== null && Number.isFinite(impact) && impact === 0) {
    return { label: "Manutenção do limite atual", pct: "0%", cls: "border-[#E2E8F0] bg-[#F8FAFC] text-[#475569]" };
  }

  if (impact !== null && Number.isFinite(impact) && baseline !== null && Number.isFinite(baseline) && baseline > 0) {
    const pctValue = Math.round((impact / baseline) * 100);
    if (pctValue > 0) {
      return { label: "Aumento do limite atual", pct: `+${pctValue}%`, cls: "border-[#BBF7D0] bg-[#F0FDF4] text-[#166534]" };
    }
    if (pctValue < 0) {
      return { label: "Redução do limite atual", pct: `${pctValue}%`, cls: "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]" };
    }
    return { label: "Manutenção do limite atual", pct: "0%", cls: "border-[#E2E8F0] bg-[#F8FAFC] text-[#475569]" };
  }

  if (impact !== null && Number.isFinite(impact) && impact > 0) {
    return { label: "Aumento do limite atual", pct: "--", cls: "border-[#BBF7D0] bg-[#F0FDF4] text-[#166534]" };
  }
  if (impact !== null && Number.isFinite(impact) && impact < 0) {
    return { label: "Redução do limite atual", pct: "--", cls: "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]" };
  }

  return { label: "Manutenção do limite atual", pct: "--", cls: "border-[#E2E8F0] bg-[#F8FAFC] text-[#475569]" };
}

function statusBadgeClass(status: string) {
  if (status === "in_approval") return "border-[#BBF7D0] bg-[#DCFCE7] text-[#047857]";
  if (status === "approved") return "border-[#A7F3D0] bg-[#ECFDF5] text-[#047857]";
  if (status === "rejected") return "border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]";
  return "border-[#E2E8F0] bg-[#F8FAFC] text-[#475569]";
}

function statusLabel(status: string) {
  if (status === "in_approval") return "Em aprovação";
  if (status === "approved") return "Aprovado";
  if (status === "rejected") return "Recusado";
  return status;
}

function slaClass(days: number) {
  if (days > 10) return "border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]";
  if (days > 5) return "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]";
  return "border-[#A7F3D0] bg-[#ECFDF5] text-[#047857]";
}

function impactValueClass(label: string) {
  if (label.includes("Aumento")) return "text-[#059669]";
  if (label.includes("Redução")) return "text-[#B45309]";
  return "text-[#0F766E]";
}

function resolveUserName(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : "Não informado";
}

function formatCompactRangeValue(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const million = value / 1_000_000;
    const withDecimal = Math.round(million * 10) / 10;
    return `R$ ${withDecimal.toString().replace(".", ",")}MM`;
  }
  if (abs >= 1_000) {
    const thousand = Math.round(value / 1_000);
    return `R$ ${thousand}K`;
  }
  return `R$ ${Math.trunc(value)}`;
}

function formatDoaRange(range: string | null | undefined): string {
  if (!range) return "Não informado";
  const raw = range.trim();
  const matches = raw.match(/-?\d+(?:[.,]\d+)?/g);
  if (!matches || matches.length < 2) return raw;

  function parseFlexibleNumber(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const hasComma = trimmed.includes(",");
    const hasDot = trimmed.includes(".");
    if (hasComma && hasDot) {
      return Number(trimmed.replace(/\./g, "").replace(",", "."));
    }
    if (hasComma) {
      return Number(trimmed.replace(",", "."));
    }
    return Number(trimmed);
  }

  const min = parseFlexibleNumber(matches[0]);
  const max = parseFlexibleNumber(matches[1]);
  if (min === null || max === null || !Number.isFinite(min) || !Number.isFinite(max)) return range;

  return `${formatCompactRangeValue(min)} a ${formatCompactRangeValue(max)}`;
}

export function ApprovalQueuePageView() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const businessUnitContext = searchParams.get("business_unit_context") ?? "";
  const buContextQuery = useBusinessUnitContextQuery();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [filters, setFilters] = useState({ q: "", status_filter: "", bu: "", aging: "", assigned_analyst: "" });
  const [menuOpenFor, setMenuOpenFor] = useState<number | null>(null);
  const [returnModal, setReturnModal] = useState<ReturnModalState>(null);
  const [returnComment, setReturnComment] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  const params = useMemo(
    () => ({ ...filters, page, page_size: pageSize, business_unit_context: businessUnitContext || undefined }),
    [filters, page, pageSize, businessUnitContext],
  );

  const queueQuery = useCreditAnalysesApprovalQueueQuery(params);
  const workflowActionMutation = useMutation({
    mutationFn: ({ analysisId, payload }: { analysisId: number; payload: WorkflowActionRequest }) =>
      executeCreditAnalysisWorkflowAction(analysisId, payload),
    onSuccess: async (_, variables) => {
      setFeedback("Decisão registrada com sucesso.");
      setMenuOpenFor(null);
      setReturnModal(null);
      setReturnComment("");
      await queryClient.invalidateQueries({ queryKey: ["credit-analysis-detail", variables.analysisId] });
      await queryClient.invalidateQueries({ queryKey: ["workspace-analysis-detail", variables.analysisId] });
      await queueQuery.refetch();
    },
    onError: (error: Error) => {
      setFeedback(error.message || "Não foi possível executar a ação.");
    },
  });

  if (queueQuery.isLoading) {
    return <div className="rounded-[12px] border border-[#D7E1EC] bg-white p-6 text-[13px] text-[#4F647A]">Carregando fila de aprovação...</div>;
  }

  if (queueQuery.isError) {
    return <ErrorState title="Não foi possível carregar a fila de aprovação" description={queueQuery.error.message} onRetry={() => queueQuery.refetch()} />;
  }

  const payload = queueQuery.data;
  const items = payload?.items ?? [];
  if (!items.length) {
    return <EmptyState title="Nenhuma análise em aprovação para sua alçada." description="Quando houver solicitações no seu escopo de aprovação, elas aparecerão aqui." />;
  }

  const total = payload?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);

  function handleDecision(item: CreditAnalysisMonitorItemDto, action: DecisionAction) {
    if (action === "request_changes") {
      setReturnModal({ analysisId: item.analysis_id, customerName: item.customer_name });
      setMenuOpenFor(null);
      return;
    }

    workflowActionMutation.mutate({
      analysisId: item.analysis_id,
      payload: { action, justification: null },
    });
  }

  function submitReturnAction() {
    if (!returnModal) return;
    const trimmed = returnComment.trim();
    if (trimmed.length < 10) {
      setFeedback("A consideração deve ter ao menos 10 caracteres para devolução.");
      return;
    }

    workflowActionMutation.mutate({
      analysisId: returnModal.analysisId,
      payload: { action: "request_changes", justification: trimmed },
    });
  }

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

      {feedback ? (
        <div className="mb-3 rounded-[10px] border border-[#D7E1EC] bg-white px-3 py-2 text-[12px] text-[#334155]">{feedback}</div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => {
          const recommended = formatCompactCurrency(item.recommended_limit);
          const requested = formatCompactCurrency(item.requested_limit);
          const impact = resolveDecisionImpact(item);
          const decisionActions = DECISION_ACTIONS.filter((action) => item.available_actions.includes(action.value));
          const canOpenDossier = item.available_actions.includes("view_dossier") || decisionActions.length > 0;
          const analystName = resolveUserName(item.assigned_analyst_name);
          const requesterName = resolveUserName(item.requester_name);

          return (
            <article key={item.analysis_id} className="relative flex h-full flex-col overflow-hidden rounded-[22px] border border-[#D7E1EC] bg-white p-6 shadow-[0_16px_34px_rgba(15,23,42,0.08)]">
              <div className="absolute bottom-0 left-0 top-0 w-[6px] bg-[#10B981]" />
              <div className="mb-5 flex items-start justify-between gap-3 pl-2">
                <div className="min-w-0">
                  <p className="text-[18px] font-bold leading-tight text-[#0F2748]">{item.customer_name}</p>
                  <p className="mt-2 text-[13px] leading-snug text-[#64748B]">{item.cnpj ?? "Não informado"} • {item.protocol}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <span className="rounded-full border border-[#C7D2FE] bg-[#EEF2FF] px-3 py-1 text-[11px] font-semibold text-[#4338CA]">{item.business_unit ?? "Não informado"}</span>
                  <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${statusBadgeClass(item.current_status)}`}>{statusLabel(item.current_status)}</span>
                </div>
              </div>

              <div className={`mb-4 rounded-[18px] border p-4 ${impact.cls}`}>
                <div className="grid grid-cols-[1fr_auto] gap-3">
                  <div>
                    <p className="text-[12px] font-semibold text-[#64748B]">Limite recomendado</p>
                    <p className="mt-1 text-[38px] font-extrabold leading-[0.95] tracking-[-0.02em] text-[#0F2748]">{recommended ?? "Não informado"}</p>
                    <p className="mt-1 text-[14px] text-[#64748B]">Solicitado: <span className="font-semibold text-[#334155]">{requested ?? "Não informado"}</span></p>
                  </div>
                  <div className="flex min-w-[130px] flex-col items-end justify-center text-right">
                    <p className={`text-[36px] font-extrabold leading-none ${impactValueClass(impact.label)}`}>{impact.pct}</p>
                    <p className="mt-1 text-[12px] leading-snug text-[#64748B]">{impact.label}</p>
                  </div>
                </div>
              </div>

              <div className="mb-4 grid grid-cols-2 gap-3">
                <div className="rounded-[16px] border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#64748B]">DOA / Faixa</p>
                  <p className="mt-1 text-[13px] font-bold text-[#0F2748]">{item.applicable_doa_code ?? "Não informado"}</p>
                  <p className="text-[13px] font-semibold text-[#334155]">{formatDoaRange(item.applicable_doa_range)}</p>
                </div>
                <div className={`rounded-[16px] border px-4 py-3 ${slaClass(item.stage_aging_days)}`}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.04em]">Aging SLA</p>
                  <p className="mt-1 text-[16px] font-bold">{item.stage_aging_days} dia(s)</p>
                </div>
              </div>

              <div className="mb-4 border-t border-[#E2E8F0] pt-3">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <p className="text-[12px] text-[#64748B]">Analista</p>
                  <p className="text-[13px] font-semibold text-[#0F2748]">{analystName}</p>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[12px] text-[#64748B]">Solicitante</p>
                  <p className="text-[13px] font-semibold text-[#0F2748]">{requesterName}</p>
                </div>
              </div>

              <div className="mt-auto flex items-center justify-end gap-3">
                {canOpenDossier ? (
                  <Link href={`/analises/${item.analysis_id}`} className="inline-flex h-11 min-w-[150px] items-center justify-center rounded-[14px] bg-gradient-to-r from-[#4F46E5] to-[#4338CA] px-5 text-[14px] font-semibold text-white shadow-[0_10px_24px_rgba(79,70,229,0.35)] hover:from-[#4338CA] hover:to-[#3730A3]">
                    Abrir Dossiê
                  </Link>
                ) : (
                  <button type="button" disabled className="inline-flex h-11 min-w-[150px] cursor-not-allowed items-center justify-center rounded-[14px] border border-[#D7E1EC] bg-[#F8FAFC] px-5 text-[14px] font-semibold text-[#94A3B8]">
                    Abrir Dossiê
                  </button>
                )}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setMenuOpenFor((current) => (current === item.analysis_id ? null : item.analysis_id))}
                    disabled={decisionActions.length === 0 || workflowActionMutation.isPending}
                    className="inline-flex h-11 min-w-[132px] items-center justify-center rounded-[14px] border border-[#D7E1EC] bg-white px-4 text-[14px] font-semibold text-[#334155] disabled:cursor-not-allowed disabled:text-[#94A3B8]"
                  >
                    Decidir <ChevronDown className="ml-1 h-4 w-4" />
                  </button>
                  {menuOpenFor === item.analysis_id && decisionActions.length > 0 ? (
                    <div className="absolute right-0 z-20 mt-1 min-w-[200px] rounded-[10px] border border-[#D7E1EC] bg-white p-1 shadow-lg">
                      {decisionActions.map((action) => (
                        <button
                          key={action.value}
                          type="button"
                          onClick={() => handleDecision(item, action.value)}
                          className="flex w-full items-center gap-2 rounded-[8px] px-2 py-2 text-left text-[12px] text-[#334155] hover:bg-[#F8FAFC]"
                        >
                          <Check className="h-3.5 w-3.5 text-[#94A3B8]" />
                          {action.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-[#E2E8F0] bg-white px-4 py-2.5 text-[12px] text-[#64748B]">
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

      <div className="mt-2 text-[11px] text-[#64748B]"><CalendarDays className="mr-1 inline h-3.5 w-3.5" /> A fila exibe apenas análises em aprovação no seu escopo operacional.</div>

      {returnModal ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#0D1B2A]/55 p-4" onClick={() => setReturnModal(null)}>
          <div className="w-full max-w-[560px] rounded-[14px] border border-[#D7E1EC] bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <h3 className="text-[20px] font-semibold text-[#0F172A]">Devolver para ajustes</h3>
            <p className="mt-2 text-[13px] text-[#64748B]">Informe a consideração do aprovador para que o time financeiro ajuste a análise de {returnModal.customerName}.</p>
            <label className="mt-4 block text-[12px] font-medium text-[#334155]">
              Consideração do aprovador
              <textarea
                value={returnComment}
                onChange={(event) => setReturnComment(event.target.value)}
                rows={5}
                className="mt-1 w-full rounded-[10px] border border-[#D7E1EC] px-3 py-2 text-[12px] text-[#0F172A] outline-none focus:border-[#94A3B8]"
                placeholder="Descreva os ajustes necessários..."
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setReturnModal(null)} className="h-9 rounded-[10px] border border-[#D7E1EC] bg-white px-3 text-[12px] font-medium text-[#475569]">Cancelar</button>
              <button
                type="button"
                onClick={submitReturnAction}
                disabled={workflowActionMutation.isPending}
                className="h-9 rounded-[10px] bg-[#334155] px-3 text-[12px] font-medium text-white disabled:opacity-50"
              >
                Devolver para ajustes
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {items.some((item) => item.available_actions.length === 0) ? (
        <div className="mt-3 flex items-center gap-1 text-[11px] text-[#64748B]"><ShieldAlert className="h-3.5 w-3.5" /> Algumas análises podem não ter ações disponíveis no momento.</div>
      ) : null}
    </section>
  );
}


