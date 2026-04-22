import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";

import {
  CreditPolicyRuleViewModel,
  getCreditRulePillarLabel,
  getCreditRuleScoreLabel
} from "@/features/credit-rules/utils/credit-policy-view-model";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";

type CreditRuleRowProps = {
  rule: CreditPolicyRuleViewModel;
  canEdit: boolean;
  onEdit: (rule: CreditPolicyRuleViewModel) => void;
  onDelete: (rule: CreditPolicyRuleViewModel) => Promise<void>;
  isDeleting?: boolean;
};

export function CreditRuleRow({ rule, canEdit, onEdit, onDelete, isDeleting }: CreditRuleRowProps) {
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  async function handleDelete() {
    await onDelete(rule);
    setIsConfirmingDelete(false);
  }

  return (
    <article className="rounded-xl border border-[#e5e9f2] bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-[#111827]">{rule.title}</p>
          <p className="text-sm text-[#4b5563]">{rule.description}</p>
          <p className="text-xs text-[#64748b]">Valor de referência: {rule.valueText}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="border-[#d4dbe7] bg-[#f8faff] text-[#32456f]">
            {getCreditRuleScoreLabel(rule.score)}
          </Badge>
          <Badge variant="outline" className="border-[#d4dbe7] bg-[#f8faff] text-[#32456f]">
            {getCreditRulePillarLabel(rule.pillar)}
          </Badge>
          <Badge variant={rule.status === "active" ? "success" : "warning"}>
            {rule.status === "active" ? "Ativa" : "Inativa"}
          </Badge>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#edf1f7] pt-3">
        <p className="text-xs text-[#64748b]">Ordem #{rule.orderIndex}</p>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-9 gap-2 border-[#d4dbe7] text-[#334155]"
              onClick={() => onEdit(rule)}
              disabled={Boolean(isDeleting)}
            >
              <Pencil className="h-4 w-4" />
              Editar
            </Button>
            {isConfirmingDelete ? (
              <>
                <Button
                  type="button"
                  variant="destructive"
                  className="h-9"
                  onClick={handleDelete}
                  disabled={Boolean(isDeleting)}
                >
                  {isDeleting ? "Excluindo..." : "Confirmar exclusão"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 border-[#d4dbe7]"
                  onClick={() => setIsConfirmingDelete(false)}
                  disabled={Boolean(isDeleting)}
                >
                  Cancelar
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="h-9 gap-2 border-rose-200 text-rose-700 hover:bg-rose-50"
                onClick={() => setIsConfirmingDelete(true)}
                disabled={Boolean(isDeleting)}
              >
                <Trash2 className="h-4 w-4" />
                Excluir
              </Button>
            )}
          </div>
        ) : (
          <Badge variant="outline" className="border-[#d7deea] bg-[#f8faff] text-[#64748b]">
            Modo consulta
          </Badge>
        )}
      </div>
    </article>
  );
}
