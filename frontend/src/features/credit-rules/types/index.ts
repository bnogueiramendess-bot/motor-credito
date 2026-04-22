export type CreditScore = "A" | "B" | "C" | "D";
export type CreditRulesScreenMode = "view" | "manage";

export type RulePillar = "externalRisk" | "legal" | "internalHistory" | "financialCapacity";

export type RuleField =
  | "externalScore"
  | "negativeRecordCount"
  | "negativeRecordAmount"
  | "protestCount"
  | "protestAmount"
  | "legalProceedings"
  | "averageDelayDays"
  | "paymentBehavior"
  | "revenue"
  | "limitToRevenueRatio";

export type RuleOperator = "gte" | "lte" | "eq" | "allowed" | "not_allowed";

export type CreditRuleItem = {
  id: string;
  score: CreditScore;
  pillar: RulePillar;
  field: RuleField;
  label: string;
  operator: RuleOperator;
  value: string | number | boolean;
  active: boolean;
  description?: string;
};

export type CreditRuleGroup = {
  title: string;
  description: string;
  rules: string[];
};

export type CreditScoreGroups = {
  externalRisk: CreditRuleGroup;
  legal: CreditRuleGroup;
  internalHistory: CreditRuleGroup;
  financialCapacity: CreditRuleGroup;
};

export type CreditScoreRuleSet = {
  score: CreditScore;
  label: string;
  riskSubtitle: string;
  summary: string;
  decisionImpact: string;
  practicalExample: string;
  groups: CreditScoreGroups;
};
