export type ScoreBandDto = "A" | "B" | "C" | "D";

export type CreditPolicyScoreBandDto = {
  min_score: number | null;
  max_score: number | null;
};

export type CreditPolicyScoreBandsDto = {
  A: CreditPolicyScoreBandDto;
  B: CreditPolicyScoreBandDto;
  C: CreditPolicyScoreBandDto;
  D: CreditPolicyScoreBandDto;
};

export type CreditPolicyDebtRatioPenaltyDto = {
  threshold: number | string;
  points: number;
};

export type CreditPolicyScoreAdjustmentsDto = {
  restrictions_points: number;
  protests_points_per_item: number;
  lawsuits_points_per_item: number;
  bounced_checks_points_per_item: number;
  debt_ratio_points: CreditPolicyDebtRatioPenaltyDto[];
};

export type CreditPolicyDecisionDto = {
  band_limit_caps: Record<string, number | string>;
  max_indebtedness_for_auto_approval: number | string;
};

export type CreditPolicyCriteriaDto = {
  has_restrictions: boolean;
  protests_count: boolean;
  lawsuits_count: boolean;
  bounced_checks_count: boolean;
  declared_revenue: boolean;
  declared_indebtedness: boolean;
};

export type CreditPolicyRuleDto = {
  id: number;
  policy_id: number;
  score_band: ScoreBandDto | null;
  pillar: string;
  field: string;
  operator: string;
  value: unknown;
  points: number | null;
  label: string;
  description: string | null;
  is_active: boolean;
  order_index: number;
  created_at: string;
  updated_at: string;
};

export type CreditPolicyDiffSummaryDto = {
  created_rules: number;
  updated_rules: number;
  removed_rules: number;
};

export type CreditPolicyDto = {
  policy_id: number;
  policy_status: "active" | "draft" | "archived" | string;
  version_number: number;
  published_at: string | null;
  policy_name: string;
  policy_version: string;
  policy_type: string;
  policy_source: string;
  note: string;
  score_base: number;
  score_min: number;
  score_max: number;
  score_bands: CreditPolicyScoreBandsDto;
  score_adjustments: CreditPolicyScoreAdjustmentsDto;
  decision: CreditPolicyDecisionDto;
  criteria: CreditPolicyCriteriaDto;
  rules: CreditPolicyRuleDto[];
  diff_summary?: CreditPolicyDiffSummaryDto | null;
};

export type CreateCreditPolicyDraftRulePayload = {
  score_band: ScoreBandDto | null;
  pillar: string;
  field: string;
  operator: string;
  value: unknown;
  points: number | null;
  label: string;
  description: string | null;
  is_active: boolean;
  order_index: number | null;
};

export type UpdateCreditPolicyDraftRulePayload = Partial<CreateCreditPolicyDraftRulePayload>;
