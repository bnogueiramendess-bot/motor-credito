"use client";

import Link from "next/link";

import { AnalysisListCards } from "@/features/credit-analyses/components/analysis-list-cards";
import { AnalysisListSkeleton } from "@/features/credit-analyses/components/analysis-list-skeleton";
import { useCreditAnalysesQuery } from "@/features/credit-analyses/hooks/use-credit-analyses-query";
import { EmptyState } from "@/shared/components/states/empty-state";
import { ErrorState } from "@/shared/components/states/error-state";

export function AnalysesPageView() {
  const analysesQuery = useCreditAnalysesQuery();

  if (analysesQuery.isLoading) {
    return <AnalysisListSkeleton />;
  }

  if (analysesQuery.isError) {
    return (
      <ErrorState
        title="Não foi possível carregar as análises"
        description={analysesQuery.error.message}
        onRetry={() => analysesQuery.refetch()}
      />
    );
  }

  const analyses = analysesQuery.data ?? [];

  if (!analyses.length) {
    return (
      <EmptyState
        title="Nenhuma análise encontrada"
        description="Quando houver análises registradas no backend, elas aparecerão aqui automaticamente."
      />
    );
  }

  return (
    <div className="readability-standard space-y-4">
      <div className="flex justify-end">
        <Link
          href="/analises/nova"
          className="inline-flex h-9 items-center rounded-[6px] bg-[#1a2b5e] px-3 text-[12px] font-medium text-white hover:bg-[#233a7d]"
        >
          Nova análise de crédito
        </Link>
      </div>
      <AnalysisListCards analyses={analyses} />
    </div>
  );
}
