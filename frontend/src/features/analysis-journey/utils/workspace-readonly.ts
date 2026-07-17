export const TECHNICAL_CONTINUATION_ACTIONS = new Set(["start_analysis", "continue_analysis", "execute_analysis"]);

const TECHNICALLY_EDITABLE_STATUSES = new Set(["created", "in_progress", "changes_requested"]);
const FINAL_READ_ONLY_STATUSES = new Set(["approved", "rejected", "completed", "cancelled"]);

type WorkspaceReadonlyInput = {
  isWorkspaceMode: boolean;
  analysisStatus: string | null | undefined;
  finalDecision?: unknown | null;
  submittedForApprovalAt?: string | null;
  hasTechnicalContinuationCapability: boolean;
  availableActions?: readonly string[] | null;
};

export function resolveTechnicalWorkspaceEditCapability(input: Pick<WorkspaceReadonlyInput, "analysisStatus" | "hasTechnicalContinuationCapability" | "availableActions">) {
  const workflowHasTechnicalAction = (input.availableActions ?? []).some((action) => TECHNICAL_CONTINUATION_ACTIONS.has(action));
  return (
    (input.hasTechnicalContinuationCapability || workflowHasTechnicalAction) &&
    TECHNICALLY_EDITABLE_STATUSES.has(input.analysisStatus ?? "")
  );
}

export function resolveAnalysisJourneyReadOnly(input: WorkspaceReadonlyInput) {
  if (!input.isWorkspaceMode) return false;

  const status = input.analysisStatus ?? "";
  const isReturnedForChanges = status === "changes_requested";
  const isApprovalLockedByStatus =
    status === "in_approval" ||
    (Boolean(input.submittedForApprovalAt) && !isReturnedForChanges && !TECHNICALLY_EDITABLE_STATUSES.has(status));

  return (
    !resolveTechnicalWorkspaceEditCapability(input) ||
    Boolean(input.finalDecision) ||
    FINAL_READ_ONLY_STATUSES.has(status) ||
    isApprovalLockedByStatus
  );
}
