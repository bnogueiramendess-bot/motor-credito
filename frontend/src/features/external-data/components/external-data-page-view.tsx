"use client";

import Link from "next/link";
import { ArrowLeft, Info } from "lucide-react";

import { ExternalDataFindings } from "@/features/external-data/components/external-data-findings";
import { ExternalDataHeader } from "@/features/external-data/components/external-data-header";
import { ExternalDataKpis } from "@/features/external-data/components/external-data-kpis";
import { ExternalDataSkeleton } from "@/features/external-data/components/external-data-skeleton";
import { ExternalDataSourceDetails } from "@/features/external-data/components/external-data-source-details";
import { ExternalDataSourcesTable } from "@/features/external-data/components/external-data-sources-table";
import { ExternalDataTimeline } from "@/features/external-data/components/external-data-timeline";
import { useExternalDataDashboardQuery } from "@/features/external-data/hooks/use-external-data-dashboard-query";
import { mapExternalDataDashboard } from "@/features/external-data/utils/external-data-view-models";
import { EmptyState } from "@/shared/components/states/empty-state";
import { ErrorState } from "@/shared/components/states/error-state";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";

type ExternalDataPageViewProps = {
  analysisId: number | null;
};

export function ExternalDataPageView({ analysisId }: ExternalDataPageViewProps) {
  const dashboardQuery = useExternalDataDashboardQuery(analysisId);

  if (!analysisId) {
    return (
      <EmptyState
        title="Selecione uma analise"
        description="Acesse esta tela com o parametro analysisId, por exemplo: /dados-externos?analysisId=1."
      />
    );
  }

  if (dashboardQuery.isLoading) {
    return <ExternalDataSkeleton />;
  }

  if (dashboardQuery.isError) {
    return (
      <div className="space-y-4">
        <Link
          href="/analises"
          className="inline-flex items-center gap-2 rounded-[6px] border border-[#d1d5db] bg-white px-3 py-1.5 text-[12px] text-[#374151] hover:bg-[#f9fafb]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Voltar para analises
        </Link>
        <ErrorState
          title="Nao foi possivel carregar os dados externos"
          description={dashboardQuery.error.message}
          onRetry={() => dashboardQuery.refetch()}
        />
      </div>
    );
  }

  const payload = dashboardQuery.data;
  if (!payload) {
    return (
      <EmptyState
        title="Dados externos indisponiveis"
        description="Nao foi possivel encontrar os dados da analise informada."
      />
    );
  }

  const viewModel = mapExternalDataDashboard(payload);

  if (!viewModel.sources.length) {
    return (
      <div className="space-y-4">
        <ExternalDataHeader analysis={viewModel.analysis} customer={viewModel.customer} />
        <EmptyState
          title="Nenhuma consulta externa registrada"
          description="Quando o backend registrar fontes para esta analise, os dados aparecerao aqui."
        />
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <ExternalDataHeader analysis={viewModel.analysis} customer={viewModel.customer} />
      <ExternalDataKpis items={viewModel.kpis} />

      {viewModel.partialDataCount > 0 ? (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Dados parciais em fontes consultadas</AlertTitle>
          <AlertDescription>{viewModel.partialDataCount} fonte(s) possuem campos nao informados no retorno.</AlertDescription>
        </Alert>
      ) : null}

      <ExternalDataSourcesTable sources={viewModel.sources} />
      <ExternalDataFindings findings={viewModel.findings} />
      <ExternalDataSourceDetails sources={viewModel.sources} />
      <ExternalDataTimeline events={viewModel.events} />
    </section>
  );
}
