import { Badge } from "@/shared/components/ui/badge";
import { AnalysisStatus, FinalDecision, MotorResult } from "@/features/credit-analyses/api/contracts";
import { analysisStatusLabel, decisionLabel } from "@/features/credit-analyses/utils/labels";

type StatusBadgeProps = {
  type: "analysis" | "decision";
  value: AnalysisStatus | MotorResult | FinalDecision | null;
};

function resolveVariant(value: StatusBadgeProps["value"]) {
  if (value === "approved" || value === "completed") {
    return "success";
  }
  if (value === "rejected") {
    return "danger";
  }
  if (value === "manual_review" || value === "in_progress") {
    return "warning";
  }
  return "outline";
}

export function StatusBadge({ type, value }: StatusBadgeProps) {
  if (!value) {
    return <Badge variant="outline">Não definido</Badge>;
  }

  const label = type === "analysis" ? analysisStatusLabel(value as AnalysisStatus) : decisionLabel(value as MotorResult | FinalDecision);

  return <Badge variant={resolveVariant(value)}>{label}</Badge>;
}
