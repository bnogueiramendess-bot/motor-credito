export type AnalysisStatus = "created" | "in_progress" | "completed";
export type MotorResult = "approved" | "rejected" | "manual_review";
export type FinalDecision = "approved" | "rejected" | "manual_review";
export type ActorType = "system" | "user";
export type ScoreBand = "A" | "B" | "C" | "D";

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
