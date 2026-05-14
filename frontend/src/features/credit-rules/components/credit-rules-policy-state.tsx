import { useState } from "react";

import { CreditPolicyDiffSummaryViewModel, CreditPolicyHeaderViewModel } from "@/features/credit-rules/utils/credit-policy-view-model";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

export type CreditPolicyContextMode = "active" | "draft";

type CreditRulesPolicyStateProps = {
  activePolicy: CreditPolicyHeaderViewModel;
  draftPolicy: CreditPolicyHeaderViewModel;
  draftRulesCount: number;
  activeRulesCount: number;
  diffSummary: CreditPolicyDiffSummaryViewModel;
  selectedContext: CreditPolicyContextMode;
  onSelectContext: (context: CreditPolicyContextMode) => void;
  onPublishDraft: () => Promise<void>;
  onResetDraft: () => Promise<void>;
  publishDisabled?: boolean;
  resetDisabled?: boolean;
  isPublishing?: boolean;
  isResetting?: boolean;
  showManageActions?: boolean;
};

type ConfirmAction = "publish" | "reset" | null;

function formatPendingLabel(diffSummary: CreditPolicyDiffSummaryViewModel) {
  if (diffSummary.total === 0) {
    return "Nenhuma alteração pendente";
  }

  const plural = diffSummary.total === 1 ? "alteração pendente" : "alterações pendentes";
  return `${diffSummary.total} ${plural}`;
}

export function CreditRulesPolicyState({
  activePolicy,
  draftPolicy,
  draftRulesCount,
  activeRulesCount,
  diffSummary,
  selectedContext,
  onSelectContext,
  onPublishDraft,
  onResetDraft,
  publishDisabled,
  resetDisabled,
  isPublishing,
  isResetting,
  showManageActions = true
}: CreditRulesPolicyStateProps) {
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const isActionBusy = Boolean(isPublishing || isResetting);
  const isDraftContext = selectedContext === "draft";

  async function handleConfirm() {
    if (confirmAction === "publish") {
      await onPublishDraft();
    }
    if (confirmAction === "reset") {
      await onResetDraft();
    }
    setConfirmAction(null);
  }

  return (
    <section className="space-y-4 rounded-2xl border border-[#dfe6f3] bg-[#fbfcff] p-5 shadow-sm">
      <div className="grid gap-3 lg:grid-cols-2">
        <button
          type="button"
          onClick={() => onSelectContext("active")}
          className={cn(
            "rounded-xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a2b5e]",
            selectedContext === "active"
              ? "border-[#1a2b5e] bg-[#eef2ff] shadow-sm"
              : "border-[#dce3ef] bg-white hover:border-[#b8c5df] hover:bg-[#f8faff]"
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-[#111827]">Política ativa</p>
            <Badge variant="success">Em vigor</Badge>
          </div>
          <p className="mt-2 text-sm text-[#334155]">{activePolicy.name}</p>
          <p className="mt-1 text-xs text-[#64748b]">Esta é a política atualmente utilizada nas análises.</p>
          <p className="mt-2 text-xs text-[#64748b]">{activeRulesCount} regras em vigor.</p>
        </button>

        <button
          type="button"
          onClick={() => onSelectContext("draft")}
          className={cn(
            "rounded-xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a2b5e]",
            selectedContext === "draft"
              ? "border-[#1a2b5e] bg-[#eef2ff] shadow-sm"
              : "border-[#dce3ef] bg-white hover:border-[#b8c5df] hover:bg-[#f8faff]"
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-[#111827]">Rascunho em edição</p>
            <Badge variant="warning">Não publicado</Badge>
          </div>
          <p className="mt-2 text-sm text-[#334155]">{draftPolicy.name}</p>
          <p className="mt-1 text-xs text-[#64748b]">As alterações feitas aqui não impactam as análises até a publicação.</p>
          <p className="mt-2 text-xs text-[#64748b]">{draftRulesCount} regras no rascunho.</p>
        </button>
      </div>

      <div className="rounded-xl border border-[#e5e9f2] bg-white px-4 py-3">
        <p className="text-sm font-medium text-[#1f2937]">{formatPendingLabel(diffSummary)}</p>
        <p className="mt-1 text-xs text-[#64748b]">
          {diffSummary.created} criada{diffSummary.created === 1 ? "" : "s"} • {diffSummary.updated} alterada{diffSummary.updated === 1 ? "" : "s"} •{" "}
          {diffSummary.removed} removida{diffSummary.removed === 1 ? "" : "s"}
        </p>
      </div>

      {isDraftContext && showManageActions ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() => setConfirmAction("publish")}
            disabled={publishDisabled || isActionBusy}
            className="rounded-lg bg-[#1a2b5e] text-white hover:bg-[#233a7d]"
          >
            {isPublishing ? "Publicando..." : "Publicar alterações"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setConfirmAction("reset")}
            disabled={resetDisabled || isActionBusy}
            className="rounded-lg border-[#d4dbe7] text-[#334155]"
          >
            {isResetting ? "Descartando..." : "Descartar alterações"}
          </Button>
        </div>
      ) : null}

      {confirmAction ? (
        <Alert className="border-[#dce3ef] bg-white">
          <AlertTitle className="text-[#111827]">{confirmAction === "publish" ? "Confirmar publicação" : "Confirmar descarte"}</AlertTitle>
          <AlertDescription className="text-[#475569]">
            {confirmAction === "publish"
              ? "Ao publicar, o rascunho passa a ser a política ativa usada pelo motor."
              : "Ao descartar, o rascunho atual será substituído pela política ativa vigente."}
            <div className="mt-3 flex gap-2">
              <Button
                type="button"
                onClick={handleConfirm}
                className="h-9 rounded-lg bg-[#1a2b5e] text-white hover:bg-[#233a7d]"
                disabled={isActionBusy}
              >
                Confirmar
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-lg border-[#d4dbe7]"
                onClick={() => setConfirmAction(null)}
                disabled={isActionBusy}
              >
                Cancelar
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}
