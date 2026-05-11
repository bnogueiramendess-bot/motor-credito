"use client";

import { useQuery } from "@tanstack/react-query";

import { getCreditAnalysesMonitor, getCreditAnalysesMonitorOptions, MonitorParams } from "@/features/credit-analyses/api/credit-analyses.api";

export function useCreditAnalysesMonitorQuery(params: MonitorParams) {
  return useQuery({
    queryKey: ["credit-analyses-monitor", params],
    queryFn: () => getCreditAnalysesMonitor(params)
  });
}

export function useCreditAnalysesMonitorOptionsQuery(businessUnitContext?: string) {
  return useQuery({
    queryKey: ["credit-analyses-monitor-options", businessUnitContext ?? "default"],
    queryFn: () => getCreditAnalysesMonitorOptions(businessUnitContext)
  });
}
