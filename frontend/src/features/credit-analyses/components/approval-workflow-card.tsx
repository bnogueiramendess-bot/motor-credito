"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { executeCreditAnalysisWorkflowAction } from "@/features/credit-analyses/api/credit-analyses.api";
import { CreditAnalysisApprovalFlowSummaryDto, WorkflowActionType } from "@/features/credit-analyses/api/contracts";

type DossierDecisionAction = Extract<WorkflowActionType, "approve" | "reject" | "request_changes" | "escalate_to_committee" | "submit_approval">;

type ApprovalWorkflowCardProps = {
  analysisId: number;
  summary: CreditAnalysisApprovalFlowSummaryDto | null;
  availableActions: string[];
  mode?: "decision" | "readonly";
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
  if (normalized === "active" || normalized === "pending") return "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]";
  if (normalized === "rejected" || normalized === "changes_requested") return "border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]";
  if (normalized === "skipped") return "border-[#CBD5E1] bg-[#F8FAFC] text-[#64748B]";
  return "border-[#D7E1EC] bg-white text-[#4F647A]";
}

function approvalStatusLabel(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "approved") return "Aprovado";
  if (normalized === "active") return "Etapa ativa";
  if (normalized === "pending") return "Aguardando etapa anterior";
  if (normalized === "rejected") return "Rejeitado";
  if (normalized === "changes_requested") return "Ajustes solicitados";
  if (normalized === "skipped") return "Substituída";
  return status;
}

function decisionLabel(decision: string) {
  if (decision === "REQUEST_CHANGES") return "Solicitação de Ajustes";
  if (decision === "REJECTED") return "Rejeição";
  if (decision === "ESCALATED_TO_COMMITTEE") return "Direcionamento ao Comitê";
  if (decision === "APPROVED") return "Aprovação";
  return decision;
}

export function ApprovalWorkflowCard({ analysisId, summary, availableActions, mode = "decision" }: ApprovalWorkflowCardProps) {
  const queryClient = useQueryClient();
  const [modalAction, setModalAction] = useState<Exclude<DossierDecisionAction, "approve" | "submit_approval"> | null>(null);
  const [comment, setComment] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const actionMutation = useMutation({
    mutationFn: (payload: { action: DossierDecisionAction; justification?: string | null }) =>
      executeCreditAnalysisWorkflowAction(analysisId, payload),
    onSuccess: async () => {
      setFeedback("Workflow de aprovação atualizado.");
      setModalAction(null);
      setComment("");
      await queryClient.invalidateQueries({ queryKey: ["credit-analysis-detail", analysisId] });
      await queryClient.invalidateQueries({ queryKey: ["workspace-analysis-detail", analysisId] });
      await queryClient.invalidateQueries({ queryKey: ["credit-analyses-approval-queue"] });
    },
    onError: (error: Error) => setFeedback(error.message || "Não foi possível registrar a decisão."),
  });

  const progress = summary?.approval_progress?.length ? summary.approval_progress : [];
  const comments = summary?.decision_comments ?? [];
  const canDecide = mode === "decision";
  const canApprove = canDecide && availableActions.includes("approve");
  const canReject = canDecide && availableActions.includes("reject");
  const canRequestChanges = canDecide && availableActions.includes("request_changes");
  const canEscalate = canDecide && availableActions.includes("escalate_to_committee");
  const canSubmitApproval = canDecide && (availableActions.includes("submit_approval") || availableActions.includes("submit_for_approval"));

  function runAction(action: DossierDecisionAction, justification?: string | null) {
    actionMutation.mutate({ action, justification: justification ?? null });
  }

  function submitModalAction() {
    if (!modalAction) return;
    const trimmed = comment.trim();
    if (trimmed.length < 10) {
      setFeedback("Informe um comentário com ao menos 10 caracteres.");
      return;
    }
    runAction(modalAction, trimmed);
  }

  return (
    <section className="rounded-[18px] border border-[#D7E1EC] bg-white p-5 shadow-[0_10px_24px_rgba(10,29,64,.06)]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#4F647A]">Workflow de Aprovação</div>
          <h2 className="mt-1 text-[20px] font-semibold text-[#102033]">{summary?.display_status ?? "Aguardando aprovação"}</h2>
          <p className="mt-1 text-[13px] text-[#4F647A]">{summary?.display_message ?? "O fluxo será exibido após envio para aprovação."}</p>
        </div>
        {summary?.approval_escalated_to_committee ? <span className="rounded-full border border-[#FDE68A] bg-[#FFFBEB] px-3 py-1 text-[12px] font-semibold text-[#92400E]">Comitê Obrigatório</span> : null}
      </div>

      <div className="mb-5 grid gap-3 md:grid-cols-4">
        <div className="rounded-[12px] border border-[#E6ECF2] bg-[#F8FAFC] p-3"><p className="text-[11px] text-[#4F647A]">DOA Aplicável</p><p className="mt-1 text-[14px] font-semibold text-[#102033]">{summary?.applicable_doa_code ?? summary?.predicted_doa_code ?? "A definir"}</p></div>
        <div className="rounded-[12px] border border-[#E6ECF2] bg-[#F8FAFC] p-3"><p className="text-[11px] text-[#4F647A]">Etapa Atual</p><p className="mt-1 text-[14px] font-semibold text-[#102033]">{summary?.current_approval_step ?? "Sem etapa ativa"}</p></div>
        <div className="rounded-[12px] border border-[#E6ECF2] bg-[#F8FAFC] p-3"><p className="text-[11px] text-[#4F647A]">Tempo em Aprovação</p><p className="mt-1 text-[14px] font-semibold text-[#102033]">{summary?.approval_sla_label ?? "-"}</p></div>
        <div className="rounded-[12px] border border-[#E6ECF2] bg-[#F8FAFC] p-3"><p className="text-[11px] text-[#4F647A]">Rodada</p><p className="mt-1 text-[14px] font-semibold text-[#102033]">Rodada {summary?.approval_round ?? 1}</p></div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div>
          <p className="mb-2 text-[12px] font-semibold text-[#102033]">Timeline de Aprovação</p>
          <div className="space-y-2">
            {progress.length ? progress.map((step, index) => (
              <div key={`${step.role_code ?? step.role_label}-${index}`} className="flex gap-3 rounded-[12px] border border-[#E6ECF2] bg-[#FBFCFE] p-3">
                <span className={`mt-0.5 inline-flex h-7 min-w-7 items-center justify-center rounded-full border text-[12px] font-bold ${approvalStatusClass(step.status)}`}>{step.status.toLowerCase() === "approved" ? "✓" : step.status.toLowerCase() === "active" ? "⏳" : "○"}</span>
                <div><p className="text-[13px] font-semibold text-[#102033]">{step.role_label}</p><p className="text-[12px] text-[#4F647A]">{approvalStatusLabel(step.status)}{step.actor_name ? ` por ${step.actor_name}` : ""}</p>{step.decided_at ? <p className="text-[11px] text-[#66788A]">{formatApprovalDate(step.decided_at)}</p> : null}</div>
              </div>
            )) : <div className="rounded-[12px] border border-dashed border-[#D7E1EC] p-4 text-[13px] text-[#4F647A]">Sem etapas persistidas para esta análise.</div>}
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <p className="mb-2 text-[12px] font-semibold text-[#102033]">Comentários dos Aprovadores</p>
            {comments.length ? comments.map((item, index) => (
              <div key={`${item.decision}-${index}`} className="mb-2 rounded-[12px] border border-[#E6ECF2] bg-[#F8FAFC] p-3">
                <p className="text-[12px] font-semibold text-[#102033]">{decisionLabel(item.decision)}</p>
                <p className="text-[11px] text-[#4F647A]">{item.actor_name ?? item.role_label} · {formatApprovalDate(item.created_at) ?? "Data não informada"}</p>
                <p className="mt-2 text-[12px] text-[#102033]">{item.comment}</p>
              </div>
            )) : <p className="rounded-[12px] border border-dashed border-[#D7E1EC] p-3 text-[12px] text-[#4F647A]">Nenhum comentário registrado.</p>}
          </div>
          {summary?.committee_escalation ? <div className="rounded-[12px] border border-[#FDE68A] bg-[#FFFBEB] p-3"><p className="text-[12px] font-semibold text-[#92400E]">Encaminhado ao Comitê de Crédito</p><p className="mt-1 text-[11px] text-[#92400E]">{formatApprovalDate(summary.committee_escalation.created_at) ?? "Data não informada"}</p><p className="mt-2 text-[12px] text-[#78350F]">{summary.committee_escalation.comment ?? "Sem motivo informado."}</p></div> : null}
        </div>
      </div>

      {summary?.approval_rounds?.length ? <div className="mt-5 border-t border-[#E6ECF2] pt-4"><p className="mb-2 text-[12px] font-semibold text-[#102033]">Histórico de Rodadas</p><div className="grid gap-2 md:grid-cols-2">{summary.approval_rounds.map((round) => <div key={round.round_number} className="rounded-[12px] border border-[#E6ECF2] bg-[#FBFCFE] p-3"><p className="text-[12px] font-semibold text-[#102033]">Rodada {round.round_number}</p><div className="mt-2 space-y-1">{round.steps.map((step, index) => <p key={`${step.role_code ?? step.role_label}-${index}`} className="text-[12px] text-[#4F647A]">{approvalStatusLabel(step.status)} · {step.role_label}</p>)}</div></div>)}</div></div> : null}

      {canDecide ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#E6ECF2] pt-4">
          <p className="text-[12px] text-[#4F647A]">As decisões são registradas no Dossiê Executivo e seguem a etapa ativa da DOA.</p>
          <div className="flex flex-wrap gap-2">
            {canSubmitApproval ? <button type="button" onClick={() => runAction("submit_approval")} disabled={actionMutation.isPending} className="rounded-lg bg-[#102033] px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-50">Reenviar para Aprovação</button> : null}
            {canRequestChanges ? <button type="button" onClick={() => setModalAction("request_changes")} disabled={actionMutation.isPending} className="rounded-lg bg-[#6B7280] px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-50">Solicitar Ajustes</button> : null}
            {canEscalate ? <button type="button" onClick={() => setModalAction("escalate_to_committee")} disabled={actionMutation.isPending} className="rounded-lg bg-[#92400E] px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-50">Direcionar para Comitê</button> : null}
            {canReject ? <button type="button" onClick={() => setModalAction("reject")} disabled={actionMutation.isPending} className="rounded-lg bg-[#C0392B] px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-50">Rejeitar</button> : null}
            {canApprove ? <button type="button" onClick={() => runAction("approve")} disabled={actionMutation.isPending} className="rounded-lg bg-[#E8B83A] px-4 py-2 text-[12px] font-semibold text-[#102033] disabled:opacity-50">Aprovar</button> : null}
          </div>
        </div>
      ) : null}
      {feedback ? <div className="mt-3 rounded-[10px] border border-[#D7E1EC] bg-[#F8FAFC] px-3 py-2 text-[12px] text-[#102033]">{feedback}</div> : null}
      {modalAction ? <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#0D1B2A]/55 p-4" onClick={() => setModalAction(null)}><div className="w-full max-w-[560px] rounded-[14px] border border-[#D7E1EC] bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}><h3 className="text-[20px] font-semibold text-[#102033]">{modalAction === "reject" ? "Rejeitar análise" : modalAction === "escalate_to_committee" ? "Direcionar para Comitê" : "Solicitar ajustes"}</h3><textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={5} className="mt-4 w-full rounded-[10px] border border-[#D7E1EC] px-3 py-2 text-[12px] text-[#102033] outline-none focus:border-[#94A3B8]" placeholder="Descreva a justificativa..." /><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setModalAction(null)} className="h-9 rounded-[10px] border border-[#D7E1EC] bg-white px-3 text-[12px] font-medium text-[#475569]">Cancelar</button><button type="button" onClick={submitModalAction} disabled={actionMutation.isPending} className="h-9 rounded-[10px] bg-[#334155] px-3 text-[12px] font-medium text-white disabled:opacity-50">Confirmar</button></div></div></div> : null}
    </section>
  );
}
