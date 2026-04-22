import { CreditRuleItem } from "@/features/credit-rules/types";

export type CreditRulesDiffSummary = {
  hasChanges: boolean;
  pendingCount: number;
  createdCount: number;
  updatedCount: number;
  removedCount: number;
};

function normalizeRule(rule: CreditRuleItem) {
  return {
    id: rule.id,
    score: rule.score,
    pillar: rule.pillar,
    field: rule.field,
    label: rule.label,
    operator: rule.operator,
    value: rule.value,
    active: rule.active,
    description: rule.description ?? ""
  };
}

function toRuleMap(rules: CreditRuleItem[]) {
  return new Map(rules.map((rule) => [rule.id, normalizeRule(rule)]));
}

export function diffCreditRules(activeRules: CreditRuleItem[], draftRules: CreditRuleItem[]): CreditRulesDiffSummary {
  const activeMap = toRuleMap(activeRules);
  const draftMap = toRuleMap(draftRules);

  let createdCount = 0;
  let updatedCount = 0;
  let removedCount = 0;

  for (const [id, draftRule] of draftMap.entries()) {
    if (!activeMap.has(id)) {
      createdCount += 1;
      continue;
    }

    const activeRule = activeMap.get(id);
    if (JSON.stringify(activeRule) !== JSON.stringify(draftRule)) {
      updatedCount += 1;
    }
  }

  for (const id of activeMap.keys()) {
    if (!draftMap.has(id)) {
      removedCount += 1;
    }
  }

  const pendingCount = createdCount + updatedCount + removedCount;

  return {
    hasChanges: pendingCount > 0,
    pendingCount,
    createdCount,
    updatedCount,
    removedCount
  };
}
