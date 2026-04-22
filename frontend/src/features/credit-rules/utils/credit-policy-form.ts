import {
  CreateCreditPolicyDraftRulePayload,
  ScoreBandDto,
  UpdateCreditPolicyDraftRulePayload
} from "@/features/credit-rules/api/credit-policy.contracts";
import { CreditPolicyRuleViewModel } from "@/features/credit-rules/utils/credit-policy-view-model";

export type RuleFieldValueType = "number" | "decimal" | "boolean" | "text" | "nullable-number";

export type CreditPolicyFieldOption = {
  value: string;
  label: string;
  defaultPillar: "externalRisk" | "legal" | "internalHistory" | "financialCapacity";
  valueType: RuleFieldValueType;
  defaultOperator: string;
  requiresPoints?: boolean;
  requiresScoreBand?: boolean;
};

export const creditPolicyFieldOptions: CreditPolicyFieldOption[] = [
  { value: "score.base", label: "Score base", defaultPillar: "internalHistory", valueType: "number", defaultOperator: "eq" },
  { value: "score.min", label: "Score mínimo", defaultPillar: "internalHistory", valueType: "number", defaultOperator: "eq" },
  { value: "score.max", label: "Score máximo", defaultPillar: "internalHistory", valueType: "number", defaultOperator: "eq" },
  {
    value: "score.band.min",
    label: "Faixa de score mínima",
    defaultPillar: "internalHistory",
    valueType: "nullable-number",
    defaultOperator: "gte",
    requiresScoreBand: true
  },
  {
    value: "score.band.max",
    label: "Faixa de score máxima",
    defaultPillar: "internalHistory",
    valueType: "nullable-number",
    defaultOperator: "lte",
    requiresScoreBand: true
  },
  {
    value: "score.penalty.restrictions",
    label: "Penalidade por restrições",
    defaultPillar: "externalRisk",
    valueType: "number",
    defaultOperator: "eq"
  },
  {
    value: "score.penalty.protests_per_item",
    label: "Penalidade por protesto",
    defaultPillar: "legal",
    valueType: "number",
    defaultOperator: "per_item"
  },
  {
    value: "score.penalty.lawsuits_per_item",
    label: "Penalidade por ação judicial",
    defaultPillar: "legal",
    valueType: "number",
    defaultOperator: "per_item"
  },
  {
    value: "score.penalty.bounced_checks_per_item",
    label: "Penalidade por cheque sem fundo",
    defaultPillar: "internalHistory",
    valueType: "number",
    defaultOperator: "per_item"
  },
  {
    value: "score.penalty.debt_ratio",
    label: "Penalidade por índice de endividamento",
    defaultPillar: "financialCapacity",
    valueType: "decimal",
    defaultOperator: "gt",
    requiresPoints: true
  },
  {
    value: "decision.band_limit_cap",
    label: "Limite por faixa de score",
    defaultPillar: "financialCapacity",
    valueType: "decimal",
    defaultOperator: "multiplier",
    requiresScoreBand: true
  },
  {
    value: "decision.max_indebtedness_for_auto_approval",
    label: "Endividamento máximo para aprovação automática",
    defaultPillar: "financialCapacity",
    valueType: "decimal",
    defaultOperator: "lte"
  },
  {
    value: "criteria.has_restrictions",
    label: "Critério de restrições",
    defaultPillar: "externalRisk",
    valueType: "boolean",
    defaultOperator: "required"
  },
  {
    value: "criteria.protests_count",
    label: "Critério de protestos",
    defaultPillar: "legal",
    valueType: "boolean",
    defaultOperator: "required"
  },
  {
    value: "criteria.lawsuits_count",
    label: "Critério de ações judiciais",
    defaultPillar: "legal",
    valueType: "boolean",
    defaultOperator: "required"
  },
  {
    value: "criteria.bounced_checks_count",
    label: "Critério de cheques sem fundo",
    defaultPillar: "internalHistory",
    valueType: "boolean",
    defaultOperator: "required"
  },
  {
    value: "criteria.declared_revenue",
    label: "Critério de receita declarada",
    defaultPillar: "financialCapacity",
    valueType: "boolean",
    defaultOperator: "required"
  },
  {
    value: "criteria.declared_indebtedness",
    label: "Critério de endividamento declarado",
    defaultPillar: "financialCapacity",
    valueType: "boolean",
    defaultOperator: "required"
  }
];

export const creditPolicyOperatorOptions = [
  { value: "eq", label: "Igual a" },
  { value: "gte", label: "Maior ou igual a" },
  { value: "lte", label: "Menor ou igual a" },
  { value: "gt", label: "Maior que" },
  { value: "lt", label: "Menor que" },
  { value: "per_item", label: "Por ocorrência" },
  { value: "multiplier", label: "Multiplicador" },
  { value: "required", label: "Obrigatório" }
] as const;

export type CreditPolicyRuleFormValues = {
  scoreBand: ScoreBandDto | "TODOS";
  pillar: "externalRisk" | "legal" | "internalHistory" | "financialCapacity";
  field: string;
  operator: string;
  valueText: string;
  valueBoolean: boolean;
  points: string;
  label: string;
  description: string;
  isActive: boolean;
  orderIndex: string;
};

function normalizeValueInput(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

export function getFieldOption(field: string) {
  return creditPolicyFieldOptions.find((option) => option.value === field) ?? creditPolicyFieldOptions[0];
}

export function getDefaultRuleFormValues(): CreditPolicyRuleFormValues {
  const defaultField = creditPolicyFieldOptions[0];
  return {
    scoreBand: "TODOS",
    pillar: defaultField.defaultPillar,
    field: defaultField.value,
    operator: defaultField.defaultOperator,
    valueText: "",
    valueBoolean: true,
    points: "",
    label: "",
    description: "",
    isActive: true,
    orderIndex: ""
  };
}

export function getEditRuleFormValues(rule: CreditPolicyRuleViewModel): CreditPolicyRuleFormValues {
  return {
    scoreBand: rule.source.score_band ?? "TODOS",
    pillar: rule.pillar,
    field: rule.source.field,
    operator: rule.source.operator,
    valueText: normalizeValueInput(rule.source.value),
    valueBoolean: Boolean(rule.source.value),
    points: rule.source.points !== null ? String(rule.source.points) : "",
    label: rule.source.label,
    description: rule.source.description ?? "",
    isActive: rule.source.is_active,
    orderIndex: String(rule.source.order_index)
  };
}

function parseRuleValue(values: CreditPolicyRuleFormValues): unknown {
  const fieldOption = getFieldOption(values.field);
  const valueType = fieldOption.valueType;

  if (valueType === "boolean") {
    return values.valueBoolean;
  }

  if (valueType === "number" || valueType === "decimal") {
    return Number(values.valueText.replace(",", "."));
  }

  if (valueType === "nullable-number") {
    const trimmed = values.valueText.trim();
    if (!trimmed) {
      return null;
    }
    return Number(trimmed.replace(",", "."));
  }

  return values.valueText.trim();
}

export function validateCreditPolicyRuleForm(values: CreditPolicyRuleFormValues): string | null {
  const fieldOption = getFieldOption(values.field);
  if (!values.label.trim()) {
    return "Informe um nome claro para a regra.";
  }

  if (fieldOption.requiresScoreBand && values.scoreBand === "TODOS") {
    return "Selecione o score para este tipo de regra.";
  }

  if (fieldOption.valueType !== "boolean") {
    const parsedValue = parseRuleValue(values);
    if (fieldOption.valueType === "number" || fieldOption.valueType === "decimal") {
      if (typeof parsedValue !== "number" || !Number.isFinite(parsedValue)) {
        return "Informe um valor numérico válido.";
      }
    }
  }

  if (fieldOption.requiresPoints) {
    const parsedPoints = Number(values.points);
    if (!Number.isInteger(parsedPoints)) {
      return "Informe os pontos da regra como número inteiro.";
    }
  }

  return null;
}

export function toCreatePayload(values: CreditPolicyRuleFormValues): CreateCreditPolicyDraftRulePayload {
  const fieldOption = getFieldOption(values.field);
  const parsedOrder = Number(values.orderIndex);
  const parsedPoints = Number(values.points);

  return {
    score_band: values.scoreBand === "TODOS" ? null : values.scoreBand,
    pillar: values.pillar,
    field: values.field,
    operator: values.operator,
    value: parseRuleValue(values),
    points: fieldOption.requiresPoints ? parsedPoints : null,
    label: values.label.trim(),
    description: values.description.trim() ? values.description.trim() : null,
    is_active: values.isActive,
    order_index: Number.isInteger(parsedOrder) ? parsedOrder : null
  };
}

export function toUpdatePayload(values: CreditPolicyRuleFormValues): UpdateCreditPolicyDraftRulePayload {
  return toCreatePayload(values);
}
