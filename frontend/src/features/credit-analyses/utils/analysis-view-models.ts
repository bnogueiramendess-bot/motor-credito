import { CreditAnalysisDto, DecisionEventDto, FinalDecision, MotorResult, ScoreResultDto } from "@/features/credit-analyses/api/contracts";
import { formatCurrency, formatDateTime, toNumber } from "@/features/credit-analyses/utils/formatters";

type UiTone = "success" | "warning" | "danger" | "info" | "neutral";

export type RuleSignal = {
  id: string;
  text: string;
  status: string;
  tone: UiTone;
};

export type Milestone = {
  id: string;
  title: string;
  meta: string;
  tone: UiTone;
};

export function getInitials(name: string | null | undefined): string {
  if (!name) {
    return "--";
  }

  const parts = name
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2);

  if (!parts.length) {
    return "--";
  }

  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}

export function resolveDecision(finalDecision: FinalDecision | null, motorResult: MotorResult | null) {
  return finalDecision ?? motorResult;
}

export function decisionPill(decision: FinalDecision | MotorResult | null): {
  label: string;
  tone: UiTone;
} {
  if (decision === "approved") {
    return { label: "Aprovado", tone: "success" };
  }
  if (decision === "rejected") {
    return { label: "Reprovado", tone: "danger" };
  }
  if (decision === "manual_review") {
    return { label: "Aprovado com condição", tone: "warning" };
  }

  return { label: "Pendente", tone: "neutral" };
}

function reasonLabel(reason: string): RuleSignal | null {
  switch (reason) {
    case "score_band_d":
      return {
        id: reason,
        text: "Score na faixa D detectado pelo motor",
        status: "BLOQUEIO",
        tone: "danger"
      };
    case "active_restrictions_detected":
      return {
        id: reason,
        text: "Restrições ativas em órgãos de crédito",
        status: "BLOQUEIO",
        tone: "danger"
      };
    case "approved_by_band_a_and_low_indebtedness":
      return {
        id: reason,
        text: "Score elevado com baixo endividamento",
        status: "PASSOU",
        tone: "success"
      };
    case "manual_review_required_by_policy":
      return {
        id: reason,
        text: "Política interna exigiu revisão manual",
        status: "ATENÇÃO",
        tone: "warning"
      };
    default:
      return null;
  }
}

function parseReasonSignals(memory: Record<string, unknown> | null): RuleSignal[] {
  if (!memory) {
    return [];
  }

  const reasons = memory.reasons;
  if (!Array.isArray(reasons)) {
    return [];
  }

  return reasons
    .map((reason) => (typeof reason === "string" ? reasonLabel(reason) : null))
    .filter((item): item is RuleSignal => item !== null);
}

export function buildRuleSignals({
  analysis,
  score,
  memory
}: {
  analysis: CreditAnalysisDto;
  score: ScoreResultDto | null;
  memory: Record<string, unknown> | null;
}): RuleSignal[] {
  const items: RuleSignal[] = [...parseReasonSignals(memory)];

  const finalScore = score?.final_score ?? 0;
  if (score) {
    items.push({
      id: "score-track",
      text: `Score calculado em ${finalScore} (${score.score_band})`,
      status: finalScore >= 600 ? "PASSOU" : "RISCO",
      tone: finalScore >= 600 ? "success" : "warning"
    });
  }

  const requested = toNumber(analysis.requested_limit);
  const suggested = toNumber(analysis.suggested_limit);
  if (requested !== null && suggested !== null && requested > suggested) {
    items.push({
      id: "limit-adjust",
      text: `Limite ajustado de ${formatCurrency(requested)} para ${formatCurrency(suggested)}`,
      status: "AJUSTE",
      tone: "warning"
    });
  }

  if (analysis.analysis_status === "completed") {
    items.push({
      id: "completed",
      text: "Análise finalizada e registrada no histórico",
      status: "PASSOU",
      tone: "success"
    });
  }

  if (!items.length) {
    items.push({
      id: "fallback",
      text: "Sem regras explícitas retornadas para esta análise",
      status: "INFO",
      tone: "neutral"
    });
  }

  return items.slice(0, 6);
}

export function buildMilestones({
  analysis,
  events
}: {
  analysis: CreditAnalysisDto;
  events: DecisionEventDto[];
}): Milestone[] {
  if (events.length) {
    return events.slice(0, 6).map((event) => ({
      id: String(event.id),
      title: event.description,
      meta: `${formatDateTime(event.created_at)} · ${event.actor_name}`,
      tone: event.actor_type === "system" ? "info" : "success"
    }));
  }

  const timeline: Milestone[] = [
    {
      id: "created",
      title: "Análise iniciada",
      meta: formatDateTime(analysis.created_at),
      tone: "info"
    }
  ];

  if (analysis.decision_calculated_at) {
    timeline.push({
      id: "motor",
      title: "Decisão do motor calculada",
      meta: formatDateTime(analysis.decision_calculated_at),
      tone: "warning"
    });
  }

  if (analysis.completed_at) {
    timeline.push({
      id: "completed",
      title: "Decisão final registrada",
      meta: formatDateTime(analysis.completed_at),
      tone: "success"
    });
  }

  return timeline;
}

export function toneStyles(tone: UiTone) {
  switch (tone) {
    case "success":
      return {
        badge: "bg-[#d1fae5] text-[#065f46]",
        dot: "bg-[#059669]",
        icon: "bg-[#d1fae5] text-[#065f46]"
      };
    case "warning":
      return {
        badge: "bg-[#fef3c7] text-[#92400e]",
        dot: "bg-[#d97706]",
        icon: "bg-[#fef3c7] text-[#92400e]"
      };
    case "danger":
      return {
        badge: "bg-[#fee2e2] text-[#991b1b]",
        dot: "bg-[#dc2626]",
        icon: "bg-[#fee2e2] text-[#991b1b]"
      };
    case "info":
      return {
        badge: "bg-[#dbeafe] text-[#1e40af]",
        dot: "bg-[#3b82f6]",
        icon: "bg-[#dbeafe] text-[#1e40af]"
      };
    default:
      return {
        badge: "bg-[#f3f4f6] text-[#6b7280]",
        dot: "bg-[#9ca3af]",
        icon: "bg-[#f3f4f6] text-[#6b7280]"
      };
  }
}
