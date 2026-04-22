import { CreditRuleItem, CreditScore, RuleOperator, RulePillar } from "@/features/credit-rules/types";
import { fieldOptions, formatRuleValue, operatorLabels } from "@/features/credit-rules/utils/credit-rules-view";

export function cloneRules(rules: CreditRuleItem[]): CreditRuleItem[] {
  return rules.map((rule) => ({ ...rule }));
}

export function needsRuleValue(operator: RuleOperator) {
  return operator !== "allowed" && operator !== "not_allowed";
}

export function createRuleId() {
  return `rule-${Date.now()}`;
}

export function buildRuleText(rule: CreditRuleItem) {
  const fieldLabel = fieldOptions.find((item) => item.value === rule.field)?.label ?? "Regra";

  if (rule.operator === "allowed") {
    return `${fieldLabel} permitido`;
  }

  if (rule.operator === "not_allowed") {
    return `${fieldLabel} não permitido`;
  }

  return `${fieldLabel} ${operatorLabels[rule.operator].toLowerCase()} ${formatRuleValue(rule.value)}`;
}

export function resolveDefaultScore(scoreFilter: CreditScore | "all"): CreditScore {
  return scoreFilter === "all" ? "A" : scoreFilter;
}

export function resolveDefaultPillar(pillarFilter: RulePillar | "all"): RulePillar {
  return pillarFilter === "all" ? "externalRisk" : pillarFilter;
}
