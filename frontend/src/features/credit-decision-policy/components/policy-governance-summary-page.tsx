"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Check,
  Clock3,
  FileText,
  Landmark,
  Loader2,
  ShieldCheck,
  X,
} from "lucide-react";

import {
  approvePolicyGovernanceRequest,
  getPolicyGovernanceExecutiveSummary,
  rejectPolicyGovernanceRequest,
} from "@/features/credit-decision-policy/api/policy-governance.api";
import {
  PolicyGovernanceChangeDto,
  PolicyGovernanceExecutiveSummaryResponse,
  PolicyGovernancePillarSnapshotDto,
} from "@/features/credit-decision-policy/api/policy-governance.contracts";
import { ApiError } from "@/shared/lib/http/http-client";

type PolicyGovernanceSummaryPageProps = {
  requestId: number;
};

type DecisionKind = "approve" | "reject";

const ACTION_LABEL: Record<string, string> = {
  policy_create: "Criação",
  policy_edit: "Edição",
  policy_publish: "Publicação",
  policy_archive: "Arquivamento",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Em aprovação",
  approved: "Aprovado",
  rejected: "Rejeitado",
  cancelled: "Cancelado",
  draft: "Rascunho",
  active: "Ativa",
  archived: "Arquivada",
};

const SEVERITY_CLASS: Record<string, string> = {
  low: "border-sky-300/25 bg-sky-500/10 text-sky-100",
  medium: "border-amber-300/30 bg-amber-500/10 text-amber-100",
  high: "border-red-300/30 bg-red-500/10 text-red-100",
};

function safeText(value: unknown, fallback = "Não informado"): string {
  if (value === null || value === undefined) return fallback;
  if (Array.isArray(value)) return value.length ? value.map((item) => safeText(item, "-")).join(", ") : fallback;
  if (typeof value === "object") return JSON.stringify(value);
  const text = String(value).trim();
  return text.length > 0 ? text : fallback;
}

function formatVersion(value: string | number | null | undefined): string {
  const text = safeText(value, "-");
  if (text === "-") return text;
  return text.toLowerCase().startsWith("v") ? text : `v${text}`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Não informado";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Não informado";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatWeight(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return `${parsed.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
  }
  const text = String(value);
  return text.endsWith("%") ? text : `${text}%`;
}

function statusLabel(value: string | null | undefined): string {
  return STATUS_LABEL[value ?? ""] ?? safeText(value, "-");
}

function actionLabel(value: string | null | undefined): string {
  return ACTION_LABEL[value ?? ""] ?? safeText(value, "-");
}

function severityLabel(value: string): string {
  if (value === "high") return "Alta";
  if (value === "medium") return "Média";
  if (value === "low") return "Baixa";
  return safeText(value, "-");
}

function approvalStatus(role: string, summary: PolicyGovernanceExecutiveSummaryResponse) {
  if (summary.governance.approved_roles.includes(role)) return { label: "Aprovado", cls: "border-emerald-300/25 bg-emerald-500/10 text-emerald-100", icon: Check };
  if (summary.governance.rejected_roles.includes(role)) return { label: "Rejeitado", cls: "border-red-300/25 bg-red-500/10 text-red-100", icon: X };
  return { label: "Pendente", cls: "border-amber-300/25 bg-[#0E1426] text-amber-100", icon: Clock3 };
}

function findVersionChange(changes: PolicyGovernanceChangeDto[]) {
  return changes.find((change) => change.change_type === "version_changed");
}

function countIndicators(pillars: PolicyGovernancePillarSnapshotDto[]): number | null {
  const total = pillars.reduce((sum, pillar) => sum + (Number(pillar.indicators_count) || 0), 0);
  return total > 0 ? total : null;
}

function scoreRangeCount(summary: PolicyGovernanceExecutiveSummaryResponse): string {
  const scoreChange = summary.changes.summary.find((change) => change.change_type === "score_ranges_changed");
  if (!scoreChange) return "-";
  return safeText(scoreChange.after, "-");
}

function LoadingState() {
  return (
    <div className="min-h-[620px] rounded-[18px] border border-white/10 bg-[#070A16] p-8 text-slate-100">
      <div className="flex h-[520px] items-center justify-center rounded-[18px] border border-white/10 bg-white/[0.035]">
        <div className="flex items-center gap-3 text-sm text-slate-300">
          <Loader2 className="h-5 w-5 animate-spin text-violet-300" />
          Carregando resumo executivo da solicitação...
        </div>
      </div>
    </div>
  );
}

function ErrorPanel({ title, description }: { title: string; description: string }) {
  return (
    <div className="min-h-[620px] rounded-[18px] border border-white/10 bg-[#070A16] p-8 text-slate-100">
      <Link href="/analises/fila-aprovacao" className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-violet-200">
        <ArrowLeft className="h-4 w-4" />
        Voltar para a fila de aprovação
      </Link>
      <div className="rounded-[18px] border border-red-300/25 bg-red-500/10 p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-red-200" />
          <div>
            <h2 className="text-lg font-bold text-red-100">{title}</h2>
            <p className="mt-2 text-sm text-red-100/80">{description}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChangeCard({ change }: { change: PolicyGovernanceChangeDto }) {
  const cls = SEVERITY_CLASS[change.severity] ?? "border-white/10 bg-white/[0.04] text-slate-100";
  return (
    <article className={`rounded-xl border p-4 ${cls}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] opacity-75">{safeText(change.change_type, "-")}</p>
          <h4 className="mt-1 text-base font-bold">{safeText(change.label, "-")}</h4>
          <p className="mt-1 text-sm opacity-80">{safeText(change.area, "-")}</p>
        </div>
        <span className="rounded-full border border-current/25 px-3 py-1 text-xs font-bold">{severityLabel(change.severity)}</span>
      </div>
      <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="rounded-lg bg-[#090D1C]/75 p-3">
          <p className="text-xs opacity-60">Antes</p>
          <p className="mt-1 break-words text-lg font-bold">{safeText(change.before, "-")}</p>
        </div>
        <ArrowRight className="h-4 w-4 opacity-60" />
        <div className="rounded-lg bg-[#090D1C]/75 p-3">
          <p className="text-xs opacity-60">Depois</p>
          <p className="mt-1 break-words text-lg font-bold">{safeText(change.after, "-")}</p>
        </div>
      </div>
    </article>
  );
}

export function PolicyGovernanceSummaryPage({ requestId }: PolicyGovernanceSummaryPageProps) {
  const queryClient = useQueryClient();
  const [decisionKind, setDecisionKind] = useState<DecisionKind | null>(null);
  const [justification, setJustification] = useState("");
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const summaryQuery = useQuery({
    queryKey: ["policy-governance-executive-summary", requestId],
    queryFn: () => getPolicyGovernanceExecutiveSummary(requestId),
  });

  const summary = summaryQuery.data;
  const decisionRoles = summary?.governance.current_user_decision_roles ?? [];
  const effectiveRole = selectedRole ?? decisionRoles[0] ?? null;

  const decisionMutation = useMutation({
    mutationFn: (kind: DecisionKind) => {
      const payload = {
        workflow_role_code: effectiveRole,
        justification: justification.trim() || null,
      };
      return kind === "approve"
        ? approvePolicyGovernanceRequest(requestId, payload)
        : rejectPolicyGovernanceRequest(requestId, payload);
    },
    onSuccess: async (_, kind) => {
      setFeedback(kind === "approve" ? "Política aprovada com sucesso." : "Solicitação rejeitada com sucesso.");
      setDecisionKind(null);
      setJustification("");
      await queryClient.invalidateQueries({ queryKey: ["policy-governance-executive-summary", requestId] });
      await queryClient.invalidateQueries({ queryKey: ["credit-analyses-approval-queue"] });
    },
    onError: (error: Error) => {
      setFeedback(error.message || "Não foi possível registrar a decisão.");
    },
  });

  const headerData = useMemo(() => {
    if (!summary) return null;
    const versionChange = findVersionChange(summary.changes.summary);
    const activeVersion = versionChange?.before ? formatVersion(safeText(versionChange.before, "-")) : summary.changes.base_policy_id ? `#${summary.changes.base_policy_id}` : "-";
    const proposedVersion = summary.policy?.version !== null && summary.policy?.version !== undefined ? formatVersion(summary.policy.version) : versionChange?.after ? formatVersion(safeText(versionChange.after, "-")) : "-";
    const impact = summary.changes.critical_changes.length > 0
      ? `${summary.changes.critical_changes.length} alteração(ões) críticas`
      : summary.changes.summary.length > 0
        ? `${summary.changes.summary.length} alteração(ões) relevante(s)`
        : "Sem alteração relevante";
    return { activeVersion, proposedVersion, impact };
  }, [summary]);

  if (summaryQuery.isLoading) return <LoadingState />;

  if (summaryQuery.isError) {
    const error = summaryQuery.error;
    if (error instanceof ApiError && error.status === 403) {
      return <ErrorPanel title="Sem permissão para visualizar" description="Você não possui acesso a esta solicitação de governança." />;
    }
    if (error instanceof ApiError && error.status === 404) {
      return <ErrorPanel title="Solicitação não encontrada" description="A solicitação informada não existe ou não é uma solicitação de política." />;
    }
    return <ErrorPanel title="Não foi possível carregar o resumo" description={error.message || "Tente novamente em instantes."} />;
  }

  if (!summary || !headerData) {
    return <ErrorPanel title="Payload incompleto" description="O backend retornou uma resposta sem os dados mínimos para renderização." />;
  }

  const pillars = summary.policy_snapshot.pillars ?? [];
  const indicators = countIndicators(pillars);
  const warnings = [...(summary.policy_snapshot.warnings ?? []), ...(summary.changes.warnings ?? [])];
  const requiredRoles = summary.governance.required_roles ?? [];
  const action = actionLabel(summary.request.action_type);
  const status = statusLabel(summary.request.status);
  const policyStatus = statusLabel(summary.policy?.status);
  const decisionDisabled = decisionMutation.isPending || !summary.governance.can_current_user_decide;
  const rejectNeedsJustification = decisionKind === "reject" && justification.trim().length < 3;

  function openDecision(kind: DecisionKind) {
    setDecisionKind(kind);
    setFeedback(null);
    setSelectedRole(decisionRoles[0] ?? null);
  }

  function submitDecision() {
    if (!decisionKind || rejectNeedsJustification) return;
    decisionMutation.mutate(decisionKind);
  }

  return (
    <div className="min-h-screen rounded-[18px] bg-[#070A16] text-slate-100 shadow-[0_24px_80px_rgba(2,6,23,0.35)]">
      <div className="min-h-screen rounded-[18px] bg-[radial-gradient(circle_at_top_left,#1b1f45_0,#070A16_42%,#050713_100%)]">
        <main className="px-4 py-6 sm:px-6 lg:px-8">
          <Link href="/analises/fila-aprovacao" className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-violet-200 hover:text-violet-100">
            <ArrowLeft className="h-4 w-4" />
            Voltar para a fila de aprovação
          </Link>

          <section className="mb-6 flex flex-col justify-between gap-5 xl:flex-row xl:items-start">
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-bold tracking-tight text-white">Resumo executivo da solicitação de política</h1>
                <span className="rounded-full border border-violet-300/30 bg-violet-500/15 px-3 py-1 text-xs font-bold uppercase tracking-[0.08em] text-violet-100">
                  Política Corporativa de Crédito
                </span>
              </div>
              <p className="text-sm text-slate-400">Visão para decisão de governança sobre alteração administrativa da política.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3 xl:justify-end">
              <span className="text-sm font-bold text-slate-200">Request #{summary.request.id}</span>
              <span className="rounded-full border border-emerald-300/30 bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-100">{status}</span>
              <span className="text-xs font-semibold text-slate-500">CREDIT_POLICY</span>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
            <section className="space-y-5 xl:col-span-9">
              <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/30 sm:p-6">
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-center">
                  <div className="flex items-center gap-5 lg:col-span-5">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-violet-600 shadow-lg shadow-violet-950/60">
                      <Landmark className="h-8 w-8 text-white" />
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Ação solicitada</p>
                      <h2 className="text-3xl font-extrabold tracking-tight text-white">{action}</h2>
                      <p className="mt-1 text-sm text-slate-400">{safeText(summary.executive_summary.title, "Solicitação de política")}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 border-white/10 lg:col-span-7 lg:grid-cols-4 lg:border-l lg:pl-6">
                    <div>
                      <p className="text-xs text-slate-500">Código</p>
                      <p className="mt-2 break-words font-bold text-white">{safeText(summary.policy?.code, "-")}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Versão proposta</p>
                      <p className="mt-2 font-bold text-white">{headerData.proposedVersion}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Status da política</p>
                      <p className="mt-2 font-bold text-white"><span className="mr-2 inline-block h-2 w-2 rounded-full bg-violet-300" />{policyStatus}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Impacto</p>
                      <p className="mt-2 font-bold text-white">{headerData.impact}</p>
                    </div>
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-blue-300/25 bg-blue-500/10 p-5">
                <p className="text-sm text-blue-100">
                  <strong>Importante:</strong> esta aprovação autoriza a publicação administrativa da política, mas ainda não conecta a política ao motor oficial de decisão.
                </p>
                <p className="mt-2 text-sm text-blue-100/80">A ativação ocorrerá apenas após aprovação completa do fluxo de governança.</p>
              </section>

              <div className="grid grid-cols-1 gap-5 2xl:grid-cols-2">
                <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-bold text-white">Resumo da política</h3>
                      <p className="mt-1 text-sm text-slate-400">Estrutura da versão proposta.</p>
                    </div>
                    <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-100">{formatWeight(summary.policy_snapshot.total_weight)} pesos</span>
                  </div>

                  <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-white/10 bg-[#0E1426] lg:grid-cols-4">
                    <div className="border-b border-r border-white/10 p-4 lg:border-b-0">
                      <p className="text-xs text-slate-400">Pilares</p>
                      <p className="mt-2 text-3xl font-extrabold text-white">{summary.policy_snapshot.configured_pillars ?? 0}</p>
                      <p className="text-xs text-slate-500">{summary.policy_snapshot.planned_pillars ?? 0} planejado(s)</p>
                    </div>
                    <div className="border-b border-white/10 p-4 lg:border-b-0 lg:border-r">
                      <p className="text-xs text-slate-400">Peso total</p>
                      <p className="mt-2 text-3xl font-extrabold text-white">{formatWeight(summary.policy_snapshot.total_weight)}</p>
                      <p className="text-xs text-slate-500">distribuído</p>
                    </div>
                    <div className="border-r border-white/10 p-4">
                      <p className="text-xs text-slate-400">Indicadores</p>
                      <p className="mt-2 text-3xl font-extrabold text-white">{indicators ?? "-"}</p>
                      <p className="text-xs text-slate-500">configurados</p>
                    </div>
                    <div className="p-4">
                      <p className="text-xs text-slate-400">Faixas de score</p>
                      <p className="mt-2 text-3xl font-extrabold text-white">{scoreRangeCount(summary)}</p>
                      <p className="text-xs text-slate-500">avaliadas</p>
                    </div>
                  </div>

                  <div className="mt-5 overflow-hidden rounded-xl border border-white/10">
                    <table className="w-full text-sm">
                      <thead className="bg-white/[0.035] text-left text-xs text-slate-400">
                        <tr>
                          <th className="px-4 py-3">Pilar</th>
                          <th className="px-4 py-3">Peso</th>
                          <th className="px-4 py-3">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/10">
                        {pillars.length > 0 ? pillars.map((pillar) => (
                          <tr key={safeText(pillar.code, safeText(pillar.name, "pilar"))}>
                            <td className="px-4 py-3 text-slate-100">{safeText(pillar.name, safeText(pillar.code, "-"))}</td>
                            <td className="px-4 py-3 font-bold text-white">{formatWeight(pillar.weight)}</td>
                            <td className="px-4 py-3">
                              <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-xs font-semibold text-emerald-100">{statusLabel(pillar.status)}</span>
                            </td>
                          </tr>
                        )) : (
                          <tr>
                            <td colSpan={3} className="px-4 py-6 text-center text-sm text-slate-400">Nenhum pilar configurado para exibição.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-bold text-white">Histórico da política</h3>
                      <p className="mt-1 text-sm text-slate-400">Comparativo entre versão ativa e proposta.</p>
                    </div>
                    <span className="rounded-full border border-violet-300/30 bg-violet-500/15 px-3 py-1 text-xs font-bold text-violet-100">
                      {summary.changes.has_comparison ? "Comparação disponível" : "Sem comparação"}
                    </span>
                  </div>

                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
                    <div className="rounded-xl border border-white/10 bg-[#0E1426] p-4">
                      <p className="text-xs text-slate-400">Versão ativa</p>
                      <p className="mt-2 text-2xl font-extrabold text-white">{headerData.activeVersion}</p>
                      <p className="mt-1 text-xs text-emerald-200">Status ativo ou referência base</p>
                    </div>
                    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20">
                      <ArrowRight className="h-5 w-5 text-slate-300" />
                    </div>
                    <div className="rounded-xl border border-violet-300/20 bg-violet-500/10 p-4">
                      <p className="text-xs text-slate-400">Versão proposta</p>
                      <p className="mt-2 text-2xl font-extrabold text-white">{headerData.proposedVersion}</p>
                      <p className="mt-1 text-xs text-violet-200">{policyStatus}</p>
                    </div>
                  </div>

                  <div className="mt-5">
                    <h4 className="text-base font-bold text-white">Alterações relevantes</h4>
                    <div className="mt-3 space-y-3">
                      {summary.changes.summary.length > 0 ? (
                        summary.changes.summary.map((change, index) => <ChangeCard key={`${change.change_type}-${index}`} change={change} />)
                      ) : (
                        <div className="rounded-xl border border-white/10 bg-[#0E1426] p-5 text-sm text-slate-300">Nenhuma alteração relevante identificada.</div>
                      )}
                    </div>
                  </div>

                  {warnings.length > 0 ? (
                    <div className="mt-5 rounded-xl border border-amber-300/20 bg-amber-500/10 p-4">
                      <p className="mb-2 text-sm font-bold text-amber-100">Avisos</p>
                      <ul className="space-y-1 text-sm text-amber-100/80">
                        {warnings.map((warning) => <li key={warning}>{warning}</li>)}
                      </ul>
                    </div>
                  ) : null}
                </section>
              </div>
            </section>

            <aside className="space-y-5 xl:col-span-3">
              <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
                <h3 className="text-lg font-bold text-white">Governança da solicitação</h3>
                <div className="mt-5 space-y-5 text-sm">
                  <div>
                    <p className="text-xs text-slate-500">Solicitado por</p>
                    <p className="mt-1 font-bold text-white">{safeText(summary.request.requested_by?.name, "Não informado")}</p>
                    <p className="text-xs text-slate-500">{safeText(summary.request.requested_by?.email, "-")}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Data da solicitação</p>
                    <p className="mt-1 font-bold text-white">{formatDateTime(summary.request.requested_at)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Justificativa</p>
                    <p className="mt-1 leading-relaxed text-slate-300">{safeText(summary.request.justification)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">action_type</p>
                    <p className="mt-1 font-bold text-white">{safeText(summary.request.action_type, "-")}</p>
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
                <h3 className="text-lg font-bold text-white">Aprovações necessárias</h3>
                <div className="mt-5 space-y-3">
                  {requiredRoles.length > 0 ? requiredRoles.map((role) => {
                    const state = approvalStatus(role, summary);
                    const Icon = state.icon;
                    return (
                      <div key={role} className={`rounded-xl border p-4 ${state.cls}`}>
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-bold">{role}</p>
                          <Icon className="h-4 w-4" />
                        </div>
                        <p className="mt-1 text-xs opacity-75">{state.label}</p>
                      </div>
                    );
                  }) : (
                    <div className="rounded-xl border border-white/10 bg-[#0E1426] p-4 text-sm text-slate-300">Nenhum papel obrigatório informado.</div>
                  )}
                </div>
                <p className="mt-4 text-xs text-slate-500">
                  {summary.governance.approved_roles.length} de {requiredRoles.length} aprovação(ões) concluída(s)
                </p>
              </section>

              <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
                <h3 className="text-lg font-bold text-white">Suas ações</h3>
                {feedback ? <p className="mt-3 rounded-xl border border-white/10 bg-[#0E1426] p-3 text-sm text-slate-200">{feedback}</p> : null}
                {summary.governance.can_current_user_decide ? (
                  <div className="mt-5 space-y-3">
                    <button
                      type="button"
                      onClick={() => openDecision("approve")}
                      disabled={decisionDisabled}
                      className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-bold text-white shadow-lg shadow-violet-950/50 hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <BadgeCheck className="h-4 w-4" />
                      Aprovar política
                    </button>
                    <button
                      type="button"
                      onClick={() => openDecision("reject")}
                      disabled={decisionDisabled}
                      className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-red-300/40 bg-red-500/10 px-4 text-sm font-bold text-red-100 hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <X className="h-4 w-4" />
                      Rejeitar solicitação
                    </button>
                    <Link href="/analises/fila-aprovacao" className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-white/15 px-4 text-sm font-semibold text-slate-200 hover:bg-white/[0.04]">
                      Voltar para a fila
                    </Link>
                  </div>
                ) : (
                  <div className="mt-5 rounded-xl border border-white/10 bg-[#0E1426] p-4 text-sm text-slate-300">
                    Você pode visualizar esta solicitação, mas não possui decisão pendente neste momento.
                  </div>
                )}
              </section>
            </aside>
          </div>
        </main>
      </div>

      {decisionKind ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#030712]/75 p-4" onClick={() => setDecisionKind(null)}>
          <div className="w-full max-w-[540px] rounded-2xl border border-white/10 bg-[#0B0D22] p-5 text-slate-100 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-600/25">
                {decisionKind === "approve" ? <ShieldCheck className="h-5 w-5 text-violet-100" /> : <AlertTriangle className="h-5 w-5 text-red-100" />}
              </div>
              <div>
                <h3 className="text-lg font-bold">{decisionKind === "approve" ? "Aprovar política" : "Rejeitar solicitação"}</h3>
                <p className="mt-1 text-sm text-slate-400">{safeText(summary.policy?.name, "Política Corporativa de Crédito")}</p>
              </div>
            </div>

            {decisionRoles.length > 1 ? (
              <label className="mt-5 block text-sm font-semibold text-slate-300">
                Papel decisor
                <select
                  value={effectiveRole ?? ""}
                  onChange={(event) => setSelectedRole(event.target.value)}
                  className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-[#0E1426] px-3 text-sm text-white outline-none focus:border-violet-300/40"
                >
                  {decisionRoles.map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
              </label>
            ) : null}

            <label className="mt-5 block text-sm font-semibold text-slate-300">
              Justificativa {decisionKind === "reject" ? <span className="text-red-200">*</span> : null}
              <textarea
                value={justification}
                onChange={(event) => setJustification(event.target.value)}
                rows={4}
                className="mt-2 w-full rounded-xl border border-white/10 bg-[#0E1426] px-3 py-2 text-sm text-white outline-none focus:border-violet-300/40"
                placeholder={decisionKind === "approve" ? "Comentário opcional para a aprovação..." : "Informe o motivo da rejeição..."}
              />
            </label>

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setDecisionKind(null)} className="h-10 rounded-xl border border-white/15 px-4 text-sm font-semibold text-slate-200 hover:bg-white/[0.04]">
                Cancelar
              </button>
              <button
                type="button"
                onClick={submitDecision}
                disabled={decisionMutation.isPending || rejectNeedsJustification}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-bold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {decisionMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Confirmar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
