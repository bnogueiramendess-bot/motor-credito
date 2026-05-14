"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { AnalysisQueueCard } from "@/features/credit-analyses/components/analysis-queue-card";
import { AnalysisListSkeleton } from "@/features/credit-analyses/components/analysis-list-skeleton";
import { OperationalFilters } from "@/features/credit-analyses/components/operational-filters";
import { OperationalKpis } from "@/features/credit-analyses/components/operational-kpis";
import { useCreditAnalysesQueueQuery } from "@/features/credit-analyses/hooks/use-credit-analyses-queue-query";
import { useCreditAnalysesQueueOptionsQuery } from "@/features/credit-analyses/hooks/use-credit-analyses-queue-options-query";
import { EmptyState } from "@/shared/components/states/empty-state";
import { ErrorState } from "@/shared/components/states/error-state";
import { PermissionDeniedState } from "@/shared/components/states/permission-denied-state";
import { getEffectivePermissions, hasPermission } from "@/shared/lib/auth/permissions";

export function AnalysesPageView() {
  const [permissions] = useState<string[]>(() => getEffectivePermissions());
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

  const hasQueuePermission = hasPermission("credit.requests.view", permissions);
  const canCreateRequest = hasPermission("credit.request.create", permissions);

  if (queueQuery.isLoading) {
    return <AnalysisListSkeleton />;
  }

  if (queueQuery.isError) {
    return (
      <ErrorState
        title="NÃ£o foi possÃ­vel carregar a fila de anÃ¡lise financeira"
        description={queueQuery.error.message}
        onRetry={() => queueQuery.refetch()}
      />
    );
  }

  if (!hasQueuePermission) {
    return <PermissionDeniedState />;
  }

  const queue = queueQuery.data;
  const items = queue?.items ?? [];
  if (!items.length) {
    return (
      <div className="space-y-4">
        <div className="rounded-[14px] border border-[#D7E1EC] bg-white px-5 py-4">
          <p className="text-[22px] font-semibold text-[#102033]">AnÃ¡lise Financeira</p>
          <p className="text-[13px] text-[#4F647A]">Gerencie solicitaÃ§Ãµes de crÃ©dito, valide informaÃ§Ãµes financeiras e encaminhe anÃ¡lises para aprovaÃ§Ã£o.</p>
        </div>
        <OperationalFilters value={filters} onChange={setFilters} options={optionsQuery.data ?? null} isLoadingOptions={optionsQuery.isLoading} isErrorOptions={optionsQuery.isError} />
        <EmptyState
          title="Nenhuma solicitaÃ§Ã£o encontrada na fila operacional"
          description="Ajuste os filtros ou aguarde novas submissÃµes para iniciar anÃ¡lises."
        />
      </div>
    );
  }

  return (
    <div className="readability-standard space-y-5">
      <div className="rounded-[14px] border border-[#D7E1EC] bg-white px-5 py-4">
        <p className="text-[22px] font-semibold text-[#102033]">AnÃ¡lise Financeira</p>
        <p className="text-[13px] text-[#4F647A]">Gerencie solicitaÃ§Ãµes de crÃ©dito, valide informaÃ§Ãµes financeiras e encaminhe anÃ¡lises para aprovaÃ§Ã£o.</p>
      </div>
      {queue ? <OperationalKpis data={queue} /> : null}
      <OperationalFilters value={filters} onChange={setFilters} options={optionsQuery.data ?? null} isLoadingOptions={optionsQuery.isLoading} isErrorOptions={optionsQuery.isError} />
      <div className="flex justify-between">
        <p className="text-[12px] text-[#4F647A]">Fila operacional â€¢ {queue?.total ?? items.length} solicitaÃ§Ãµes</p>
        {canCreateRequest ? (
          <Link
            href="/analises/nova"
            className="inline-flex h-9 items-center rounded-[6px] bg-[#1a2b5e] px-3 text-[12px] font-medium text-white hover:bg-[#233a7d]"
          >
            Nova solicitaÃ§Ã£o de crÃ©dito
          </Link>
        ) : null}
      </div>
      <div className="space-y-3">
        {items.map((item) => (
          <AnalysisQueueCard key={item.analysis_id} item={item} />
        ))}
      </div>
    </div>
  );
}
