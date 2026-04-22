import {
  CreditAnalysisDto,
  DecisionEventDto,
  DecisionMemoryDto,
  ExplainabilityRuleItemDto,
  FinalDecision,
  MotorResult,
  ScoreCalculationMemoryDto,
  ScoreResultDto
} from "@/features/credit-analyses/api/contracts";
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

export type ExplainabilitySummaryView = {
  policyLabel: string;
  evaluatedRules: number;
  matchedRules: number;
  notMatchedRules: number;
  totalImpactPoints: number;
  executiveReason: string;
};

export type ExplainabilityRuleRowView = {
  id: string;
  label: string;
  pillarLabel: string;
  expectedValueLabel: string;
  actualValueLabel: string;
  statusLabel: string;
  impactLabel: string;
  tone: UiTone;
  reason: string;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseScoreMemory(memory: Record<string, unknown> | null): ScoreCalculationMemoryDto | null {
  if (!memory) {
    return null;
  }
  return memory as unknown as ScoreCalculationMemoryDto;
}

function parseDecisionMemory(memory: Record<string, unknown> | null): DecisionMemoryDto | null {
  if (!memory) {
    return null;
  }
  return memory as unknown as DecisionMemoryDto;
}

function normalizeRuleItem(item: unknown): ExplainabilityRuleItemDto | null {
  const record = asObject(item);
  if (!record) {
    return null;
  }

  if (typeof record.label !== "string" || typeof record.reason !== "string" || typeof record.impact_type !== "string") {
    return null;
  }

  return {
    rule_id: typeof record.rule_id === "number" ? record.rule_id : null,
    label: record.label,
    pillar: typeof record.pillar === "string" ? record.pillar : null,
    score_band: typeof record.score_band === "string" ? (record.score_band as ExplainabilityRuleItemDto["score_band"]) : null,
    field: typeof record.field === "string" ? record.field : null,
    operator: typeof record.operator === "string" ? record.operator : null,
    expected_value: record.expected_value,
    actual_value: record.actual_value,
    matched: Boolean(record.matched),
    impact_points: typeof record.impact_points === "number" ? record.impact_points : 0,
    impact_type: record.impact_type,
    reason: record.reason
  };
}

function pillarLabel(pillar: string | null) {
  if (pillar === "externalRisk") return "Risco externo";
  if (pillar === "legal") return "Jurídico";
  if (pillar === "internalHistory") return "Histórico interno";
  if (pillar === "financialCapacity") return "Capacidade financeira";
  return "Condição derivada";
}

function formatAnyValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  if (typeof value === "boolean") {
    return value ? "Sim" : "Não";
  }

  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(".", ",");
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

function rowTone(matched: boolean): UiTone {
  return matched ? "success" : "warning";
}

function toRuleRow(item: ExplainabilityRuleItemDto): ExplainabilityRuleRowView {
  const impactPoints = item.impact_points ?? 0;
  return {
    id: item.rule_id !== null ? String(item.rule_id) : `${item.label}-${item.reason}`,
    label: item.label,
    pillarLabel: pillarLabel(item.pillar),
    expectedValueLabel: formatAnyValue(item.expected_value),
    actualValueLabel: formatAnyValue(item.actual_value),
    statusLabel: item.matched ? "Atendida" : "Não atendida",
    impactLabel: impactPoints === 0 ? "Sem impacto direto" : `${impactPoints > 0 ? "+" : ""}${impactPoints} pontos`,
    tone: rowTone(item.matched),
    reason: item.reason
  };
}

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

export function decisionPill(decision: FinalDecision | MotorResult | null): { label: string; tone: UiTone } {
  if (decision === "approved") {
    return { label: "Aprovado", tone: "success" };
  }
  if (decision === "rejected") {
    return { label: "Reprovado", tone: "danger" };
  }
  if (decision === "manual_review") {
    return { label: "Revisão manual", tone: "warning" };
  }

  return { label: "Pendente", tone: "neutral" };
}

function reasonLabel(reason: string): RuleSignal | null {
  switch (reason) {
    case "score_band_d":
      return {
        id: reason,
        text: "Score na faixa D detectado pelo motor.",
        status: "BLOQUEIO",
        tone: "danger"
      };
    case "active_restrictions_detected":
      return {
        id: reason,
        text: "Restrições ativas em órgãos de crédito.",
        status: "BLOQUEIO",
        tone: "danger"
      };
    case "approved_by_band_a_and_low_indebtedness":
      return {
        id: reason,
        text: "Score elevado com endividamento dentro da política.",
        status: "ATENDE",
        tone: "success"
      };
    case "manual_review_required_by_policy":
      return {
        id: reason,
        text: "Política exigiu revisão manual para esta combinação de critérios.",
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

function parseExplainabilityRuleRows(memory: Record<string, unknown> | null): ExplainabilityRuleRowView[] {
  const scoreMemory = parseScoreMemory(memory);
  const scoreExplainability = asObject(scoreMemory?.explainability);
  const scoreRulesRaw = scoreExplainability?.rules_evaluated;
  if (!Array.isArray(scoreRulesRaw)) {
    return [];
  }

  return scoreRulesRaw.map(normalizeRuleItem).filter((item): item is ExplainabilityRuleItemDto => item !== null).map(toRuleRow);
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

  const explainabilityRows = parseExplainabilityRuleRows(score?.calculation_memory_json ?? null);
  if (explainabilityRows.length) {
    const matchedCount = explainabilityRows.filter((item) => item.statusLabel === "Atendida").length;
    items.push({
      id: "explainability-summary",
      text: `${explainabilityRows.length} regras avaliadas no score (${matchedCount} atendidas).`,
      status: "EXPLICAÇÃO",
      tone: "info"
    });
  }

  const finalScore = toNumber(score?.final_score) ?? 0;
  if (score) {
    items.push({
      id: "score-track",
      text: `Score calculado em ${finalScore} (${score.score_band}).`,
      status: finalScore >= 600 ? "ATENDE" : "RISCO",
      tone: finalScore >= 600 ? "success" : "warning"
    });
  }

  const requested = toNumber(analysis.requested_limit);
  const suggested = toNumber(analysis.suggested_limit);
  if (requested !== null && suggested !== null && requested > suggested) {
    items.push({
      id: "limit-adjust",
      text: `Limite ajustado de ${formatCurrency(requested)} para ${formatCurrency(suggested)}.`,
      status: "AJUSTE",
      tone: "warning"
    });
  }

  if (analysis.analysis_status === "completed") {
    items.push({
      id: "completed",
      text: "Análise finalizada e registrada no histórico.",
      status: "ATENDE",
      tone: "success"
    });
  }

  if (!items.length) {
    items.push({
      id: "fallback",
      text: "Sem sinais estruturados de explicabilidade para esta análise.",
      status: "INFO",
      tone: "neutral"
    });
  }

  return items.slice(0, 6);
}

export function buildExplainabilitySummary({
  score,
  decisionMemory
}: {
  score: ScoreResultDto | null;
  decisionMemory: Record<string, unknown> | null;
}): ExplainabilitySummaryView | null {
  const parsedDecisionMemory = parseDecisionMemory(decisionMemory);
  const decisionExplainability = asObject(parsedDecisionMemory?.explainability);
  const decisionSummary = asObject(decisionExplainability?.decision_summary);

  const scoreMemory = parseScoreMemory(score?.calculation_memory_json ?? null);
  const scoreExplainability = asObject(scoreMemory?.explainability);
  const scoreSummary = asObject(scoreExplainability?.score_summary);
  const policy = asObject(scoreExplainability?.policy) ?? asObject(decisionExplainability?.policy);

  if (!scoreSummary || !decisionSummary || !policy) {
    return null;
  }

  return {
    policyLabel: `${String(policy.policy_name)} (v${String(policy.policy_version)})`,
    evaluatedRules: Number(scoreSummary.evaluated_rules ?? 0),
    matchedRules: Number(scoreSummary.matched_rules ?? 0),
    notMatchedRules: Number(scoreSummary.not_matched_rules ?? 0),
    totalImpactPoints: Number(scoreSummary.total_impact_points ?? 0),
    executiveReason: String(decisionSummary.executive_reason ?? "Sem justificativa executiva disponível.")
  };
}

export function buildExplainabilityRuleRows({
  score,
  decisionMemory
}: {
  score: ScoreResultDto | null;
  decisionMemory: Record<string, unknown> | null;
}): ExplainabilityRuleRowView[] {
  const scoreRows = parseExplainabilityRuleRows(score?.calculation_memory_json ?? null);

  const parsedDecisionMemory = parseDecisionMemory(decisionMemory);
  const decisionExplainability = asObject(parsedDecisionMemory?.explainability);
  const decisionRulesRaw = decisionExplainability?.rules_evaluated;
  const decisionRows = Array.isArray(decisionRulesRaw)
    ? decisionRulesRaw.map(normalizeRuleItem).filter((item): item is ExplainabilityRuleItemDto => item !== null).map(toRuleRow)
    : [];

  return [...scoreRows, ...decisionRows];
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
