"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { CalendarDays, CheckCircle2, ChevronDown, ChevronsLeft, ChevronsRight, Clock3, Filter, FlaskConical, Hourglass, Search, Undo2, UserRoundCheck } from "lucide-react";

import { startCreditAnalysis } from "@/features/credit-analyses/api/credit-analyses.api";
import { useCreditAnalysesMonitorOptionsQuery, useCreditAnalysesMonitorQuery } from "@/features/credit-analyses/hooks/use-credit-analyses-monitor-query";
import { BusinessUnitContextSelector } from "@/features/business-units/components/business-unit-context-selector";
import { useBusinessUnitContextQuery } from "@/features/business-units/hooks/use-business-unit-context-query";
import { OperationalContextBar } from "@/shared/components/layout/operational-context-bar";
import { EmptyState } from "@/shared/components/states/empty-state";
import { ErrorState } from "@/shared/components/states/error-state";
import { PermissionDeniedState } from "@/shared/components/states/permission-denied-state";
import { getEffectivePermissions, hasPermission } from "@/shared/lib/auth/permissions";

function mapNextStep(workflowStage: string): string {
  if (workflowStage === "financial_review") return "Em análise financeira";
  if (workflowStage === "pending_approval") return "Aguardando decisão";
  if (workflowStage === "decided") return "Concluída";
  return "Aguardando análise";
}

function mapRole(role: string): string {
  if (role === "analista_financeiro") return "Analista Financeiro";
  if (role === "aprovador") return "Aprovador";
  if (role === "comercial") return "Comercial";
  return "Não definido";
}

function getAgingTone(days: number): string {
  if (days >= 10) return "text-[#E11D48]";
  if (days >= 2) return "text-[#D97706]";
  return "text-[#16A34A]";
}

function mapActionLabel(actions: string[]): string {
  if (actions.includes("start_analysis")) return "Iniciar Análise";
  if (actions.includes("continue_analysis")) return "Continuar Análise";
  if (actions.includes("submit_approval")) return "Submeter para aprovação";
  if (actions.includes("review_decision")) return "Revisar decisão";
  if (actions.includes("view_dossier")) return "Ver dossiê";
  if (actions.includes("view_result")) return "Ver resultado";
  return "Acompanhar status";
}

function formatCurrencyNoCents(value: number | string | null | undefined): string {
  if (value === null || value === undefined) {
    return "-";
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return "-";
  }
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(parsed);
}

function statusAccent(status: string): string {
  if (status === "approved") return "bg-[#16A34A]";
  if (status === "rejected") return "bg-[#DC2626]";
  if (status === "in_approval") return "bg-[#4F46E5]";
  
  if (status === "cancelled") return "bg-[#6B7280]";
  return "bg-[#D97706]";
}

function summarizeStatus(status: string): "Aprovado" | "Recusado" | "Pendente" | "Em aprovação" | "Em andamento" {
  if (status === "approved") return "Aprovado";
  if (status === "rejected") return "Recusado";
  if (status === "pending") return "Pendente";
  if (status === "in_approval") return "Em aprovação";
  return "Em andamento";
}

function statusBadge(status: string, label: string): string {
  if (status === "approved") return "border-[#A7F3D0] bg-[#ECFDF5] text-[#047857]";
  if (status === "rejected") return "border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]";
  if (status === "in_approval") return "border-[#C7D2FE] bg-[#EEF2FF] text-[#4338CA]";
  
  
  return label === "Em análise financeira" || label === "Aguardando análise"
    ? "border-[#FCD34D] bg-[#FFFBEB] text-[#B45309]"
    : "border-[#D7E1EC] bg-[#F8FAFC] text-[#295B9A]";
}

function typeBadges(item: { is_new_customer: boolean; is_early_review_request: boolean; has_recent_analysis: boolean }): string[] {
  const list: string[] = [];
  list.push(item.is_new_customer ? "Novo cliente" : "Cliente da carteira");
  if (item.is_early_review_request) list.push("Revisão antecipada");
  if (item.has_recent_analysis) list.push("Possui análise recente");
  return list;
}

export function MonitorPageView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const businessUnitContext = searchParams.get("business_unit_context") ?? "";
  const buContextQuery = useBusinessUnitContextQuery();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [filters, setFilters] = useState({
    q: "",
    status_filter: "",
    workflow_stage: "",
    analysis_type: "",
    requester: "",
    assigned_analyst: "",
    date_from: "",
    date_to: ""
  });
  const [startingAnalysisId, setStartingAnalysisId] = useState<number | null>(null);

  const startAnalysisMutation = useMutation({
    mutationFn: startCreditAnalysis,
    onSuccess: (_, analysisId) => {
      router.push(`/analises/${analysisId}/workspace`);
    },
    onSettled: () => setStartingAnalysisId(null),
  });

  const params = useMemo(
    () => ({ ...filters, page, page_size: pageSize, business_unit_context: businessUnitContext || undefined }),
    [filters, page, pageSize, businessUnitContext]
  );
  const monitorQuery = useCreditAnalysesMonitorQuery(params);
  const optionsQuery = useCreditAnalysesMonitorOptionsQuery(businessUnitContext || undefined);
  const [permissions, setPermissions] = useState<string[] | null>(null);

  useEffect(() => {
    setPermissions(getEffectivePermissions());
  }, []);

  if (permissions === null) {
    return <div className="rounded-[12px] border border-[#D7E1EC] bg-white p-6 text-[13px] text-[#4F647A]">Carregando permissões...</div>;
  }

  const canViewRequests = hasPermission("credit.requests.view", permissions);
  const canExecuteAnalysis = hasPermission("credit.analysis.execute", permissions);
  const canSubmitRequest = hasPermission("credit.request.submit", permissions);
  const canViewDossier = hasPermission("clients.dossier.view", permissions);

  if (!canViewRequests) {
    return <PermissionDeniedState />;
  }

  if (monitorQuery.isLoading) {
    return <div className="rounded-[12px] border border-[#D7E1EC] bg-white p-6 text-[13px] text-[#4F647A]">Carregando monitor de solicitações...</div>;
  }
  if (monitorQuery.isError) {
    return <ErrorState title="Não foi possível carregar o monitor de solicitações" description={monitorQuery.error.message} onRetry={() => monitorQuery.refetch()} />;
  }

  const payload = monitorQuery.data;
  const items = payload?.items ?? [];
  const total = payload?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);

  if (!items.length) {
    return <EmptyState title="Você ainda não possui solicitações de crédito em acompanhamento." description="Assim que novas solicitações entrarem no workflow, elas aparecerão aqui." />;
  }

  const kpis = [
    { label: "Total", value: payload?.kpis.total ?? 0, icon: FlaskConical, tone: "text-[#4F46E5] bg-[#EEF2FF]" },
    { label: "Pendente", value: items.filter((i) => i.current_status === "pending").length, icon: Hourglass, tone: "text-[#D97706] bg-[#FFFBEB]" },
    { label: "Em andamento", value: payload?.kpis.in_analysis ?? 0, icon: Clock3, tone: "text-[#2563EB] bg-[#EFF6FF]" },
    { label: "Em aprovação", value: payload?.kpis.awaiting_approval ?? 0, icon: UserRoundCheck, tone: "text-[#7C3AED] bg-[#F5F3FF]" },
    { label: "Aprovado", value: items.filter((i) => i.current_status === "approved").length, icon: CheckCircle2, tone: "text-[#059669] bg-[#ECFDF5]" },
    { label: "Recusado", value: items.filter((i) => i.current_status === "rejected").length, icon: Undo2, tone: "text-[#B91C1C] bg-[#FEF2F2]" },
    { label: "Revisões antecipadas", value: payload?.kpis.early_reviews ?? 0, icon: CalendarDays, tone: "text-[#2563EB] bg-[#EFF6FF]" }
  ];
  const rowGridClass = "xl:grid-cols-[minmax(280px,1.7fr)_150px_150px_150px_150px_180px_90px_180px_170px]";

  return (
    <section className="readability-standard rounded-[12px] border border-[#E2E8F0] bg-[#F8FAFC] p-4">
      <div className="mb-3">
        <p className="text-[30px] font-semibold tracking-[-0.02em] text-[#0F172A]">Monitor de Solicitações</p>
        <p className="text-[14px] text-[#64748B]">Acompanhe solicitações de crédito, pendências operacionais e decisões em andamento.</p>
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

      <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-7">
        {kpis.map(({ label, value, icon: Icon, tone }) => (
          <article key={label} className="rounded-[12px] border border-[#E2E8F0] bg-white px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className={`inline-flex h-7 w-7 items-center justify-center rounded-[8px] ${tone}`}><Icon className="h-4 w-4" /></span>
              <div>
                <p className="text-[11px] text-[#64748B]">{label}</p>
                <p className="text-[24px] font-semibold leading-[1.1] text-[#0F172A]">{value}</p>
              </div>
            </div>
          </article>
        ))}
      </div>

      <div className="mb-3 rounded-[12px] border border-[#E2E8F0] bg-white p-2.5">
        <div className="grid gap-2 xl:grid-cols-[2fr_1.4fr_1.2fr_1.5fr_auto]">
          <label className="flex h-10 items-center rounded-[10px] border border-[#E2E8F0] px-3 text-[12px] text-[#64748B]">
            <Search className="mr-2 h-4 w-4 text-[#94A3B8]" />
            <input value={filters.q} onChange={(e) => { setPage(1); setFilters((p) => ({ ...p, q: e.target.value })); }} placeholder="Buscar por cliente, CNPJ ou protocolo" className="w-full bg-transparent outline-none" />
          </label>
          <select value={filters.status_filter} onChange={(e) => { setPage(1); setFilters((p) => ({ ...p, status_filter: e.target.value })); }} className="h-10 rounded-[10px] border border-[#E2E8F0] px-3 text-[12px] text-[#0F172A]">
            <option value="">Status (todos)</option>
            {(optionsQuery.data?.statuses ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={filters.analysis_type} onChange={(e) => { setPage(1); setFilters((p) => ({ ...p, analysis_type: e.target.value })); }} className="h-10 rounded-[10px] border border-[#E2E8F0] px-3 text-[12px] text-[#0F172A]">
            <option value="">Tipo (todos)</option>
            {(optionsQuery.data?.analysis_types ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button type="button" className="flex h-10 items-center rounded-[10px] border border-[#E2E8F0] px-3 text-[12px] text-[#64748B]">
            <CalendarDays className="mr-2 h-4 w-4" /> Período
          </button>
          <button type="button" className="flex h-10 items-center justify-center rounded-[10px] border border-[#E2E8F0] px-3 text-[12px] text-[#64748B]">
            <Filter className="mr-2 h-4 w-4" /> Filtros
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-[12px] border border-[#E2E8F0] bg-white">
        <div className="overflow-x-auto">
          <div className="min-w-[1650px]">
            <div className={`hidden border-b border-[#EEF2F7] bg-[#F8FAFC] px-4 py-2 text-[11px] font-medium text-[#64748B] xl:grid ${rowGridClass} gap-3 xl:items-center`}>
              <p className="whitespace-nowrap pl-2.5">Cliente / Protocolo</p><p className="whitespace-nowrap">Status</p><p className="whitespace-nowrap">Tipo</p><p className="whitespace-nowrap">Limite solicitado</p><p className="whitespace-nowrap">Limite aprovado</p><p className="whitespace-nowrap">Responsável atual</p><p className="whitespace-nowrap">Aging</p><p className="whitespace-nowrap">Próxima etapa</p><p className="whitespace-nowrap text-right">Ação</p>
            </div>
            {items.map((item) => (
              <article key={item.analysis_id} className={`relative grid min-h-[92px] gap-3 border-b border-[#F1F5F9] px-4 py-3 last:border-b-0 hover:bg-[#FBFDFF] xl:grid ${rowGridClass} xl:items-center`}>
                <span className={`absolute left-0.5 top-1.5 bottom-1.5 w-1 rounded-full ${statusAccent(item.current_status)}`} />
                <div className="min-w-0 pl-2.5">
                  <p className="truncate text-[13px] font-semibold text-[#0F172A]" title={item.customer_name}>{item.customer_name}</p>
                  <p className="truncate whitespace-nowrap text-[11px] text-[#64748B]">{item.cnpj ?? "-"} • {item.protocol}</p>
                  {item.economic_group || item.business_unit ? (
                    <p className="truncate whitespace-nowrap text-[11px] text-[#94A3B8]">
                      {[item.economic_group, item.business_unit].filter(Boolean).join(" • ")}
                    </p>
                  ) : null}
                </div>
                <div className="min-w-0">
              <span className={`inline-flex max-w-full whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusBadge(item.current_status, item.status_label)}`}>{summarizeStatus(item.current_status)}</span>
                </div>
                <div className="min-w-0 flex flex-wrap gap-1.5">
              {typeBadges(item).map((label) => (
                <span key={`${item.analysis_id}-${label}`} className="whitespace-nowrap rounded-full border border-[#D7E1EC] bg-[#F8FAFC] px-2 py-0.5 text-[10px] font-medium text-[#475569]">{label}</span>
              ))}
                </div>
                <div className="whitespace-nowrap text-[12px] font-semibold text-[#0F172A]">{formatCurrencyNoCents(item.suggested_limit ?? 0)}</div>
                <div className="whitespace-nowrap text-[12px] font-semibold text-[#0F172A]">
                  {item.is_new_customer
                    ? (item.approved_limit != null ? formatCurrencyNoCents(item.approved_limit) : "-")
                    : formatCurrencyNoCents(item.total_limit ?? 0)}
                </div>
                <div className="min-w-0">
                  <p className="truncate whitespace-nowrap text-[12px] font-medium text-[#0F172A]">{mapRole(item.next_responsible_role)}</p>
                  <p className="truncate whitespace-nowrap text-[11px] text-[#64748B]">Equipe Crédito</p>
                </div>
                <div className={`whitespace-nowrap text-[12px] font-semibold ${getAgingTone(item.aging_days)}`}>{item.aging_days} dia(s)</div>
                <div className="truncate whitespace-nowrap text-[12px] font-medium text-[#0F172A]">{mapNextStep(item.workflow_stage)}</div>
                <div className="flex justify-start xl:justify-end">
                  {item.available_actions.includes("view_tracking") && !item.available_actions.some((action) => ["start_analysis", "continue_analysis", "submit_approval", "review_decision", "view_dossier", "view_result"].includes(action)) ? (
                    <button type="button" disabled title="O dossiê será disponibilizado após a conclusão da análise." className="inline-flex h-9 min-w-[150px] whitespace-nowrap items-center justify-center rounded-[10px] border border-[#E2E8F0] bg-[#F8FAFC] px-3 text-[12px] font-medium text-[#94A3B8]">
                      Acompanhar status <ChevronDown className="ml-2 h-4 w-4" />
                    </button>
                  ) : (
                    item.available_actions.includes("start_analysis") && canExecuteAnalysis ? (
                      <button
                        type="button"
                        onClick={() => {
                          setStartingAnalysisId(item.analysis_id);
                          startAnalysisMutation.mutate(item.analysis_id);
                        }}
                        disabled={startAnalysisMutation.isPending && startingAnalysisId === item.analysis_id}
                        className="inline-flex h-9 min-w-[150px] whitespace-nowrap items-center justify-center rounded-[10px] border border-[#D7E1EC] bg-white px-3 text-[12px] font-medium text-[#1D4ED8] hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {startAnalysisMutation.isPending && startingAnalysisId === item.analysis_id ? "Iniciando..." : mapActionLabel(item.available_actions)} <ChevronDown className="ml-2 h-4 w-4" />
                      </button>
                    ) : (
                      (item.available_actions.includes("continue_analysis") && !canExecuteAnalysis) ||
                      (item.available_actions.includes("start_analysis") && !canExecuteAnalysis) ||
                      (item.available_actions.includes("submit_approval") && !canSubmitRequest) ||
                      ((item.available_actions.includes("view_dossier") || item.available_actions.includes("view_result")) && !canViewDossier) ? (
                        <button type="button" disabled className="inline-flex h-9 min-w-[150px] whitespace-nowrap items-center justify-center rounded-[10px] border border-[#E2E8F0] bg-[#F8FAFC] px-3 text-[12px] font-medium text-[#94A3B8]">
                          Acompanhar status <ChevronDown className="ml-2 h-4 w-4" />
                        </button>
                      ) : (
                      <Link
                        href={
                          item.available_actions.includes("continue_analysis")
                            ? canExecuteAnalysis
                              ? `/analises/${item.analysis_id}/workspace`
                              : `/analises/${item.analysis_id}`
                            : `/analises/${item.analysis_id}`
                        }
                        className="inline-flex h-9 min-w-[150px] whitespace-nowrap items-center justify-center rounded-[10px] border border-[#D7E1EC] bg-white px-3 text-[12px] font-medium text-[#1D4ED8] hover:bg-[#F8FAFC]"
                      >
                        {mapActionLabel(item.available_actions)} <ChevronDown className="ml-2 h-4 w-4" />
                      </Link>
                      )
                    )
                  )}
                </div>
              </article>
            ))}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#EEF2F7] px-4 py-2.5 text-[12px] text-[#64748B]">
              <p>Mostrando {start} a {end} de {total} solicitações</p>
              <div className="flex items-center gap-2">
                <select value={pageSize} onChange={(e) => { setPage(1); setPageSize(Number(e.target.value)); }} className="h-8 rounded-[8px] border border-[#E2E8F0] px-2 text-[12px] text-[#0F172A]">
                  <option value={10}>10 por página</option>
                  <option value={20}>20 por página</option>
                  <option value={50}>50 por página</option>
                </select>
                <button type="button" onClick={() => setPage(1)} disabled={page <= 1} className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#E2E8F0] disabled:opacity-40"><ChevronsLeft className="h-4 w-4" /></button>
                <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#E2E8F0] disabled:opacity-40">‹</button>
                <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-[8px] bg-[#2563EB] px-2 font-medium text-white">{page}</span>
                <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#E2E8F0] disabled:opacity-40">›</button>
                <button type="button" onClick={() => setPage(totalPages)} disabled={page >= totalPages} className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#E2E8F0] disabled:opacity-40"><ChevronsRight className="h-4 w-4" /></button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
