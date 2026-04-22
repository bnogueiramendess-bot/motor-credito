export type AnalysisStatus = "created" | "in_progress" | "completed";
export type MotorResult = "approved" | "rejected" | "manual_review";
export type FinalDecision = "approved" | "rejected" | "manual_review";
export type ActorType = "system" | "user";
export type ScoreBand = "A" | "B" | "C" | "D";

export type ExplainabilityRuleItemDto = {
  rule_id: number | null;
  label: string;
  pillar: string | null;
  score_band: ScoreBand | null;
  field: string | null;
  operator: string | null;
  expected_value: unknown;
  actual_value: unknown;
  matched: boolean;
  impact_points?: number;
  impact_type: string;
  reason: string;
};

export type ScoreExplainabilitySummaryDto = {
  base_score: number;
  final_score: number;
  score_band: ScoreBand;
  evaluated_rules: number;
  matched_rules: number;
  not_matched_rules: number;
  total_impact_points: number;
};

export type ScoreExplainabilityDto = {
  policy: {
    policy_id: number;
    policy_name: string;
    policy_version: number;
    policy_status: string;
    published_at: string | null;
  };
  score_summary: ScoreExplainabilitySummaryDto;
  rules_evaluated: ExplainabilityRuleItemDto[];
};

export type DecisionExplainabilitySummaryDto = {
  evaluated_rules: number;
  matched_rules: number;
  not_matched_rules: number;
  motor_result: MotorResult;
  suggested_limit: string;
  executive_reason: string;
};

export type DecisionExplainabilityDto = {
  policy: {
    policy_id: number;
    policy_name: string;
    policy_version: number;
    policy_status: string;
    published_at: string | null;
  };
  decision_summary: DecisionExplainabilitySummaryDto;
  rules_evaluated: ExplainabilityRuleItemDto[];
  score_explainability: ScoreExplainabilityDto | null;
};

export type ScoreCalculationMemoryDto = {
  base_score: number;
  applied_adjustments: Array<{
    reason: string;
    points: number;
    detail: string;
  }>;
  final_score: number;
  score_band: ScoreBand;
  source_entry_id: number;
  source_type: string;
  summary: string;
  explainability?: ScoreExplainabilityDto;
};

export type DecisionMemoryDto = {
  score_band: ScoreBand;
  score_final: number;
  source_entry_id: number;
  source_type: string;
  revenue_basis_type: string;
  revenue_basis_value: string;
  indebtedness_ratio: string | null;
  requested_limit: string;
  band_limit_cap: string;
  suggested_limit: string;
  motor_result: MotorResult;
  reasons: string[];
  summary: string;
  explainability?: DecisionExplainabilityDto;
};

export type CustomerDto = {
  id: number;
  company_name: string;
  document_number: string;
  segment: string;
  region: string;
  relationship_start_date: string | null;
  created_at: string;
  updated_at: string;
};

export type CreditAnalysisDto = {
  id: number;
  protocol_number: string;
  customer_id: number;
  requested_limit: number | string;
  current_limit: number | string;
  exposure_amount: number | string;
  annual_revenue_estimated: number | string;
  analysis_status: AnalysisStatus;
  motor_result: MotorResult | null;
  final_decision: FinalDecision | null;
  suggested_limit: number | string | null;
  final_limit: number | string | null;
  analyst_notes: string | null;
  decision_memory_json: Record<string, unknown> | null;
  decision_calculated_at: string | null;
  assigned_analyst_name: string | null;
  created_at: string;
  completed_at: string | null;
};

export type DecisionEventDto = {
  id: number;
  credit_analysis_id: number;
  event_type: string;
  actor_type: ActorType;
  actor_name: string;
  description: string;
  event_payload_json: Record<string, unknown> | null;
  created_at: string;
};

export type ScoreResultDto = {
  id: number;
  credit_analysis_id: number;
  base_score: number;
  final_score: number;
  score_band: ScoreBand;
  calculation_memory_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type DecisionResultDto = {
  analysis_id: number;
  motor_result: MotorResult;
  suggested_limit: number | string;
  decision_memory_json: Record<string, unknown>;
  decision_calculated_at: string;
};

export type FinalDecisionResultDto = {
  analysis_id: number;
  final_decision: FinalDecision;
  final_limit: number | string | null;
  analyst_name: string | null;
  analyst_notes: string | null;
  completed_at: string | null;
};

export type CreditAnalysisListItemDto = CreditAnalysisDto & {
  customer: CustomerDto | null;
  score: ScoreResultDto | null;
};

export type CreditAnalysisListApiResponse = CreditAnalysisListItemDto[];

export type CreditAnalysisDetailApiResponse = {
  analysis: CreditAnalysisDto;
  customer: CustomerDto | null;
  score: ScoreResultDto | null;
  decision: DecisionResultDto | null;
  final_decision: FinalDecisionResultDto | null;
  events: DecisionEventDto[];
};
