"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { AnalysisDetailCards } from "@/features/credit-analyses/components/analysis-detail-cards";
import { AnalysisDetailSkeleton } from "@/features/credit-analyses/components/analysis-detail-skeleton";
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
        <Link
          href="/analises"
          className="inline-flex items-center gap-2 rounded-[6px] border border-[#d1d5db] bg-white px-3 py-1.5 text-[12px] text-[#374151] hover:bg-[#f9fafb]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Voltar para a lista
        </Link>
        <ErrorState
          title="Não foi possível carregar o detalhe da análise"
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
        title="Análise indisponível"
        description="Não foi possível encontrar os dados desta análise no momento."
      />
    );
  }

  return (
    <div className="space-y-4">
      <Link
        href="/analises"
        className="inline-flex items-center gap-2 rounded-[6px] border border-[#d1d5db] bg-white px-3 py-1.5 text-[12px] text-[#374151] hover:bg-[#f9fafb]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Voltar para a lista
      </Link>

      <AnalysisDetailCards data={data} />
    </div>
  );
}