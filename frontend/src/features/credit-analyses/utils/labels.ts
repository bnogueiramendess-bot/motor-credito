import { AnalysisStatus, FinalDecision, MotorResult } from "@/features/credit-analyses/api/contracts";

export function analysisStatusLabel(status: AnalysisStatus): string {
  switch (status) {
    case "created":
      return "Pendente";
    case "in_progress":
      return "Em andamento";
    case "completed":
      return "Finalizada";
    default:
      return status;
  }
}

export function decisionLabel(decision: MotorResult | FinalDecision): string {
  switch (decision) {
    case "approved":
      return "Aprovado";
    case "rejected":
      return "Recusado";
    case "manual_review":
      return "Revisão manual";
    default:
      return decision;
  }
}
