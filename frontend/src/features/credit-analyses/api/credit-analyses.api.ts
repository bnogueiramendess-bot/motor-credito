import { apiClient } from "@/shared/lib/http/http-client";

import {
  CreditAnalysisJourneyProgressUpdateRequest,
  CreditAnalysisWorkspaceStateUpdateRequest,
  CreditAnalysisQueueOptionsResponse,
  CreditAnalysisMonitorResponse,
  CreditAnalysisApprovalQueueResponse,
  WorkflowActionRequest,
  WorkflowActionResponse,
  CreditAnalysisOperationalQueueResponse,
  CreditAnalysisDetailApiResponse,
  CreditAnalysisListApiResponse
} from "@/features/credit-analyses/api/contracts";

export async function getCreditAnalyses() {
  return apiClient.get<CreditAnalysisListApiResponse>("/api/credit-analyses");
}

export type OperationalQueueParams = {
  q?: string;
  status?: string;
  bu?: string;
  analysis_type?: string;
  requester?: string;
  assigned_analyst?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
  page_size?: number;
  business_unit_context?: string;
};

export async function getCreditAnalysesQueue(params: OperationalQueueParams = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && `${value}`.trim() !== "") {
      qs.set(key, String(value));
    }
  });
  const suffix = qs.toString();
  return apiClient.get<CreditAnalysisOperationalQueueResponse>(`/api/credit-analyses/queue${suffix ? `?${suffix}` : ""}`);
}

export async function getCreditAnalysesQueueOptions(businessUnitContext?: string) {
  const suffix = businessUnitContext ? `?business_unit_context=${encodeURIComponent(businessUnitContext)}` : "";
  return apiClient.get<CreditAnalysisQueueOptionsResponse>(`/api/credit-analyses/queue/options${suffix}`);
}

export type MonitorParams = {
  q?: string;
  status_filter?: string;
  bu?: string;
  workflow_stage?: string;
  analysis_type?: string;
  requester?: string;
  assigned_analyst?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
  page_size?: number;
  business_unit_context?: string;
};

export async function getCreditAnalysesMonitor(params: MonitorParams = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && `${value}`.trim() !== "") {
      qs.set(key, String(value));
    }
  });
  const suffix = qs.toString();
  return apiClient.get<CreditAnalysisMonitorResponse>(`/api/credit-analyses/monitor${suffix ? `?${suffix}` : ""}`);
}

export type ApprovalQueueParams = {
  q?: string;
  status_filter?: string;
  bu?: string;
  doa?: string;
  current_step?: string;
  aging?: string;
  assigned_analyst?: string;
  page?: number;
  page_size?: number;
  business_unit_context?: string;
};

export async function getCreditAnalysesApprovalQueue(params: ApprovalQueueParams = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && `${value}`.trim() !== "") {
      qs.set(key, String(value));
    }
  });
  const suffix = qs.toString();
  return apiClient.get<CreditAnalysisApprovalQueueResponse>(`/api/credit-analyses/approval-queue${suffix ? `?${suffix}` : ""}`);
}

export async function getCreditAnalysesMonitorOptions(businessUnitContext?: string) {
  const suffix = businessUnitContext ? `?business_unit_context=${encodeURIComponent(businessUnitContext)}` : "";
  return apiClient.get<CreditAnalysisQueueOptionsResponse>(`/api/credit-analyses/monitor/options${suffix}`);
}

export async function getCreditAnalysisDetail(analysisId: number) {
  return apiClient.get<CreditAnalysisDetailApiResponse>(`/api/credit-analyses/${analysisId}/detail`);
}

export async function startCreditAnalysis(analysisId: number) {
  return apiClient.post(`/api/credit-analyses/${analysisId}/start`, {});
}

export async function executeCreditAnalysisWorkflowAction(analysisId: number, payload: WorkflowActionRequest) {
  return apiClient.post<WorkflowActionResponse, WorkflowActionRequest>(`/api/credit-analyses/${analysisId}/workflow-actions`, payload);
}

export async function calculateCreditAnalysisScore(analysisId: number) {
  return apiClient.post(`/api/credit-analyses/${analysisId}/score/calculate`, {});
}

export async function calculateCreditAnalysisDecision(analysisId: number) {
  return apiClient.post(`/api/credit-analyses/${analysisId}/decision/calculate`, {});
}

export async function updateCreditAnalysisJourneyProgress(
  analysisId: number,
  payload: CreditAnalysisJourneyProgressUpdateRequest
) {
  return apiClient.put(`/api/credit-analyses/${analysisId}/journey-progress`, payload);
}

export async function updateCreditAnalysisWorkspaceState(
  analysisId: number,
  payload: CreditAnalysisWorkspaceStateUpdateRequest
) {
  return apiClient.put(`/api/credit-analyses/${analysisId}/workspace-state`, payload);
}
