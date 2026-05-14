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

export type OperationalQueueItemDto = {
  analysis_id: number;
  analysis_code: string;
  customer_name: string;
  cnpj: string | null;
  economic_group: string | null;
  business_unit: string | null;
  suggested_limit: number | string | null;
  available_limit: number | string | null;
  total_limit: number | string | null;
  open_amount: number | string | null;
  has_recent_analysis: boolean;
  is_early_review_request: boolean;
  early_review_justification: string | null;
  previous_analysis_id: number | null;
  requester_name: string | null;
  assigned_analyst_name: string | null;
  created_at: string;
  current_status: string;
  aging_days: number;
  coface_status: string;
  agrisk_status: string;
  analysis_type: "cliente_carteira" | "novo_cliente" | "revisao_antecipada" | string;
  has_analysis_recent_badge: boolean;
};

export type OperationalQueueKpisDto = {
  awaiting_analysis: number;
  early_reviews: number;
  new_customers: number;
  awaiting_reports: number;
  pending_approval: number;
  total_in_analysis: number;
};

export type CreditAnalysisOperationalQueueResponse = {
  items: OperationalQueueItemDto[];
  kpis: OperationalQueueKpisDto;
  total: number;
  page: number;
  page_size: number;
};

export type QueueOptionDto = {
  value: string;
  label: string;
};

export type CreditAnalysisQueueOptionsResponse = {
  statuses: QueueOptionDto[];
  business_units: QueueOptionDto[];
  analysis_types: QueueOptionDto[];
  requesters: QueueOptionDto[];
  analysts: QueueOptionDto[];
};

export type CreditAnalysisMonitorItemDto = {
  analysis_id: number;
  protocol: string;
  customer_name: string;
  cnpj: string | null;
  economic_group: string | null;
  business_unit: string | null;
  requester_name: string | null;
  assigned_analyst_name: string | null;
  approver_name: string | null;
  current_status: string;
  status_label: string;
  workflow_stage: "commercial_submitted" | "financial_review" | "pending_approval" | "decided" | "returned" | string;
  suggested_limit: number | string | null;
  total_limit: number | string | null;
  approved_limit: number | string | null;
  is_new_customer: boolean;
  is_early_review_request: boolean;
  has_recent_analysis: boolean;
  created_at: string;
  updated_at: string;
  aging_days: number;
  next_responsible_role: "comercial" | "analista_financeiro" | "aprovador" | string;
  available_actions: string[];
};

export type CreditAnalysisMonitorKpisDto = {
  total: number;
  awaiting_financial_review: number;
  in_analysis: number;
  awaiting_approval: number;
  returned_for_adjustment: number;
  completed: number;
  early_reviews: number;
};

export type CreditAnalysisMonitorResponse = {
  items: CreditAnalysisMonitorItemDto[];
  kpis: CreditAnalysisMonitorKpisDto;
  total: number;
  page: number;
  page_size: number;
};

export type CreditAnalysisDetailApiResponse = {
  analysis: CreditAnalysisDto;
  customer: CustomerDto | null;
  score: ScoreResultDto | null;
  decision: DecisionResultDto | null;
  final_decision: FinalDecisionResultDto | null;
  events: DecisionEventDto[];
};
