"use client";

import { useQuery } from "@tanstack/react-query";

import { getBusinessUnitContext } from "@/features/business-units/api/business-unit-context.api";

export function useBusinessUnitContextQuery() {
  return useQuery({
    queryKey: ["business-unit-context"],
    queryFn: getBusinessUnitContext
  });
}
