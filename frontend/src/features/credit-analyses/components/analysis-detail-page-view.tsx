"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { AnalysisDetailCards } from "@/features/credit-analyses/components/analysis-detail-cards";
import { AnalysisDetailSkeleton } from "@/features/credit-analyses/components/analysis-detail-skeleton";
import { AnalysisEventsTimeline } from "@/features/credit-analyses/components/analysis-events-timeline";
import { useCreditAnalysisDetailQuery } from "@/features/credit-analyses/hooks/use-credit-analysis-detail-query";
import { EmptyState } from "@/shared/components/states/empty-state";
import { ErrorState } from "@/shared/components/states/error-state";

type AnalysisDetailPageViewProps = {
  analysisId: number;
};

export function AnalysisDetailPageView({ analysisId }: AnalysisDetailPageViewProps) {
  const detailQuery = useCreditAnalysisDetailQuery(analysisId);

  if (detailQuery.isLoading) {
    return <AnalysisDetailSkeleton />;
  }

  if (detailQuery.isError) {
    return (
      <div className="space-y-4">
        <Link href="/analises" className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" />
          Voltar para a lista
        </Link>
        <ErrorState
          title="Nao foi possivel carregar o detalhe da analise"
          description={detailQuery.error.message}
          onRetry={() => detailQuery.refetch()}
        />
      </div>
    );
  }

  const { data } = detailQuery;
  if (!data) {
    return (
      <EmptyState
        title="Analise indisponivel"
        description="Nao foi possivel encontrar os dados desta analise no momento."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/analises" className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" />
          Voltar para a lista
        </Link>
      </div>
      <AnalysisDetailCards data={data} />
      <AnalysisEventsTimeline events={data.events} />
    </div>
  );
}
