import { Plus } from "lucide-react";

import { CreditPolicyContextMode } from "@/features/credit-rules/components/credit-rules-policy-state";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";

type CreditRulesToolbarProps = {
  activePolicyName: string;
  draftVersion: string;
  selectedContext: CreditPolicyContextMode;
  onCreateRule: () => void;
  disableCreateRule?: boolean;
  showCreateRule?: boolean;
};

export function CreditRulesToolbar({
  activePolicyName,
  draftVersion,
  selectedContext,
  onCreateRule,
  disableCreateRule,
  showCreateRule = true
}: CreditRulesToolbarProps) {
  const isDraftContext = selectedContext === "draft";

  return (
    <header className="rounded-2xl border border-[#e5e9f2] bg-white px-6 py-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl space-y-1">
          <h1 className="text-2xl font-semibold tracking-[-0.01em] text-[#111827]">Gestão da política de crédito</h1>
          <p className="text-sm leading-6 text-[#4b5563]">Edite o rascunho com segurança e publique quando estiver pronto.</p>
          <p className="text-sm leading-6 text-[#64748b]">A política ativa continua sendo usada nas análises até a publicação.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-[#d4dbe7] bg-[#f8faff] px-3 py-1 text-[#32456f]">
            Ativa: {activePolicyName}
          </Badge>
          <Badge variant="outline" className="border-[#d4dbe7] bg-[#f8faff] px-3 py-1 text-[#32456f]">
            Rascunho: {draftVersion}
          </Badge>
          {showCreateRule ? (
            <Button
              type="button"
              onClick={onCreateRule}
              disabled={disableCreateRule}
              className="gap-2 rounded-lg bg-[#1a2b5e] text-white hover:bg-[#233a7d]"
            >
              <Plus className="h-4 w-4" />
              {isDraftContext ? "Nova regra" : "Nova regra (somente no rascunho)"}
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
