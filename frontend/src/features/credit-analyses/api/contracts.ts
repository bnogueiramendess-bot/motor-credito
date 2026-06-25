export type AnalysisStatus = "created" | "in_progress" | "in_approval" | "changes_requested" | "completed";
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
  current_journey_step?: number | null;
  last_completed_journey_step?: number | null;
  assigned_analyst_name: string | null;
  current_owner_user_id?: number | null;
  current_owner_role?: string | null;
  last_owner_user_id?: number | null;
  last_owner_role?: string | null;
  assigned_at?: string | null;
  claimed_at?: string | null;
  analysis_started_at?: string | null;
  current_stage_started_at?: string | null;
  submitted_for_approval_at?: string | null;
  approved_at?: string | null;
  rejected_at?: string | null;
  available_actions?: string[];
  technical_dossier_status?: {
    is_completed: boolean;
    missing_requirements: Array<{
      code: string;
      label: string;
      description: string;
    }>;
    display_message: string;
  } | null;
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

export type CreditAnalysisPolicyReferenceDto = {
  engine: "configurable_policy" | "legacy_policy" | string | null;
  policy_id: number | null;
  policy_code: string | null;
  policy_name: string | null;
  policy_version: number | null;
  captured_at: string | null;
  fallback_used: boolean;
  fallback_reason: string | null;
  display_label: string;
  status_label: string;
};

export type CreditAnalysisApprovalProgressItemDto = {
  role_code?: string | null;
  role_label: string;
  status: string;
  sequence_order?: number | null;
  round_number?: number | null;
  actor_name?: string | null;
  decided_at?: string | null;
  comment?: string | null;
};

export type CreditAnalysisMonitorItemDto = {
  item_type: "CREDIT_ANALYSIS";
  analysis_id: number;
  protocol: string;
  customer_name: string;
  cnpj: string | null;
  economic_group: string | null;
  business_unit: string | null;
  requester_name: string | null;
  assigned_analyst_name: string | null;
  current_owner_user_id: number | null;
  current_owner_role: string | null;
  approver_name: string | null;
  current_status: string;
  status_label: string;
  workflow_stage: "commercial_submitted" | "financial_review" | "pending_approval" | "decided" | "returned" | string;
  current_journey_step?: number | null;
  requested_limit: number | string | null;
  recommended_limit?: number | string | null;
  financial_impact?: number | string | null;
  suggested_limit: number | string | null;
  total_limit: number | string | null;
  approved_limit: number | string | null;
  is_new_customer: boolean;
  is_early_review_request: boolean;
  has_recent_analysis: boolean;
  created_at: string;
  updated_at: string;
  aging_days: number;
  stage_aging_days: number;
  next_responsible_role: "comercial" | "analista_financeiro" | "aprovador" | string;
  applicable_doa_code?: string | null;
  applicable_doa_range?: string | null;
  current_approval_step?: string | null;
  current_approval_step_code?: string | null;
  approval_round?: number | null;
  approval_progress?: CreditAnalysisApprovalProgressItemDto[];
  approval_escalated_to_committee?: boolean;
  approval_sla_label?: string | null;
  approval_started_at?: string | null;
  policy_reference: CreditAnalysisPolicyReferenceDto;
  available_actions: string[];
};

export type CreditPolicyApprovalQueueItemDto = {
  item_type: "CREDIT_POLICY";
  entity_id: number | null;
  entity_name: string;
  request_id: number;
  action_type: string;
  status: string;
  created_at: string;
  updated_at: string;
  available_actions: string[];
  protocol?: string | null;
  policy_name?: string | null;
  policy_code?: string | null;
  policy_version?: string | number | null;
  policy_type?: string | null;
  business_unit?: string | null;
  committee?: string | null;
  impacted_pillar?: string | null;
  requester_name?: string | null;
};

export type ApprovalQueueItemDto = CreditAnalysisMonitorItemDto | CreditPolicyApprovalQueueItemDto;

export type CreditAnalysisJourneyProgressUpdateRequest = {
  current_journey_step?: number | null;
  last_completed_journey_step?: number | null;
};

export type CreditAnalysisWorkspaceStateUpdateRequest = {
  analyst_notes?: string | null;
  workspace_state?: Record<string, unknown> | null;
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

export type CreditAnalysisApprovalQueueKpisDto = {
  total: number;
  awaiting_approval: number;
  overdue_sla: number;
  high_value: number;
  pending_my_action?: number;
  in_approval?: number;
  returned_for_adjustment?: number;
  rejected_today?: number;
};

export type CreditAnalysisApprovalQueueResponse = {
  items: ApprovalQueueItemDto[];
  kpis: CreditAnalysisApprovalQueueKpisDto;
  total: number;
  page: number;
  page_size: number;
};

export type CreditAnalysisApprovalFlowSummaryDto = {
  analysis_id: number;
  current_status: string;
  status_label: string;
  workflow_stage: string;
  applicable_doa_code?: string | null;
  applicable_doa_range?: string | null;
  available_actions: string[];
  current_owner_user_id?: number | null;
  current_owner_role?: string | null;
  submitted_for_approval_at?: string | null;
  approved_at?: string | null;
  rejected_at?: string | null;
  returned_for_revision_at?: string | null;
  last_decision_event_at?: string | null;
  completed_steps: string[];
  pending_steps: string[];
  required_approval_roles: string[];
  sequential_approval_mode: boolean;
  sequential_approval_note?: string | null;
  approval_flow_state: "not_submitted" | "in_approval" | "approved" | "rejected" | "request_changes" | string;
  flow_state?: "not_submitted" | "in_approval" | "approved" | "rejected" | "request_changes" | string;
  display_status: string;
  display_stage: string;
  decision_actor_name?: string | null;
  decision_actor_role?: string | null;
  predicted_doa_code?: string | null;
  predicted_doa_range?: string | null;
  matrix_amount?: number | string | null;
  decision_basis?: string | null;
  predicted_approvers: Array<{
    role: string;
    role_label: string;
    user_id?: number | null;
    user_name?: string | null;
    user_email?: string | null;
    sequence: number;
    status: "predicted" | "pending" | "approved" | "rejected" | string;
  }>;
  expected_approvers?: Array<Record<string, unknown>>;
  pending_approvers?: Array<Record<string, unknown>>;
  approved_approvers?: Array<Record<string, unknown>>;
  rejected_approvers?: Array<Record<string, unknown>>;
  returned_approvers?: Array<Record<string, unknown>>;
  events?: Array<{
    event_type: "submitted_for_approval" | "approved" | "rejected" | "request_changes" | string;
    timestamp?: string | null;
    actor_name?: string | null;
    actor_role?: string | null;
    comment?: string | null;
  }>;
  steps?: Array<{
    status: "not_submitted" | "submitted" | "pending" | "approved" | "rejected" | "request_changes" | string;
    label: string;
    timestamp?: string | null;
    actor_name?: string | null;
    actor_role?: string | null;
    comment?: string | null;
  }>;
  current_approval_step?: string | null;
  current_approval_step_code?: string | null;
  approval_round?: number | null;
  approval_progress?: CreditAnalysisApprovalProgressItemDto[];
  approval_rounds?: Array<{
    round_number: number;
    steps: CreditAnalysisApprovalProgressItemDto[];
    decisions: Array<{
      decision: string;
      role_code?: string | null;
      role_label: string;
      actor_name?: string | null;
      comment?: string | null;
      created_at?: string | null;
      round_number: number;
      sequence_order: number;
    }>;
  }>;
  approval_escalated_to_committee?: boolean;
  approval_sla_label?: string | null;
  approval_started_at?: string | null;
  committee_escalation?: {
    decision: string;
    role_code?: string | null;
    role_label: string;
    actor_name?: string | null;
    comment?: string | null;
    created_at?: string | null;
    round_number: number;
    sequence_order: number;
  } | null;
  decision_comments?: Array<{
    decision: string;
    role_code?: string | null;
    role_label: string;
    actor_name?: string | null;
    comment?: string | null;
    created_at?: string | null;
    round_number: number;
    sequence_order: number;
  }>;
  display_title: string;
  display_message: string;
};

export type WorkflowActionType =
  | "submit_approval"
  | "submit_for_approval"
  | "request_changes"
  | "escalate_to_committee"
  | "request_maintenance"
  | "return_to_analysis"
  | "finalize"
  | "approve"
  | "reject";

export type WorkflowActionRequest = {
  action: WorkflowActionType;
  justification?: string | null;
};

export type WorkflowActionResponse = {
  analysis_id: number;
  current_status: string;
  next_status: string;
  current_owner: string | null;
  next_owner: string | null;
  current_stage: string | null;
  next_stage: string | null;
  timeline_event: string;
  audit_event: string;
  available_actions: string[];
  workflow_context: Record<string, unknown>;
};

export type CreditAnalysisDetailApiResponse = {
  analysis: CreditAnalysisDto;
  customer: CustomerDto | null;
  score: ScoreResultDto | null;
  decision: DecisionResultDto | null;
  final_decision: FinalDecisionResultDto | null;
  events: DecisionEventDto[];
  approval_flow_summary: CreditAnalysisApprovalFlowSummaryDto | null;
};
