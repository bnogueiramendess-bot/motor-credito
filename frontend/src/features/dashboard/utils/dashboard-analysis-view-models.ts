import { CreditAnalysisListItemDto, FinalDecision, MotorResult } from "@/features/credit-analyses/api/contracts";
import { toNumber } from "@/features/credit-analyses/utils/formatters";
import { resolveDecision } from "@/features/credit-analyses/utils/analysis-view-models";
import { formatCurrencyInThousands } from "@/features/dashboard/utils/dashboard-formatters";

export type DashboardCardStatusTone = "success" | "warning" | "danger";
export type DashboardScoreTone = "positive" | "good" | "warning" | "danger" | "neutral";
export type DashboardDecisionGroup = "pending" | "rejected" | "approved";

export type DashboardAnalysisCardViewModel = {
  id: number;
  companyName: string;
  documentNumber: string;
  statusLabel: string;
  statusTone: DashboardCardStatusTone;
  statusGroup: DashboardDecisionGroup;
  scoreLabel: string;
  scoreTone: DashboardScoreTone;
  scoreBand: "A" | "B" | "C" | "D" | null;
  limitLabel: string;
};

type StatusUi = {
  label: string;
  tone: DashboardCardStatusTone;
  group: DashboardDecisionGroup;
  priority: number;
};

function resolveStatus(decision: FinalDecision | MotorResult | null): StatusUi {
  if (decision === "approved") {
    return { label: "Aprovado", tone: "success", group: "approved", priority: 2 };
  }
  if (decision === "rejected") {
    return { label: "Recusado", tone: "danger", group: "rejected", priority: 1 };
  }

  return { label: "Pendente", tone: "warning", group: "pending", priority: 0 };
}

function resolveScore(item: CreditAnalysisListItemDto): {
  label: string;
  tone: DashboardScoreTone;
  band: "A" | "B" | "C" | "D" | null;
} {
  const band = item.score?.score_band ?? null;
  if (band === "A") {
    return { label: "A", tone: "positive", band };
  }
  if (band === "B") {
    return { label: "B", tone: "good", band };
  }
  if (band === "C") {
    return { label: "C", tone: "warning", band };
  }
  if (band === "D") {
    return { label: "D", tone: "danger", band };
  }

  const finalScore = toNumber(item.score?.final_score);
  if (finalScore !== null) {
    return { label: String(finalScore), tone: "neutral", band: null };
  }

  return { label: "N/D", tone: "neutral", band: null };
}

function dashboardPriority(item: CreditAnalysisListItemDto): number {
  const decision = resolveDecision(item.final_decision, item.motor_result);
  return resolveStatus(decision).priority;
}

export function prioritizeDashboardAnalyses(items: CreditAnalysisListItemDto[]): CreditAnalysisListItemDto[] {
  return [...items].sort((a, b) => {
    const priorityDiff = dashboardPriority(a) - dashboardPriority(b);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

export function toDashboardAnalysisCard(item: CreditAnalysisListItemDto): DashboardAnalysisCardViewModel {
  const status = resolveStatus(resolveDecision(item.final_decision, item.motor_result));
  const score = resolveScore(item);

  return {
    id: item.id,
    companyName: item.customer?.company_name ?? `Cliente #${item.customer_id}`,
    documentNumber: item.customer?.document_number ?? "CNPJ não informado",
    statusLabel: status.label,
    statusTone: status.tone,
    statusGroup: status.group,
    scoreLabel: score.label,
    scoreTone: score.tone,
    scoreBand: score.band,
    limitLabel: formatCurrencyInThousands(item.final_limit ?? item.suggested_limit ?? item.requested_limit)
  };
}
