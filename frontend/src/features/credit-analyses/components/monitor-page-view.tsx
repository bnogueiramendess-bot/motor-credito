"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import {
  BarChart3,
  Building2,
  CheckCircle2,
  ChevronsLeft,
  ChevronsRight,
  Clock3,
  FileText,
  Grid2X2,
  Hourglass,
  List,
  MoreVertical,
  Search,
  ShieldCheck,
  UserRoundCheck,
  UsersRound,
} from "lucide-react";

import { startCreditAnalysis } from "@/features/credit-analyses/api/credit-analyses.api";
import { CreditAnalysisMonitorItemDto } from "@/features/credit-analyses/api/contracts";
import { getCreditAnalysisWorkspaceRoute } from "@/features/credit-analyses/utils/routes";
import { useCreditAnalysesMonitorOptionsQuery, useCreditAnalysesMonitorQuery } from "@/features/credit-analyses/hooks/use-credit-analyses-monitor-query";
import { BusinessUnitContextSelector } from "@/features/business-units/components/business-unit-context-selector";
import { useBusinessUnitContextQuery } from "@/features/business-units/hooks/use-business-unit-context-query";
import { OperationalContextBar } from "@/shared/components/layout/operational-context-bar";
import { EmptyState } from "@/shared/components/states/empty-state";
import { ErrorState } from "@/shared/components/states/error-state";

type SortOption = "recent" | "oldest" | "requested_limit_desc" | "sla_desc";

type ResponsibleView = {
  name: string;
  role: string;
};

const workflowStageOptions = [
  { value: "commercial_submitted", label: "Em coleta de dados" },
  { value: "financial_review", label: "Em mesa de análise" },
  { value: "pending_approval", label: "Aguardando aprovação" },
  { value: "returned", label: "Devolvido para ajustes" },
  { value: "decided", label: "Finalizada" },
];

const sortOptions: Array<{ value: SortOption; label: string }> = [
  { value: "recent", label: "Mais recentes" },
  { value: "oldest", label: "Mais antigas" },
  { value: "requested_limit_desc", label: "Maior limite solicitado" },
  { value: "sla_desc", label: "SLA/aging" },
];

function isSubmittedForApproval(item: CreditAnalysisMonitorItemDto): boolean {
  return Boolean(item.submitted_for_approval_at || item.workflow_stage === "decided" || ["approved", "rejected", "cancelled", "completed"].includes(item.current_status));
}

function effectiveWorkflowStage(item: CreditAnalysisMonitorItemDto): string {
  if (item.workflow_stage === "pending_approval" && !isSubmittedForApproval(item)) return "financial_review";
  return item.workflow_stage;
}

function mapNextStep(item: CreditAnalysisMonitorItemDto): string {
  const stage = effectiveWorkflowStage(item);
  if (stage === "commercial_submitted") return "Enviar para mesa de análise";
  if (stage === "financial_review") return item.available_actions.includes("submit_approval") ? "Enviar para aprovação" : "Gerar dossiê";
  if (stage === "pending_approval") return item.approval_escalated_to_committee ? "Decisão do comitê" : item.current_approval_step ? "Decisão do aprovador" : "Aprovação pela alçada";
  if (stage === "returned") return "Ajustar solicitação";
  if (stage === "decided") return "Concluída";
  return "Acompanhar workflow";
}

function mapOwnerRole(role: string | null | undefined): string {
  if (role === "analista_financeiro") return "Analista Financeiro";
  if (role === "comercial_solicitante" || role === "comercial") return "Comercial";
  if (role === "aprovador") return "Mesa de Análise";
  if (role) return role.replace(/_/g, " ");
  return "Mesa de Análise";
}

function getAgingTone(days: number): string {
  if (days >= 10) return "text-[#E11D48]";
  if (days >= 2) return "text-[#EA580C]";
  return "text-[#047857]";
}

function getAgingLabel(item: CreditAnalysisMonitorItemDto): string {
  if (item.current_status === "approved" || effectiveWorkflowStage(item) === "decided") return item.aging_days === 0 ? "Hoje" : `${item.aging_days} dia(s)`;
  return `${item.stage_aging_days || item.aging_days} dia(s)`;
}

function resolveOpenRoute(analysisId: number): string {
  return getCreditAnalysisWorkspaceRoute(analysisId);
}

function formatCurrencyNoCents(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "-";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(parsed);
}

function numericValue(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function statusAccent(item: CreditAnalysisMonitorItemDto): string {
  const stage = effectiveWorkflowStage(item);
  if (item.current_status === "approved") return "bg-[#16A34A]";
  if (item.current_status === "rejected") return "bg-[#DC2626]";
  if (item.current_status === "cancelled") return "bg-[#64748B]";
  if (isSubmittedForApproval(item) && item.approval_escalated_to_committee) return "bg-[#D97706]";
  if (stage === "pending_approval") return "bg-[#D97706]";
  if (stage === "financial_review") return "bg-[#2563EB]";
  if (stage === "commercial_submitted") return "bg-[#7C3AED]";
  return "bg-[#94A3B8]";
}

function statusBadgeView(item: CreditAnalysisMonitorItemDto): { label: string; className: string } {
  const stage = effectiveWorkflowStage(item);
  if (item.current_status === "approved") return { label: "Aprovada", className: "border-[#BBF7D0] bg-[#ECFDF5] text-[#047857]" };
  if (item.current_status === "rejected") return { label: "Recusada", className: "border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]" };
  if (item.current_status === "cancelled") return { label: "Cancelada", className: "border-[#CBD5E1] bg-[#F1F5F9] text-[#475569]" };
  if ((item.stage_aging_days || item.aging_days) >= 10) return { label: "SLA vencido", className: "border-[#FECACA] bg-[#FEF2F2] text-[#DC2626]" };
  if (isSubmittedForApproval(item) && item.approval_escalated_to_committee) return { label: "Aguardando comitê", className: "border-[#FED7AA] bg-[#FFF7ED] text-[#9A3412]" };
  if (stage === "pending_approval") return { label: "Aguardando aprovação", className: "border-[#FED7AA] bg-[#FFFBEB] text-[#A16207]" };
  if (stage === "financial_review") return { label: "Em mesa de análise", className: "border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8]" };
  if (stage === "commercial_submitted") return { label: "Em coleta de dados", className: "border-[#DDD6FE] bg-[#F5F3FF] text-[#6D28D9]" };
  if (stage === "returned") return { label: "Devolvida", className: "border-[#FDE68A] bg-[#FFFBEB] text-[#A16207]" };
  return { label: item.status_label || "Em andamento", className: "border-[#E2E8F0] bg-[#F8FAFC] text-[#475569]" };
}

function policyReferenceTone(reference: CreditAnalysisMonitorItemDto["policy_reference"]): string {
  if (reference.fallback_used) return "border-[#FED7AA] bg-[#FFF7ED] text-[#C2410C]";
  if (reference.engine === "configurable_policy") return "border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8]";
  if (reference.engine === "legacy_policy") return "border-[#CBD5E1] bg-[#F8FAFC] text-[#475569]";
  if (reference.display_label === "A definir") return "border-[#E2E8F0] bg-white text-[#64748B]";
  return "border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]";
}

function customerTypeLabel(item: CreditAnalysisMonitorItemDto): string {
  if (item.is_early_review_request) return "Revisão antecipada";
  return item.is_new_customer ? "Novo cliente" : "Cliente existente";
}

function customerTypeTone(item: CreditAnalysisMonitorItemDto): string {
  if (item.is_early_review_request) return "border-[#FED7AA] bg-[#FFF7ED] text-[#9A3412]";
  if (item.is_new_customer) return "border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8]";
  return "border-[#BBF7D0] bg-[#ECFDF5] text-[#047857]";
}

function resolveResponsible(item: CreditAnalysisMonitorItemDto): ResponsibleView {
  const stage = effectiveWorkflowStage(item);
  if (stage === "decided" || ["approved", "rejected", "cancelled", "completed"].includes(item.current_status)) {
    return { name: statusBadgeView(item).label, role: "Workflow finalizado" };
  }
  if (isSubmittedForApproval(item) && (item.approval_escalated_to_committee || /committee|comite|comit/i.test(`${item.current_approval_step ?? ""} ${item.current_approval_step_code ?? ""}`))) {
    return { name: "Comitê de Crédito", role: item.approval_sla_label ?? "Alçada colegiada" };
  }
  if (stage === "pending_approval") {
    return {
      name: item.approver_name || item.current_approval_step || "Aprovador da alçada",
      role: item.current_approval_step_code || item.applicable_doa_range || "Aprovação de crédito",
    };
  }
  if (item.assigned_analyst_name) {
    return { name: item.assigned_analyst_name, role: "Analista Financeiro" };
  }
  if (item.current_owner_role && item.current_owner_role !== "aprovador") {
    return { name: mapOwnerRole(item.current_owner_role), role: stage === "commercial_submitted" ? "Coleta de dados" : "Mesa de Análise" };
  }
  return { name: stage === "commercial_submitted" ? "Coleta de dados" : "Mesa de Análise", role: "Responsável operacional" };
}

function resolveLimitLabel(item: CreditAnalysisMonitorItemDto): string {
  if (item.current_status === "approved" || effectiveWorkflowStage(item) === "decided") return "Limite aprovado";
  return "Limite recomendado";
}

function resolveDisplayLimit(item: CreditAnalysisMonitorItemDto): string {
  if (item.current_status === "approved" || effectiveWorkflowStage(item) === "decided") {
    return formatCurrencyNoCents(item.approved_limit ?? item.total_limit);
  }
  return formatCurrencyNoCents(item.recommended_limit ?? item.suggested_limit);
}

type CommitteeAwareMonitorItem = CreditAnalysisMonitorItemDto & {
  requires_committee?: boolean;
  committee_required?: boolean;
};

function requiresCommitteeReview(item: CreditAnalysisMonitorItemDto): boolean {
  const committeeAware = item as CommitteeAwareMonitorItem;
  return Boolean(committeeAware.requires_committee || committeeAware.committee_required || item.approval_escalated_to_committee);
}

function shouldShowCommitteeRecommendationHint(item: CreditAnalysisMonitorItemDto): boolean {
  if (item.current_status === "approved" || effectiveWorkflowStage(item) === "decided") return false;
  return requiresCommitteeReview(item) && numericValue(item.recommended_limit ?? item.suggested_limit) === 0;
}

function shortPolicyLabel(reference: CreditAnalysisMonitorItemDto["policy_reference"]): string {
  const baseLabel = (reference.policy_code || reference.policy_name || reference.display_label || "A definir")
    .replace(/^pol[ií]tica\s+/i, "")
    .trim();
  const version = reference.policy_version ? `v${reference.policy_version}` : "";
  if (!version || new RegExp(`\\b${version}\\b`, "i").test(baseLabel)) return baseLabel;
  return `${baseLabel} ${version}`;
}

function secondaryActions(item: CreditAnalysisMonitorItemDto): Array<{ label: string; href: string }> {
  const actions: Array<{ label: string; href: string }> = [];
  if (item.available_actions.includes("view_dossier")) actions.push({ label: "Ver dossiê", href: getCreditAnalysisWorkspaceRoute(item.analysis_id) });
  if (item.available_actions.includes("view_result")) actions.push({ label: "Ver resultado", href: getCreditAnalysisWorkspaceRoute(item.analysis_id) });
  if (item.available_actions.includes("submit_approval")) actions.push({ label: "Submeter para aprovação", href: getCreditAnalysisWorkspaceRoute(item.analysis_id) });
  if (item.available_actions.some((action) => ["approve", "reject", "request_changes"].includes(action))) actions.push({ label: "Decidir aprovação", href: getCreditAnalysisWorkspaceRoute(item.analysis_id) });
  return actions;
}

export function MonitorPageView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const businessUnitContext = searchParams.get("business_unit_context") ?? "";
  const showSubmissionSuccess = searchParams.get("submission") === "success";
  const showApprovalSubmissionSuccess = searchParams.get("approvalSubmission") === "success";
  const buContextQuery = useBusinessUnitContextQuery();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [sortBy, setSortBy] = useState<SortOption>("recent");
  const [policyFilter, setPolicyFilter] = useState("");
  const [filters, setFilters] = useState({
    q: "",
    status_filter: "",
    workflow_stage: "",
    analysis_type: "",
    requester: "",
    assigned_analyst: "",
    date_from: "",
    date_to: "",
  });
  const [startingAnalysisId, setStartingAnalysisId] = useState<number | null>(null);

  const startAnalysisMutation = useMutation({
    mutationFn: startCreditAnalysis,
    onSuccess: (_, analysisId) => {
      router.push(getCreditAnalysisWorkspaceRoute(analysisId));
    },
    onError: () => {
      alert("Você não possui autorização para iniciar esta análise.");
    },
    onSettled: () => setStartingAnalysisId(null),
  });

  const params = useMemo(
    () => ({ ...filters, page, page_size: pageSize, business_unit_context: businessUnitContext || undefined }),
    [filters, page, pageSize, businessUnitContext]
  );
  const monitorQuery = useCreditAnalysesMonitorQuery(params);
  const optionsQuery = useCreditAnalysesMonitorOptionsQuery(businessUnitContext || undefined);

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
  const policyOptions = Array.from(new Set(items.map((item) => item.policy_reference.display_label).filter(Boolean))).sort();
  const filteredItems = policyFilter ? items.filter((item) => item.policy_reference.display_label === policyFilter) : items;
  const sortedItems = [...filteredItems].sort((a, b) => {
    if (sortBy === "oldest") return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    if (sortBy === "requested_limit_desc") return numericValue(b.requested_limit ?? b.suggested_limit) - numericValue(a.requested_limit ?? a.suggested_limit);
    if (sortBy === "sla_desc") return (b.stage_aging_days || b.aging_days) - (a.stage_aging_days || a.aging_days);
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const approvedLastSevenDays = items.filter((item) => {
    const referenceDate = new Date(item.updated_at || item.created_at).getTime();
    return item.current_status === "approved" && Number.isFinite(referenceDate) && referenceDate >= sevenDaysAgo;
  }).length;
  const kpis = [
    { label: "Em andamento", value: payload?.kpis.in_analysis ?? items.filter((i) => !["approved", "rejected", "cancelled"].includes(i.current_status)).length, icon: FileText, tone: "text-[#2563EB] bg-[#EFF6FF]" },
    { label: "Aguardando aprovação", value: payload?.kpis.awaiting_approval ?? items.filter((i) => effectiveWorkflowStage(i) === "pending_approval").length, icon: Clock3, tone: "text-[#D97706] bg-[#FFFBEB]" },
    { label: "Aprovadas nos últimos 7 dias", value: approvedLastSevenDays, icon: CheckCircle2, tone: "text-[#059669] bg-[#ECFDF5]" },
    { label: "SLA vencido", value: items.filter((i) => (i.stage_aging_days || i.aging_days) >= 10 && effectiveWorkflowStage(i) !== "decided").length, icon: Hourglass, tone: "text-[#DC2626] bg-[#FEF2F2]" },
    { label: "Total de solicitações", value: payload?.kpis.total ?? total, icon: BarChart3, tone: "text-[#4F46E5] bg-[#EEF2FF]" },
  ];

  return (
    <section className="readability-standard min-w-0 rounded-[12px] border border-[#E2E8F0] bg-[#F8FAFC] p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[30px] font-semibold tracking-[-0.02em] text-[#0F172A]">Monitor de Solicitações</p>
          <p className="text-[14px] text-[#64748B]">Acompanhe todas as solicitações de crédito e suas etapas de aprovação.</p>
        </div>
      </div>

      {showApprovalSubmissionSuccess ? (
        <div className="mb-3 rounded-[10px] border border-[#BBF7D0] bg-[#F0FDF4] px-3 py-2 text-[13px] text-[#166534]">Solicitação enviada para aprovação com sucesso.</div>
      ) : null}
      {showSubmissionSuccess ? (
        <div className="mb-3 rounded-[10px] border border-[#BBF7D0] bg-[#F0FDF4] px-3 py-2 text-[13px] text-[#166534]">Solicitação submetida com sucesso. Ela foi encaminhada para análise financeira.</div>
      ) : null}

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

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        {kpis.map(({ label, value, icon: Icon, tone }) => (
          <article key={label} className="rounded-[8px] border border-[#E2E8F0] bg-white px-4 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
            <div className="flex items-center justify-between gap-3">
              <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] ${tone}`}><Icon className="h-5 w-5" /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium text-[#475569]">{label}</p>
                <p className="text-[25px] font-semibold leading-[1.1] text-[#0F172A]">{value}</p>
              </div>
            </div>
          </article>
        ))}
      </div>

      <div className="mb-4 grid gap-2 lg:grid-cols-[minmax(220px,1.8fr)_minmax(150px,0.9fr)_minmax(150px,0.9fr)_minmax(150px,0.9fr)_minmax(150px,0.9fr)_minmax(150px,0.9fr)_auto]">
        <label className="flex h-11 min-w-0 items-center rounded-[8px] border border-[#D7E1EC] bg-white px-3 text-[12px] text-[#64748B]">
          <Search className="mr-2 h-4 w-4 shrink-0 text-[#94A3B8]" />
          <input value={filters.q} onChange={(e) => { setPage(1); setFilters((p) => ({ ...p, q: e.target.value })); }} placeholder="Buscar por cliente, CNPJ ou protocolo..." className="min-w-0 flex-1 bg-transparent outline-none" />
        </label>
        <select value={filters.workflow_stage} onChange={(e) => { setPage(1); setFilters((p) => ({ ...p, workflow_stage: e.target.value })); }} className="h-11 rounded-[8px] border border-[#D7E1EC] bg-white px-3 text-[12px] text-[#0F172A]">
          <option value="">Etapa: Todos</option>
          {workflowStageOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={filters.assigned_analyst} onChange={(e) => { setPage(1); setFilters((p) => ({ ...p, assigned_analyst: e.target.value })); }} className="h-11 rounded-[8px] border border-[#D7E1EC] bg-white px-3 text-[12px] text-[#0F172A]">
          <option value="">Responsável: Todos</option>
          {(optionsQuery.data?.analysts ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={filters.status_filter} onChange={(e) => { setPage(1); setFilters((p) => ({ ...p, status_filter: e.target.value })); }} className="h-11 rounded-[8px] border border-[#D7E1EC] bg-white px-3 text-[12px] text-[#0F172A]">
          <option value="">Status: Todos</option>
          {(optionsQuery.data?.statuses ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={policyFilter} onChange={(e) => setPolicyFilter(e.target.value)} className="h-11 rounded-[8px] border border-[#D7E1EC] bg-white px-3 text-[12px] text-[#0F172A]">
          <option value="">Política: Todas</option>
          {policyOptions.map((label) => <option key={label} value={label}>{label}</option>)}
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortOption)} className="h-11 rounded-[8px] border border-[#D7E1EC] bg-white px-3 text-[12px] text-[#0F172A]">
          {sortOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <div className="hidden h-11 items-center gap-1 lg:flex">
          <button type="button" title="Cards" className="inline-flex h-11 w-11 items-center justify-center rounded-[8px] bg-[#EEF2FF] text-[#4F46E5]"><Grid2X2 className="h-4 w-4" /></button>
          <button type="button" title="Lista" className="inline-flex h-11 w-11 items-center justify-center rounded-[8px] border border-[#D7E1EC] bg-white text-[#64748B]"><List className="h-4 w-4" /></button>
        </div>
      </div>

      {total === 0 ? (
        <EmptyState title="Você ainda não possui solicitações de crédito em acompanhamento." description="Assim que novas solicitações entrarem no workflow, elas aparecerão aqui." />
      ) : sortedItems.length === 0 ? (
        <div className="rounded-[8px] border border-[#D7E1EC] bg-white p-6 text-[13px] text-[#64748B]">Nenhuma solicitação encontrada para os filtros selecionados.</div>
      ) : (
        <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {sortedItems.map((item) => {
            const badge = statusBadgeView(item);
            const responsible = resolveResponsible(item);
            const actions = secondaryActions(item);
            const isStartingThis = startAnalysisMutation.isPending && startingAnalysisId === item.analysis_id;
            const canOpen = item.available_actions.length > 0;
            return (
              <article key={item.analysis_id} className="relative min-w-0 overflow-visible rounded-[8px] border border-[#D7E1EC] bg-white shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
                <span className={`block h-1.5 rounded-t-[8px] ${statusAccent(item)}`} />
                <div className="p-4">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <span className={`inline-flex max-w-[70%] items-center truncate rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase ${badge.className}`}>{badge.label}</span>
                    <span className={`shrink-0 text-[12px] font-semibold ${getAgingTone(item.stage_aging_days || item.aging_days)}`}>{getAgingLabel(item)}</span>
                  </div>

                  <div className="mb-4 flex gap-3">
                    <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] bg-[#EFF6FF] text-[#2563EB]"><Building2 className="h-5 w-5" /></span>
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-[15px] font-semibold uppercase leading-5 text-[#0F172A]" title={item.customer_name}>{item.customer_name}</p>
                      <p className="truncate text-[12px] text-[#475569]">{item.cnpj ?? "CNPJ não informado"}</p>
                      <p className="truncate text-[12px] text-[#475569]">Protocolo: {item.protocol}</p>
                    </div>
                  </div>

                  <div className="mb-4 grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[11px] font-medium text-[#64748B]">Limite solicitado</p>
                      <p className="truncate text-[14px] font-semibold text-[#0F172A]">{formatCurrencyNoCents(item.requested_limit ?? item.suggested_limit)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-medium text-[#64748B]">{resolveLimitLabel(item)}</p>
                      <p className="truncate text-[14px] font-semibold text-[#0F172A]">{resolveDisplayLimit(item)}</p>
                      {shouldShowCommitteeRecommendationHint(item) ? <p className="mt-1 text-[10px] font-semibold text-[#92400E]">Requer Comitê</p> : null}
                    </div>
                  </div>

                  <div className="mb-4 grid grid-cols-2 gap-2 border-t border-[#E2E8F0] pt-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-medium text-[#64748B]">Responsável atual</p>
                      <div className="mt-1 flex min-w-0 items-start gap-1.5">
                        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#F1F5F9] text-[#475569]">
                          {responsible.name === "Comitê de Crédito" ? <UsersRound className="h-3.5 w-3.5" /> : responsible.role === "Workflow finalizado" ? <ShieldCheck className="h-3.5 w-3.5" /> : <UserRoundCheck className="h-3.5 w-3.5" />}
                        </span>
                        <div className="min-w-0">
                          <p className="line-clamp-2 text-[11px] font-semibold leading-4 text-[#0F172A]" title={responsible.name}>{responsible.name}</p>
                          <p className="line-clamp-2 text-[10px] leading-[14px] text-[#64748B]" title={responsible.role}>{responsible.role}</p>
                        </div>
                      </div>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-medium text-[#64748B]">Próxima etapa</p>
                      <p className="mt-1 line-clamp-2 text-[11px] font-semibold leading-4 text-[#0F172A]">{mapNextStep(item)}</p>
                    </div>
                  </div>

                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${customerTypeTone(item)}`}>{customerTypeLabel(item)}</span>
                    <span className={`max-w-full truncate rounded-full border px-2 py-1 text-[10px] font-semibold ${policyReferenceTone(item.policy_reference)}`} title={item.policy_reference.status_label}>
                      {shortPolicyLabel(item.policy_reference)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {item.available_actions.includes("start_analysis") ? (
                      <button
                        type="button"
                        onClick={() => {
                          setStartingAnalysisId(item.analysis_id);
                          startAnalysisMutation.mutate(item.analysis_id);
                        }}
                        disabled={isStartingThis}
                        className="inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-[8px] border border-[#C4B5FD] bg-white px-3 text-[12px] font-semibold text-[#4F46E5] hover:bg-[#F5F3FF] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <FileText className="h-4 w-4" /> {isStartingThis ? "Abrindo..." : "Abrir solicitação"}
                      </button>
                    ) : canOpen ? (
                      <Link href={resolveOpenRoute(item.analysis_id)} className="inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-[8px] border border-[#C4B5FD] bg-white px-3 text-[12px] font-semibold text-[#4F46E5] hover:bg-[#F5F3FF]">
                        <FileText className="h-4 w-4" /> Abrir solicitação
                      </Link>
                    ) : (
                      <button type="button" disabled className="inline-flex h-10 min-w-0 flex-1 items-center justify-center rounded-[8px] border border-[#E2E8F0] bg-[#F8FAFC] px-3 text-[12px] font-semibold text-[#94A3B8]">Acesso não autorizado</button>
                    )}

                    <details className="relative">
                      <summary className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-[8px] border border-[#D7E1EC] bg-white text-[#4F46E5] marker:hidden">
                        <MoreVertical className="h-4 w-4" />
                      </summary>
                      <div className="absolute bottom-11 right-0 z-20 w-48 overflow-hidden rounded-[8px] border border-[#D7E1EC] bg-white py-1 shadow-[0_16px_32px_rgba(15,23,42,0.16)]">
                        {actions.length ? actions.map((action) => (
                          <Link key={action.label} href={action.href} className="block px-3 py-2 text-[12px] font-medium text-[#334155] hover:bg-[#F8FAFC]">{action.label}</Link>
                        )) : <span className="block px-3 py-2 text-[12px] text-[#94A3B8]">Sem ações secundárias</span>}
                      </div>
                    </details>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-[#E2E8F0] bg-white px-4 py-3 text-[12px] text-[#64748B]">
        <p>Mostrando {start} a {end} de {total} solicitações</p>
        <div className="flex items-center gap-2">
          <select value={pageSize} onChange={(e) => { setPage(1); setPageSize(Number(e.target.value)); }} className="h-8 rounded-[8px] border border-[#E2E8F0] px-2 text-[12px] text-[#0F172A]">
            <option value={12}>12 por página</option>
            <option value={24}>24 por página</option>
            <option value={48}>48 por página</option>
          </select>
          <button type="button" onClick={() => setPage(1)} disabled={page <= 1} className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#E2E8F0] disabled:opacity-40"><ChevronsLeft className="h-4 w-4" /></button>
          <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#E2E8F0] disabled:opacity-40">‹</button>
          <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-[8px] bg-[#2563EB] px-2 font-medium text-white">{page}</span>
          <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#E2E8F0] disabled:opacity-40">›</button>
          <button type="button" onClick={() => setPage(totalPages)} disabled={page >= totalPages} className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#E2E8F0] disabled:opacity-40"><ChevronsRight className="h-4 w-4" /></button>
        </div>
      </div>
    </section>
  );
}


