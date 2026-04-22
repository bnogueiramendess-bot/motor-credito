import { AnalysisStatus, FinalDecision, MotorResult } from "@/features/credit-analyses/api/contracts";

export function analysisStatusLabel(status: AnalysisStatus): string {
  switch (status) {
    case "created":
      return "Criada";
    case "in_progress":
      return "Em andamento";
    case "completed":
      return "Concluída";
    default:
      return status;
  }
}

export function decisionLabel(decision: MotorResult | FinalDecision): string {
  switch (decision) {
    case "approved":
      return "Aprovada";
    case "rejected":
      return "Rejeitada";
    case "manual_review":
      return "Revisão manual";
    default:
      return decision;
  }
}
