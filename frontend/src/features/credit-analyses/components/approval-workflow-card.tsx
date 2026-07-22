"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { executeCreditAnalysisWorkflowAction, submitCreditAnalysisToCommittee } from "@/features/credit-analyses/api/credit-analyses.api";
import { CreditAnalysisApprovalFlowSummaryDto, WorkflowActionType } from "@/features/credit-analyses/api/contracts";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

type DossierDecisionAction = Extract<WorkflowActionType, "approve" | "reject" | "request_changes" | "escalate_to_committee" | "submit_approval">;
type ModalDecisionAction = Exclude<DossierDecisionAction, "approve" | "submit_approval">;

type ApprovalWorkflowController = ReturnType<typeof useApprovalWorkflowController>;

type ApprovalWorkflowCardProps = {
  analysisId: number | null;
  summary: CreditAnalysisApprovalFlowSummaryDto | null;
  availableActions: string[];
  mode?: "decision" | "readonly";
  controller: ApprovalWorkflowController;
};

type ApprovalWorkflowActionButtonsProps = {
  summary: CreditAnalysisApprovalFlowSummaryDto | null;
  availableActions: string[];
  mode?: "decision" | "readonly";
  controller: ApprovalWorkflowController;
  layout?: "inline" | "stacked";
  size?: "default" | "compact";
  className?: string;
};

type ApprovalWorkflowActionBarProps = ApprovalWorkflowActionButtonsProps & {
  analysisStatus?: string | null;
};

function formatApprovalDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function approvalStatusClass(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "approved") return "border-[#BBF7D0] bg-[#F0FDF4] text-[#166534]";
  if (normalized === "active" || normalized === "pending" || normalized === "in_committee") return "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]";
  if (normalized === "rejected" || normalized === "changes_requested") return "border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]";
  if (normalized === "skipped") return "border-[#CBD5E1] bg-[#F8FAFC] text-[#64748B]";
  return "border-[#D7E1EC] bg-white text-[#4F647A]";
}

function approvalStatusLabel(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "approved") return "Aprovado";
  if (normalized === "active") return "Etapa ativa";
  if (normalized === "in_committee") return "Em Comite";
  if (normalized === "pending") return "Aguardando etapa anterior";
  if (normalized === "rejected") return "Rejeitado";
  if (normalized === "changes_requested") return "Ajustes solicitados";
  if (normalized === "skipped") return "Substituida";
  return status;
}

function decisionLabel(decision: string) {
  if (decision === "REQUEST_CHANGES") return "Solicitacao de Ajustes";
  if (decision === "REJECTED") return "Rejeicao";
  if (decision === "ESCALATED_TO_COMMITTEE") return "Submissao ao Comite";
  if (decision === "APPROVED") return "Aprovacao";
  return decision;
}

function activeApprovalStep(summary: CreditAnalysisApprovalFlowSummaryDto | null) {
  return summary?.approval_progress?.find((step) => {
    const status = step.status.toLowerCase();
    return status === "active" || status === "in_committee";
  }) ?? null;
}

function hasDecisionActions(availableActions: string[]) {
  return ["request_changes", "escalate_to_committee", "reject", "approve"].some((action) => availableActions.includes(action));
}

export function useApprovalWorkflowController(analysisId: number | null) {
  const queryClient = useQueryClient();
  const [modalAction, setModalAction] = useState<ModalDecisionAction | null>(null);
  const [comment, setComment] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const actionMutation = useMutation({
    mutationFn: (payload: { action: DossierDecisionAction; justification?: string | null }) => {
      if (!analysisId || analysisId <= 0) {
        throw new Error("Analise ativa nao informada para decisao de aprovacao.");
      }
      return payload.action === "escalate_to_committee"
        ? submitCreditAnalysisToCommittee(analysisId, payload.justification ?? "")
        : executeCreditAnalysisWorkflowAction(analysisId, payload);
    },
    onSuccess: async () => {
      if (!analysisId || analysisId <= 0) return;
      setFeedback("Workflow de aprovacao atualizado.");
      setModalAction(null);
      setComment("");
      await queryClient.invalidateQueries({ queryKey: ["credit-analysis-detail", analysisId] });
      await queryClient.invalidateQueries({ queryKey: ["workspace-analysis-detail", analysisId] });
      await queryClient.invalidateQueries({ queryKey: ["credit-analyses-approval-queue"] });
    },
    onError: (error: Error) => setFeedback(error.message || "Nao foi possivel registrar a decisao."),
  });

  function runAction(action: DossierDecisionAction, justification?: string | null) {
    if (actionMutation.isPending) return;
    setFeedback(null);
    actionMutation.mutate({ action, justification: justification ?? null });
  }

  function openCommentAction(action: ModalDecisionAction) {
    if (actionMutation.isPending) return;
    setFeedback(null);
    setModalAction(action);
  }

  function closeModal() {
    if (actionMutation.isPending) return;
    setModalAction(null);
    setComment("");
  }

  function submitModalAction() {
    if (!modalAction || actionMutation.isPending) return;
    const trimmed = comment.trim();
    if (trimmed.length < 10) {
      setFeedback("Informe um comentario com ao menos 10 caracteres.");
      return;
    }
    runAction(modalAction, trimmed);
  }

  return {
    modalAction,
    comment,
    feedback,
    isPending: actionMutation.isPending,
    setComment,
    runAction,
    openCommentAction,
    closeModal,
    submitModalAction,
  };
}

export function ApprovalWorkflowActionButtons({
  summary,
  availableActions,
  mode = "decision",
  controller,
  layout = "inline",
  size = "default",
  className,
}: ApprovalWorkflowActionButtonsProps) {
  const canDecide = mode === "decision";
  const canApprove = canDecide && availableActions.includes("approve");
  const canReject = canDecide && availableActions.includes("reject");
  const canRequestChanges = canDecide && availableActions.includes("request_changes");
  const canEscalate = canDecide && !summary?.approval_escalated_to_committee && availableActions.includes("escalate_to_committee");
  const canSubmitApproval = canDecide && (availableActions.includes("submit_approval") || availableActions.includes("submit_for_approval"));
  const hasAnyAction = canSubmitApproval || canRequestChanges || canEscalate || canReject || canApprove;

  if (!hasAnyAction) return null;

  const compact = size === "compact";
  const buttonClass = cn(
    "min-h-10 rounded-lg font-semibold focus-visible:ring-offset-2",
    compact ? "px-3 py-2 text-[12px]" : "px-4 py-2 text-[12px]",
    layout === "stacked" ? "w-full" : "w-full sm:w-auto"
  );

  return (
    <div
      className={cn(
        layout === "stacked" ? "grid gap-2" : "grid w-full grid-cols-1 gap-2 sm:w-auto sm:grid-cols-2 xl:flex xl:flex-wrap",
        className
      )}
      aria-busy={controller.isPending}
      aria-live="polite"
    >
      {canSubmitApproval ? (
        <Button type="button" variant="default" onClick={() => controller.runAction("submit_approval")} disabled={controller.isPending} className={buttonClass}>
          {controller.isPending ? "Processando..." : "Reenviar para Aprovacao"}
        </Button>
      ) : null}
      {canRequestChanges ? (
        <Button type="button" variant="outline" onClick={() => controller.openCommentAction("request_changes")} disabled={controller.isPending} className={buttonClass}>
          Solicitar Ajustes
        </Button>
      ) : null}
      {canEscalate ? (
        <Button type="button" variant="warning" onClick={() => controller.openCommentAction("escalate_to_committee")} disabled={controller.isPending} className={buttonClass}>
          Submeter ao Comite
        </Button>
      ) : null}
      {canReject ? (
        <Button type="button" variant="destructive" onClick={() => controller.openCommentAction("reject")} disabled={controller.isPending} className={buttonClass}>
          Rejeitar
        </Button>
      ) : null}
      {canApprove ? (
        <Button type="button" variant="success" onClick={() => controller.runAction("approve")} disabled={controller.isPending} className={buttonClass}>
          {controller.isPending ? "Processando..." : "Aprovar"}
        </Button>
      ) : null}
    </div>
  );
}

export function ApprovalWorkflowActionBar({ summary, availableActions, mode = "decision", controller, analysisStatus }: ApprovalWorkflowActionBarProps) {
  const activeStep = activeApprovalStep(summary);
  const flowState = summary?.flow_state ?? summary?.approval_flow_state;
  const shouldRender =
    analysisStatus === "in_approval" &&
    flowState === "in_approval" &&
    Boolean(activeStep || summary?.current_approval_step) &&
    mode === "decision" &&
    hasDecisionActions(availableActions);

  if (!shouldRender) return null;

  const stepLabel = activeStep?.role_label ?? summary?.current_approval_step ?? "Etapa ativa";
  const doaLabel = summary?.applicable_doa_code ?? summary?.predicted_doa_code ?? "DOA a definir";
  const roundLabel = `Rodada ${summary?.approval_round ?? activeStep?.round_number ?? 1}`;

  return (
    <section className="mt-4 rounded-[18px] border border-[#D7E1EC] bg-white px-4 py-4 shadow-[0_10px_24px_rgba(10,29,64,.055)] lg:px-5" aria-label="Acoes de aprovacao do dossie">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#64748B]">Decisao necessaria</p>
          <h3 className="mt-1 text-[18px] font-semibold leading-tight text-[#102033]">{stepLabel}</h3>
          <p className="mt-1 text-[12px] font-medium text-[#4F647A]">{doaLabel} - {roundLabel}</p>
        </div>
        <ApprovalWorkflowActionButtons
          summary={summary}
          availableActions={availableActions}
          mode={mode}
          controller={controller}
          size="compact"
          className="xl:justify-end"
        />
      </div>
    </section>
  );
}

export function ApprovalWorkflowCard({ analysisId, summary, availableActions, mode = "decision", controller }: ApprovalWorkflowCardProps) {
  const progress = summary?.approval_progress?.length ? summary.approval_progress : [];
  const comments = summary?.decision_comments ?? [];
  void analysisId;

  return (
    <section className="rounded-[18px] border border-[#D7E1EC] bg-white p-5 shadow-[0_10px_24px_rgba(10,29,64,.06)]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#4F647A]">Workflow de Aprovacao</div>
          <h2 className="mt-1 text-[20px] font-semibold text-[#102033]">{summary?.display_status ?? "Aguardando aprovacao"}</h2>
          <p className="mt-1 text-[13px] text-[#4F647A]">{summary?.display_message ?? "O fluxo sera exibido apos envio para aprovacao."}</p>
        </div>
        {summary?.approval_escalated_to_committee ? <span className="rounded-full border border-[#FDE68A] bg-[#FFFBEB] px-3 py-1 text-[12px] font-semibold text-[#92400E]">Em Comite</span> : null}
      </div>

      <div className="mb-5 grid gap-3 md:grid-cols-4">
        <div className="rounded-[12px] border border-[#E6ECF2] bg-[#F8FAFC] p-3"><p className="text-[11px] text-[#4F647A]">DOA Aplicavel</p><p className="mt-1 text-[14px] font-semibold text-[#102033]">{summary?.applicable_doa_code ?? summary?.predicted_doa_code ?? "A definir"}</p></div>
        <div className="rounded-[12px] border border-[#E6ECF2] bg-[#F8FAFC] p-3"><p className="text-[11px] text-[#4F647A]">Etapa Atual</p><p className="mt-1 text-[14px] font-semibold text-[#102033]">{summary?.current_approval_step ?? "Sem etapa ativa"}</p></div>
        <div className="rounded-[12px] border border-[#E6ECF2] bg-[#F8FAFC] p-3"><p className="text-[11px] text-[#4F647A]">Tempo em Aprovacao</p><p className="mt-1 text-[14px] font-semibold text-[#102033]">{summary?.approval_sla_label ?? "-"}</p></div>
        <div className="rounded-[12px] border border-[#E6ECF2] bg-[#F8FAFC] p-3"><p className="text-[11px] text-[#4F647A]">Rodada</p><p className="mt-1 text-[14px] font-semibold text-[#102033]">Rodada {summary?.approval_round ?? 1}</p></div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div>
          <p className="mb-2 text-[12px] font-semibold text-[#102033]">Timeline de Aprovacao</p>
          <div className="space-y-2">
            {progress.length ? progress.map((step, index) => (
              <div key={`${step.role_code ?? step.role_label}-${index}`} className="flex gap-3 rounded-[12px] border border-[#E6ECF2] bg-[#FBFCFE] p-3">
                <span className={`mt-0.5 inline-flex h-7 min-w-7 items-center justify-center rounded-full border text-[12px] font-bold ${approvalStatusClass(step.status)}`}>{step.status.toLowerCase() === "approved" ? "OK" : (step.status.toLowerCase() === "active" || step.status.toLowerCase() === "in_committee") ? "!" : "-"}</span>
                <div><p className="text-[13px] font-semibold text-[#102033]">{step.role_label}</p><p className="text-[12px] text-[#4F647A]">{approvalStatusLabel(step.status)}{step.actor_name ? ` por ${step.actor_name}` : ""}</p>{step.decided_at ? <p className="text-[11px] text-[#66788A]">{formatApprovalDate(step.decided_at)}</p> : null}</div>
              </div>
            )) : <div className="rounded-[12px] border border-dashed border-[#D7E1EC] p-4 text-[13px] text-[#4F647A]">Sem etapas persistidas para esta analise.</div>}
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <p className="mb-2 text-[12px] font-semibold text-[#102033]">Comentarios dos Aprovadores</p>
            {comments.length ? comments.map((item, index) => (
              <div key={`${item.decision}-${index}`} className="mb-2 rounded-[12px] border border-[#E6ECF2] bg-[#F8FAFC] p-3">
                <p className="text-[12px] font-semibold text-[#102033]">{decisionLabel(item.decision)}</p>
                <p className="text-[11px] text-[#4F647A]">{item.actor_name ?? item.role_label} - {formatApprovalDate(item.created_at) ?? "Data nao informada"}</p>
                <p className="mt-2 text-[12px] text-[#102033]">{item.comment}</p>
              </div>
            )) : <p className="rounded-[12px] border border-dashed border-[#D7E1EC] p-3 text-[12px] text-[#4F647A]">Nenhum comentario registrado.</p>}
          </div>
          {summary?.committee_escalation ? <div className="rounded-[12px] border border-[#FDE68A] bg-[#FFFBEB] p-3"><p className="text-[12px] font-semibold text-[#92400E]">Submetido ao Comite</p><p className="mt-1 text-[11px] text-[#92400E]">{formatApprovalDate(summary.committee_escalation.created_at) ?? "Data nao informada"}</p><p className="mt-2 text-[12px] text-[#78350F]">{summary.committee_escalation.comment ?? "Sem motivo informado."}</p></div> : null}
        </div>
      </div>

      {summary?.approval_rounds?.length ? <div className="mt-5 border-t border-[#E6ECF2] pt-4"><p className="mb-2 text-[12px] font-semibold text-[#102033]">Historico de Rodadas</p><div className="grid gap-2 md:grid-cols-2">{summary.approval_rounds.map((round) => <div key={round.round_number} className="rounded-[12px] border border-[#E6ECF2] bg-[#FBFCFE] p-3"><p className="text-[12px] font-semibold text-[#102033]">Rodada {round.round_number}</p><div className="mt-2 space-y-1">{round.steps.map((step, index) => <p key={`${step.role_code ?? step.role_label}-${index}`} className="text-[12px] text-[#4F647A]">{approvalStatusLabel(step.status)} - {step.role_label}</p>)}</div></div>)}</div></div> : null}

      {mode === "decision" ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#E6ECF2] pt-4">
          <p className="text-[12px] text-[#4F647A]">As decisoes sao registradas no Dossie Executivo e seguem a etapa ativa da DOA.</p>
          <ApprovalWorkflowActionButtons summary={summary} availableActions={availableActions} mode={mode} controller={controller} layout="inline" />
        </div>
      ) : null}
      {controller.feedback ? <div className="mt-3 rounded-[10px] border border-[#D7E1EC] bg-[#F8FAFC] px-3 py-2 text-[12px] text-[#102033]">{controller.feedback}</div> : null}
      {controller.modalAction ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#0D1B2A]/55 p-4" onClick={controller.closeModal}>
          <div className="w-full max-w-[560px] rounded-[14px] border border-[#D7E1EC] bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <h3 className="text-[20px] font-semibold text-[#102033]">{controller.modalAction === "reject" ? "Rejeitar analise" : controller.modalAction === "escalate_to_committee" ? "Submeter ao Comite" : "Solicitar ajustes"}</h3>
            <textarea value={controller.comment} onChange={(event) => controller.setComment(event.target.value)} rows={5} className="mt-4 w-full rounded-[10px] border border-[#D7E1EC] px-3 py-2 text-[12px] text-[#102033] outline-none focus:border-[#94A3B8]" placeholder={controller.modalAction === "escalate_to_committee" ? "Explique por que esta operacao deve ser analisada pelo Comite de Credito." : "Descreva a justificativa..."} />
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={controller.closeModal} disabled={controller.isPending} className="h-9 rounded-[10px] px-3 text-[12px] font-medium">Cancelar</Button>
              <Button type="button" variant="default" onClick={controller.submitModalAction} disabled={controller.isPending} className="h-9 rounded-[10px] px-3 text-[12px] font-medium">{controller.isPending ? "Processando..." : controller.modalAction === "escalate_to_committee" ? "Submeter ao Comite" : "Confirmar"}</Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
