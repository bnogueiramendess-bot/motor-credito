"use client";

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
        title="Nao foi possivel carregar as analises"
        description={analysesQuery.error.message}
        onRetry={() => analysesQuery.refetch()}
      />
    );
  }

  const analyses = analysesQuery.data ?? [];

  if (!analyses.length) {
    return (
      <EmptyState
        title="Nenhuma analise encontrada"
        description="Quando houver analises registradas no backend, elas aparecerao aqui automaticamente."
      />
    );
  }

  return <AnalysisListCards analyses={analyses} />;
}
