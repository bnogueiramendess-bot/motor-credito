import { CreditRuleRow } from "@/features/credit-rules/components/credit-rule-row";
import { CreditPolicyRuleViewModel } from "@/features/credit-rules/utils/credit-policy-view-model";

type CreditRulesListProps = {
  rules: CreditPolicyRuleViewModel[];
  totalCount: number;
  contextLabel: string;
  canEdit: boolean;
  onEditRule: (rule: CreditPolicyRuleViewModel) => void;
  onDeleteRule: (rule: CreditPolicyRuleViewModel) => Promise<void>;
  deletingRuleId?: number | null;
};

export function CreditRulesList({
  rules,
  totalCount,
  contextLabel,
  canEdit,
  onEditRule,
  onDeleteRule,
  deletingRuleId
}: CreditRulesListProps) {
  return (
    <section className="space-y-3 rounded-2xl border border-[#e5e9f2] bg-[#fcfdff] p-4 shadow-sm">
      <div>
        <p className="text-sm font-semibold text-[#111827]">Regras da {contextLabel.toLowerCase()}</p>
        <p className="text-sm text-[#4b5563]">
          {rules.length} regra(s) exibida(s) de {totalCount} regra(s) da {contextLabel.toLowerCase()}.
        </p>
      </div>

      {rules.length ? (
        <div className="space-y-3">
          {rules.map((rule) => (
            <CreditRuleRow
              key={rule.id}
              rule={rule}
              canEdit={canEdit}
              onEdit={onEditRule}
              onDelete={onDeleteRule}
              isDeleting={deletingRuleId === rule.id}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-[#d7deea] bg-white px-4 py-8 text-center text-sm text-[#4b5563]">
          Nenhuma regra encontrada para os filtros selecionados.
        </div>
      )}
    </section>
  );
}
