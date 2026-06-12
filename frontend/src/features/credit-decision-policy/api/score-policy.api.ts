import { apiClient } from "@/shared/lib/http/http-client";

export type ScoreRangeDto = {
  id: number;
  policy_id: number;
  indicator_id: number;
  operator: string;
  threshold_value: string | number | null;
  threshold_value_to: string | number | null;
  score: string | number;
  label: string | null;
  sort_order: number;
  is_enabled: boolean;
};

export type ScoreIndicatorDto = {
  id: number;
  policy_id: number;
  subgroup_id: number;
  code: string;
  name: string;
  description: string | null;
  source_key: string;
  value_type: string;
  weight_percent: string | number;
  aggregation_method: string;
  missing_data_behavior: string;
  sort_order: number;
  is_enabled: boolean;
  score_ranges: ScoreRangeDto[];
  score_ranges_count: number;
};

export type ScoreSubgroupDto = {
  id: number;
  policy_id: number;
  pillar_id: number;
  code: string;
  name: string;
  description: string | null;
  weight_percent: string | number;
  sort_order: number;
  is_enabled: boolean;
  indicators: ScoreIndicatorDto[];
  indicators_count: number;
};

export type ScorePillarDto = {
  id: number;
  policy_id: number;
  code: string;
  name: string;
  description: string | null;
  weight_percent: string | number;
  sort_order: number;
  is_enabled: boolean;
  subgroups: ScoreSubgroupDto[];
  subgroups_count: number;
  indicators_count: number;
};

export type ScorePolicyDto = {
  id: number;
  code: string;
  name: string;
  version: number;
  status: string;
  description: string | null;
  source: string;
};

export type ScoreValidationCheckDto = {
  code: string;
  label: string;
  value: string | number;
  expected?: string | number;
  status: "valid" | "warning" | "invalid" | string;
  pillar_code?: string;
  subgroup_code?: string;
};

export type ScoreValidationIssueDto = {
  scope: string;
  code: string;
  severity?: "warning" | "error" | string;
  entity_type?: string;
  entity_code?: string;
  entity_name?: string;
  affected_count?: number;
  message: string;
};

export type ScoreValidationSummaryDto = {
  status: "valid" | "warning" | "invalid" | string;
  configuration_status: "incomplete" | "validated" | "invalid" | string;
  checks: ScoreValidationCheckDto[];
  errors: ScoreValidationIssueDto[];
  warnings: ScoreValidationIssueDto[];
};

export type ScorePolicyProgressDto = {
  pillars: { configured: number; expected: number };
  subgroups: { configured: number; expected: number };
  indicators: { configured: number; expected: number };
  indicators_with_ranges: { configured: number; expected: number };
  score_ranges_count: number;
};

export type ScorePillarRoadmapDto = {
  id: number | null;
  code: string;
  name: string;
  weight_percent: string | number;
  sort_order: number;
  status: "configured" | "partial" | "not_started";
  subgroups_count: number;
  indicators_count: number;
  indicators_with_ranges_count: number;
};

export type ScoreStructureDto = {
  policy: ScorePolicyDto;
  status: string;
  version: number;
  compiled_config_json: Record<string, unknown>;
  pillars: ScorePillarDto[];
  policy_progress: ScorePolicyProgressDto;
  pillar_roadmap: ScorePillarRoadmapDto[];
  validation_summary: ScoreValidationSummaryDto;
  governance: {
    active_policy_editable: boolean;
    simulation_persists_result: boolean;
    connected_to_official_engine: boolean;
    configurable_score_policy_enabled: boolean;
  };
};

export type PillarOneSimulationPayload = {
  coface_valid?: boolean;
  indicator_values?: Record<string, string | number | null>;
  analysis_id?: number | null;
};

export type PillarOneSimulationResultDto = {
  policy_id: number;
  pillar_code: string;
  pillar_name: string;
  score: string | number;
  weighted_score: string | number;
  weight_percent: string | number;
  status: string;
  source: string;
  reason: string | null;
  subgroups: Array<{
    code: string;
    name: string;
    score: string | number;
    weight_percent: string | number;
    weighted_score: string | number;
    indicators: Array<Record<string, unknown>>;
  }>;
  indicators: Array<Record<string, unknown>>;
  calculation_trace: Array<Record<string, unknown>>;
  mapper_trace?: Array<Record<string, unknown>>;
  mapper_warnings?: Array<Record<string, unknown>>;
  warnings?: Array<Record<string, unknown>>;
  simulation?: Record<string, unknown>;
};

export type PillarTwoSimulationPayload = {
  requested_limit_amount: string | number | null;
  coface_coverage_amount?: string | number | null;
  coface_valid?: boolean | null;
};

export type PillarTwoSimulationIndicatorDto = {
  code: string;
  name: string;
  raw_value: string | number | null;
  raw_ratio: string | number | null;
  capped_ratio: string | number;
  score: string | number;
  weight_percent: string | number;
  weighted_score: string | number;
  matched_range: {
    operator: string;
    threshold_value: string | number;
    threshold_value_to: string | number | null;
    score: string | number;
    label: string | null;
  } | null;
};

export type PillarTwoSimulationResultDto = {
  policy_id: number;
  pillar_code: string;
  pillar_name: string;
  score: string | number;
  weighted_score: string | number;
  weight_percent: string | number;
  status: string;
  source: string;
  subgroups: Array<{
    code: string;
    name: string;
    score: string | number;
    weight_percent: string | number;
    weighted_score: string | number;
    indicators: PillarTwoSimulationIndicatorDto[];
  }>;
  indicators: PillarTwoSimulationIndicatorDto[];
  calculation_trace: Array<Record<string, unknown>>;
  future_guarantee_sources: string[];
  simulation?: Record<string, unknown>;
};

export type PillarFourSimulationPayload = {
  cnpj?: string | null;
  analysis_id?: number | null;
};

export type PillarFourSimulationIndicatorDto = {
  code: string;
  name: string;
  raw_value: string | number | null;
  status: string;
  reason: string | null;
  score: string | number;
  weight_percent: string | number;
  weighted_score: string | number;
  matched_range: {
    operator: string;
    threshold_value: string | number;
    threshold_value_to: string | number | null;
    score: string | number;
    label: string | null;
  } | null;
};

export type PillarFourSimulationResultDto = {
  policy_id: number;
  analysis_id: number | null;
  cnpj_normalized: string | null;
  pillar_code: string;
  pillar_name: string;
  score: string | number;
  weighted_score: string | number;
  weight_percent: string | number;
  status: string;
  source: string;
  reason: string | null;
  subgroups: Array<{
    code: string;
    name: string;
    status: string;
    reason: string | null;
    score: string | number;
    weight_percent: string | number;
    weighted_score: string | number;
    rebalanced_weight_percent: string | number;
    rebalanced_weighted_score: string | number;
    indicators: PillarFourSimulationIndicatorDto[];
  }>;
  indicators: PillarFourSimulationIndicatorDto[];
  current_position: {
    import_run_id: number;
    base_date: string;
    total_exposure_amount: string | number;
    overdue_amount: string | number;
    raw_overdue_amount: string | number;
    effective_overdue_amount: string | number;
    overdue_ratio: string | number | null;
    rows_count: number;
  } | null;
  snapshots_used_count: number;
  snapshot_dates_used: string[];
  weight_rebalanced: boolean;
  available_weight: string | number;
  ignored_weight: string | number;
  ignored_subgroups: string[];
  warnings: Array<Record<string, unknown>>;
  calculation_trace: Array<Record<string, unknown>>;
  simulation?: Record<string, unknown>;
};

export type PillarFiveSimulationPayload = {
  cnpj?: string | null;
  analysis_id?: number | null;
};

export type PillarFiveSimulationResultDto = {
  policy_id: number;
  analysis_id: number | null;
  cnpj_normalized: string | null;
  pillar_code: string;
  pillar_name: string;
  score: string | number;
  weighted_score: string | number;
  weight_percent: string | number;
  status: string;
  source: string;
  reason: string;
  relationship_level: number;
  relationship_label: string;
  subgroups: Array<{
    code: string;
    name: string;
    score: string | number;
    weight_percent: string | number;
    weighted_score: string | number;
    indicators: Array<{
      code: string;
      name: string;
      raw_value: string | number;
      score: string | number;
      weight_percent: string | number;
      weighted_score: string | number;
      matched_range: {
        operator: string;
        threshold_value: string | number;
        threshold_value_to: string | number | null;
        score: string | number;
        label: string | null;
      } | null;
    }>;
  }>;
  indicators: Array<Record<string, unknown>>;
  relationship_evidence: {
    has_current_approved_limit: boolean;
    current_approved_limit: string | number;
    current_approved_limit_source: string | null;
    has_current_exposure: boolean;
    current_exposure_amount: string | number;
    current_exposure_source: string | null;
    has_portfolio_presence: boolean;
    portfolio_sources_found: string[];
    current_import_run_id: number | null;
  };
  warnings: Array<Record<string, unknown>>;
  calculation_trace: string[];
  simulation?: Record<string, unknown>;
};

export function getCurrentScoreStructure() {
  return apiClient.get<ScoreStructureDto>("/api/admin/credit-decision-policies/current-score-structure");
}

export function simulatePillarOneScore(policyId: number, payload: PillarOneSimulationPayload) {
  return apiClient.post<PillarOneSimulationResultDto, PillarOneSimulationPayload>(
    `/api/admin/credit-decision-policies/${policyId}/score-simulation/pillar-one`,
    payload
  );
}

export function simulatePillarTwoScore(policyId: number, payload: PillarTwoSimulationPayload) {
  return apiClient.post<PillarTwoSimulationResultDto, PillarTwoSimulationPayload>(
    `/api/admin/credit-decision-policies/${policyId}/score-simulation/pillar-two`,
    payload
  );
}

export function simulatePillarFourScore(policyId: number, payload: PillarFourSimulationPayload) {
  return apiClient.post<PillarFourSimulationResultDto, PillarFourSimulationPayload>(
    `/api/admin/credit-decision-policies/${policyId}/score-simulation/pillar-four`,
    payload
  );
}

export function simulatePillarFiveScore(policyId: number, payload: PillarFiveSimulationPayload) {
  return apiClient.post<PillarFiveSimulationResultDto, PillarFiveSimulationPayload>(
    `/api/admin/credit-decision-policies/${policyId}/score-simulation/pillar-five`,
    payload
  );
}
