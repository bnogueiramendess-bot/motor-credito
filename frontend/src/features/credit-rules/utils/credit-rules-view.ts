import { creditRulesByScore } from "@/features/credit-rules/data/credit-rules.mock";
import { CreditRuleGroup, CreditScore, RuleField, RuleOperator, RulePillar } from "@/features/credit-rules/types";

type ScoreVisualConfig = {
  accent: string;
  cardClassName: string;
  pillClassName: string;
};

export const scoreVisualMap: Record<CreditScore, ScoreVisualConfig> = {
  A: {
    accent: "text-emerald-700",
    cardClassName: "border-emerald-200 bg-emerald-50/70",
    pillClassName: "border-emerald-200 bg-emerald-50 text-emerald-800"
  },
  B: {
    accent: "text-sky-700",
    cardClassName: "border-sky-200 bg-sky-50/70",
    pillClassName: "border-sky-200 bg-sky-50 text-sky-800"
  },
  C: {
    accent: "text-amber-700",
    cardClassName: "border-amber-200 bg-amber-50/70",
    pillClassName: "border-amber-200 bg-amber-50 text-amber-800"
  },
  D: {
    accent: "text-rose-700",
    cardClassName: "border-rose-200 bg-rose-50/70",
    pillClassName: "border-rose-200 bg-rose-50 text-rose-800"
  }
};

export function getCreditRuleGroups(score: CreditScore): CreditRuleGroup[] {
  const groups = creditRulesByScore[score].groups;

  return [groups.externalRisk, groups.legal, groups.internalHistory, groups.financialCapacity];
}

export const pillarLabels: Record<RulePillar, string> = {
  externalRisk: "Risco externo",
  legal: "Jurídico",
  internalHistory: "Histórico interno",
  financialCapacity: "Capacidade financeira"
};

export const fieldLabels: Record<RuleField, string> = {
  externalScore: "Score externo",
  negativeRecordCount: "Quantidade de restrições",
  negativeRecordAmount: "Valor total de restrições",
  protestCount: "Quantidade de protestos",
  protestAmount: "Valor total de protestos",
  legalProceedings: "Ocorrências jurídicas relevantes",
  averageDelayDays: "Atraso médio de pagamento (dias)",
  paymentBehavior: "Comportamento de pagamento",
  revenue: "Faturamento mensal",
  limitToRevenueRatio: "Relação limite/faturamento"
};

export const operatorLabels: Record<RuleOperator, string> = {
  gte: "Maior ou igual a",
  lte: "Menor ou igual a",
  eq: "Igual a",
  allowed: "Permitido",
  not_allowed: "Não permitido"
};

export const pillarOptions: Array<{ value: RulePillar; label: string }> = [
  { value: "externalRisk", label: pillarLabels.externalRisk },
  { value: "legal", label: pillarLabels.legal },
  { value: "internalHistory", label: pillarLabels.internalHistory },
  { value: "financialCapacity", label: pillarLabels.financialCapacity }
];

export const fieldOptions: Array<{ value: RuleField; label: string; valueType: "number" | "text" | "boolean" }> = [
  { value: "externalScore", label: fieldLabels.externalScore, valueType: "number" },
  { value: "negativeRecordCount", label: fieldLabels.negativeRecordCount, valueType: "number" },
  { value: "negativeRecordAmount", label: fieldLabels.negativeRecordAmount, valueType: "number" },
  { value: "protestCount", label: fieldLabels.protestCount, valueType: "number" },
  { value: "protestAmount", label: fieldLabels.protestAmount, valueType: "number" },
  { value: "legalProceedings", label: fieldLabels.legalProceedings, valueType: "boolean" },
  { value: "averageDelayDays", label: fieldLabels.averageDelayDays, valueType: "number" },
  { value: "paymentBehavior", label: fieldLabels.paymentBehavior, valueType: "text" },
  { value: "revenue", label: fieldLabels.revenue, valueType: "number" },
  { value: "limitToRevenueRatio", label: fieldLabels.limitToRevenueRatio, valueType: "number" }
];

export const operatorOptions: Array<{ value: RuleOperator; label: string }> = [
  { value: "gte", label: operatorLabels.gte },
  { value: "lte", label: operatorLabels.lte },
  { value: "eq", label: operatorLabels.eq },
  { value: "allowed", label: operatorLabels.allowed },
  { value: "not_allowed", label: operatorLabels.not_allowed }
];

export function getFieldValueType(field: RuleField): "number" | "text" | "boolean" {
  return fieldOptions.find((option) => option.value === field)?.valueType ?? "text";
}

export function formatRuleValue(value: string | number | boolean): string {
  if (typeof value === "boolean") {
    return value ? "Sim" : "Não";
  }

  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      return String(value);
    }

    return value.toFixed(2).replace(".", ",");
  }

  return value;
}
