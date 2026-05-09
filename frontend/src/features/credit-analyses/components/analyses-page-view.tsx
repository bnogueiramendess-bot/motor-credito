"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { AnalysisQueueCard } from "@/features/credit-analyses/components/analysis-queue-card";
import { AnalysisListSkeleton } from "@/features/credit-analyses/components/analysis-list-skeleton";
import { OperationalFilters } from "@/features/credit-analyses/components/operational-filters";
import { OperationalKpis } from "@/features/credit-analyses/components/operational-kpis";
import { useCreditAnalysesQueueQuery } from "@/features/credit-analyses/hooks/use-credit-analyses-queue-query";
import { useCreditAnalysesQueueOptionsQuery } from "@/features/credit-analyses/hooks/use-credit-analyses-queue-options-query";
import { EmptyState } from "@/shared/components/states/empty-state";
import { ErrorState } from "@/shared/components/states/error-state";

export function AnalysesPageView() {
  const [permissions, setPermissions] = useState<string[]>([]);
  const [filters, setFilters] = useState({
    q: "",
    status: "",
    bu: "",
    analysis_type: "",
    requester: "",
    assigned_analyst: "",
    date_from: "",
    date_to: ""
  });
  const queueParams = useMemo(() => ({ ...filters, page: 1, page_size: 50 }), [filters]);
  const queueQuery = useCreditAnalysesQueueQuery(queueParams);
  const optionsQuery = useCreditAnalysesQueueOptionsQuery();

  useEffect(() => {
    const cookie = document.cookie.split("; ").find((item) => item.startsWith("gcc_permissions="));
    if (!cookie) return;
    try {
      setPermissions(JSON.parse(decodeURIComponent(cookie.split("=")[1] ?? "")) as string[]);
    } catch {
      setPermissions([]);
    }
  }, []);

  const hasQueuePermission =
    permissions.length === 0 ||
    permissions.includes("credit.requests.view") ||
    permissions.includes("credit_request_validate");

  if (queueQuery.isLoading) {
    return <AnalysisListSkeleton />;
  }

  if (queueQuery.isError) {
    return (
      <ErrorState
        title="Não foi possível carregar a fila de análise financeira"
        description={queueQuery.error.message}
        onRetry={() => queueQuery.refetch()}
      />
    );
  }

  if (!hasQueuePermission) {
    return (
      <EmptyState
        title="Sem permissão para acessar a fila operacional"
        description="Você não possui permissão para visualizar solicitações de crédito."
      />
    );
  }

  const queue = queueQuery.data;
  const items = queue?.items ?? [];
  if (!items.length) {
    return (
      <div className="space-y-4">
        <div className="rounded-[14px] border border-[#D7E1EC] bg-white px-5 py-4">
          <p className="text-[22px] font-semibold text-[#102033]">Análise Financeira</p>
          <p className="text-[13px] text-[#4F647A]">Gerencie solicitações de crédito, valide informações financeiras e encaminhe análises para aprovação.</p>
        </div>
        <OperationalFilters value={filters} onChange={setFilters} options={optionsQuery.data ?? null} isLoadingOptions={optionsQuery.isLoading} isErrorOptions={optionsQuery.isError} />
        <EmptyState
          title="Nenhuma solicitação encontrada na fila operacional"
          description="Ajuste os filtros ou aguarde novas submissões para iniciar análises."
        />
      </div>
    );
  }

  return (
    <div className="readability-standard space-y-5">
      <div className="rounded-[14px] border border-[#D7E1EC] bg-white px-5 py-4">
        <p className="text-[22px] font-semibold text-[#102033]">Análise Financeira</p>
        <p className="text-[13px] text-[#4F647A]">Gerencie solicitações de crédito, valide informações financeiras e encaminhe análises para aprovação.</p>
      </div>
      {queue ? <OperationalKpis data={queue} /> : null}
      <OperationalFilters value={filters} onChange={setFilters} options={optionsQuery.data ?? null} isLoadingOptions={optionsQuery.isLoading} isErrorOptions={optionsQuery.isError} />
      <div className="flex justify-between">
        <p className="text-[12px] text-[#4F647A]">Fila operacional • {queue?.total ?? items.length} solicitações</p>
        <Link
          href="/analises/nova"
          className="inline-flex h-9 items-center rounded-[6px] bg-[#1a2b5e] px-3 text-[12px] font-medium text-white hover:bg-[#233a7d]"
        >
          Nova solicitação de crédito
        </Link>
      </div>
      <div className="space-y-3">
        {items.map((item) => (
          <AnalysisQueueCard key={item.analysis_id} item={item} />
        ))}
      </div>
    </div>
  );
}
