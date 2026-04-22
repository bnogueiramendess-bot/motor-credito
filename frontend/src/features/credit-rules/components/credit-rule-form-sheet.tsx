"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";

import { ScoreBandDto } from "@/features/credit-rules/api/credit-policy.contracts";
import {
  CreditPolicyRuleFormValues,
  creditPolicyFieldOptions,
  creditPolicyOperatorOptions,
  getDefaultRuleFormValues,
  getEditRuleFormValues,
  getFieldOption,
  toCreatePayload,
  toUpdatePayload,
  validateCreditPolicyRuleForm
} from "@/features/credit-rules/utils/credit-policy-form";
import { CreditPolicyRuleViewModel } from "@/features/credit-rules/utils/credit-policy-view-model";
import { Button } from "@/shared/components/ui/button";

export type CreditRuleFormSheetSubmitPayload =
  | { mode: "create"; payload: ReturnType<typeof toCreatePayload> }
  | { mode: "update"; ruleId: number; payload: ReturnType<typeof toUpdatePayload> };

type CreditRuleFormSheetProps = {
  open: boolean;
  initialRule: CreditPolicyRuleViewModel | null;
  onClose: () => void;
  onSubmit: (payload: CreditRuleFormSheetSubmitPayload) => Promise<void>;
  submitError?: string | null;
  isSubmitting?: boolean;
};

const scoreBandOptions: Array<{ value: ScoreBandDto | "TODOS"; label: string }> = [
  { value: "TODOS", label: "Todos os scores" },
  { value: "A", label: "Score A" },
  { value: "B", label: "Score B" },
  { value: "C", label: "Score C" },
  { value: "D", label: "Score D" }
];

const pillarOptions = [
  { value: "externalRisk", label: "Risco externo" },
  { value: "legal", label: "Jurídico" },
  { value: "internalHistory", label: "Histórico interno" },
  { value: "financialCapacity", label: "Capacidade financeira" }
] as const;

export function CreditRuleFormSheet({
  open,
  initialRule,
  onClose,
  onSubmit,
  submitError,
  isSubmitting
}: CreditRuleFormSheetProps) {
  const [values, setValues] = useState<CreditPolicyRuleFormValues>(getDefaultRuleFormValues());
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (initialRule) {
      setValues(getEditRuleFormValues(initialRule));
    } else {
      setValues(getDefaultRuleFormValues());
    }
    setFormError(null);
  }, [initialRule, open]);

  const fieldOption = useMemo(() => getFieldOption(values.field), [values.field]);
  const shouldShowValueInput = fieldOption.valueType !== "boolean";
  const shouldShowPointsInput = Boolean(fieldOption.requiresPoints);
  const shouldRequireScoreBand = Boolean(fieldOption.requiresScoreBand);

  if (!open) {
    return null;
  }

  function updateField<K extends keyof CreditPolicyRuleFormValues>(key: K, value: CreditPolicyRuleFormValues[K]) {
    setValues((previous) => ({ ...previous, [key]: value }));
  }

  function handleFieldChange(newField: string) {
    const nextOption = getFieldOption(newField);
    setValues((previous) => ({
      ...previous,
      field: newField,
      pillar: nextOption.defaultPillar,
      operator: nextOption.defaultOperator,
      scoreBand: nextOption.requiresScoreBand ? (previous.scoreBand === "TODOS" ? "A" : previous.scoreBand) : previous.scoreBand
    }));
  }

  async function handleSubmit() {
    const validationError = validateCreditPolicyRuleForm(values);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setFormError(null);

    if (initialRule) {
      await onSubmit({
        mode: "update",
        ruleId: initialRule.id,
        payload: toUpdatePayload(values)
      });
      return;
    }

    await onSubmit({
      mode: "create",
      payload: toCreatePayload(values)
    });
  }

  return (
    <div className="fixed inset-0 z-40">
      <button type="button" aria-label="Fechar formulário" onClick={onClose} className="absolute inset-0 bg-[#0f172a]/35 backdrop-blur-[1px]" />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={initialRule ? "Editar regra do rascunho" : "Nova regra no rascunho"}
        className="absolute right-0 top-0 h-full w-full max-w-xl overflow-y-auto border-l border-[#e5e9f2] bg-white shadow-2xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#e8edf6] bg-white px-5 py-4">
          <div>
            <p className="text-base font-semibold text-[#111827]">{initialRule ? "Editar regra do rascunho" : "Nova regra no rascunho"}</p>
            <p className="text-sm text-[#4b5563]">A alteração será aplicada diretamente ao rascunho oficial.</p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Fechar">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-4 p-5">
          <label className="block space-y-1">
            <span className="text-xs font-medium uppercase tracking-[0.04em] text-[#6b7280]">Nome da regra</span>
            <input
              value={values.label}
              onChange={(event) => updateField("label", event.target.value)}
              placeholder="Ex.: Penalidade por restrições"
              className="h-10 w-full rounded-lg border border-[#d4dbe7] bg-white px-3 text-sm text-[#111827] outline-none transition focus:border-[#1a2b5e]"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs font-medium uppercase tracking-[0.04em] text-[#6b7280]">Score</span>
              <select
                value={values.scoreBand}
                onChange={(event) => updateField("scoreBand", event.target.value as ScoreBandDto | "TODOS")}
                className="h-10 w-full rounded-lg border border-[#d4dbe7] bg-white px-3 text-sm text-[#111827] outline-none transition focus:border-[#1a2b5e]"
              >
                {scoreBandOptions.map((score) => (
                  <option key={score.value} value={score.value}>
                    {score.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium uppercase tracking-[0.04em] text-[#6b7280]">Pilar</span>
              <select
                value={values.pillar}
                onChange={(event) => updateField("pillar", event.target.value as CreditPolicyRuleFormValues["pillar"])}
                className="h-10 w-full rounded-lg border border-[#d4dbe7] bg-white px-3 text-sm text-[#111827] outline-none transition focus:border-[#1a2b5e]"
              >
                {pillarOptions.map((pillar) => (
                  <option key={pillar.value} value={pillar.value}>
                    {pillar.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs font-medium uppercase tracking-[0.04em] text-[#6b7280]">Campo</span>
              <select
                value={values.field}
                onChange={(event) => handleFieldChange(event.target.value)}
                className="h-10 w-full rounded-lg border border-[#d4dbe7] bg-white px-3 text-sm text-[#111827] outline-none transition focus:border-[#1a2b5e]"
              >
                {creditPolicyFieldOptions.map((field) => (
                  <option key={field.value} value={field.value}>
                    {field.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium uppercase tracking-[0.04em] text-[#6b7280]">Operador</span>
              <select
                value={values.operator}
                onChange={(event) => updateField("operator", event.target.value)}
                className="h-10 w-full rounded-lg border border-[#d4dbe7] bg-white px-3 text-sm text-[#111827] outline-none transition focus:border-[#1a2b5e]"
              >
                {creditPolicyOperatorOptions.map((operator) => (
                  <option key={operator.value} value={operator.value}>
                    {operator.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {shouldShowValueInput ? (
            <label className="block space-y-1">
              <span className="text-xs font-medium uppercase tracking-[0.04em] text-[#6b7280]">Valor</span>
              <input
                value={values.valueText}
                onChange={(event) => updateField("valueText", event.target.value)}
                placeholder={fieldOption.valueType === "decimal" ? "Ex.: 0,5" : "Ex.: 100"}
                className="h-10 w-full rounded-lg border border-[#d4dbe7] bg-white px-3 text-sm text-[#111827] outline-none transition focus:border-[#1a2b5e]"
              />
            </label>
          ) : (
            <label className="block space-y-1">
              <span className="text-xs font-medium uppercase tracking-[0.04em] text-[#6b7280]">Valor</span>
              <select
                value={values.valueBoolean ? "true" : "false"}
                onChange={(event) => updateField("valueBoolean", event.target.value === "true")}
                className="h-10 w-full rounded-lg border border-[#d4dbe7] bg-white px-3 text-sm text-[#111827] outline-none transition focus:border-[#1a2b5e]"
              >
                <option value="true">Sim</option>
                <option value="false">Não</option>
              </select>
            </label>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs font-medium uppercase tracking-[0.04em] text-[#6b7280]">Ordem (opcional)</span>
              <input
                value={values.orderIndex}
                onChange={(event) => updateField("orderIndex", event.target.value)}
                placeholder="Ex.: 10"
                className="h-10 w-full rounded-lg border border-[#d4dbe7] bg-white px-3 text-sm text-[#111827] outline-none transition focus:border-[#1a2b5e]"
              />
            </label>

            {shouldShowPointsInput ? (
              <label className="block space-y-1">
                <span className="text-xs font-medium uppercase tracking-[0.04em] text-[#6b7280]">Pontos</span>
                <input
                  value={values.points}
                  onChange={(event) => updateField("points", event.target.value)}
                  placeholder="Ex.: -80"
                  className="h-10 w-full rounded-lg border border-[#d4dbe7] bg-white px-3 text-sm text-[#111827] outline-none transition focus:border-[#1a2b5e]"
                />
              </label>
            ) : null}
          </div>

          <label className="block space-y-1">
            <span className="text-xs font-medium uppercase tracking-[0.04em] text-[#6b7280]">Descrição complementar (opcional)</span>
            <textarea
              rows={3}
              value={values.description}
              onChange={(event) => updateField("description", event.target.value)}
              placeholder="Contexto adicional para a governança da política."
              className="w-full rounded-lg border border-[#d4dbe7] bg-white px-3 py-2 text-sm text-[#111827] outline-none transition focus:border-[#1a2b5e]"
            />
          </label>

          <label className="flex items-center gap-2 rounded-lg border border-[#dce3ef] bg-[#f8faff] px-3 py-2">
            <input
              type="checkbox"
              checked={values.isActive}
              onChange={(event) => updateField("isActive", event.target.checked)}
              className="h-4 w-4 rounded border-[#b9c3d8] text-[#1a2b5e] focus:ring-[#1a2b5e]"
            />
            <span className="text-sm text-[#32456f]">Regra ativa no rascunho</span>
          </label>

          {shouldRequireScoreBand && values.scoreBand === "TODOS" ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
              Este tipo de regra exige uma faixa de score específica.
            </p>
          ) : null}

          {formError ? <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{formError}</p> : null}
          {submitError ? <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{submitError}</p> : null}
        </div>

        <div className="sticky bottom-0 flex gap-2 border-t border-[#e8edf6] bg-white px-5 py-4">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button type="button" className="flex-1 bg-[#1a2b5e] hover:bg-[#233a7d]" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Salvando..." : initialRule ? "Salvar alterações" : "Criar regra"}
          </Button>
        </div>
      </aside>
    </div>
  );
}
