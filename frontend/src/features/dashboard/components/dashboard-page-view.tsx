"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { BusinessUnitContextSelector } from "@/features/business-units/components/business-unit-context-selector";
import { useBusinessUnitContextQuery } from "@/features/business-units/hooks/use-business-unit-context-query";
import { toNumber } from "@/features/credit-analyses/utils/formatters";
import { PortfolioRiskSection } from "@/features/dashboard/components/portfolio-risk-section";
import { formatCurrencyInThousands } from "@/features/dashboard/utils/dashboard-formatters";
import { PortfolioMovementDto } from "@/features/portfolio/api/contracts";
import { usePortfolioAgingLatestQuery } from "@/features/portfolio/hooks/use-portfolio-aging-latest-query";
import { usePortfolioAgingMovementsLatestQuery } from "@/features/portfolio/hooks/use-portfolio-aging-movements-latest-query";
import { usePortfolioSnapshotsQuery } from "@/features/portfolio/hooks/use-portfolio-snapshots-query";
import { OperationalContextBar } from "@/shared/components/layout/operational-context-bar";
import { EmptyState } from "@/shared/components/states/empty-state";
import { ErrorState } from "@/shared/components/states/error-state";
import { PermissionDeniedState } from "@/shared/components/states/permission-denied-state";
import { getEffectivePermissions, hasPermission } from "@/shared/lib/auth/permissions";
import { openAgingImportDrawer } from "@/shared/lib/events";
import { cn } from "@/shared/lib/utils";

type DashboardPageViewProps = {
  context?: "clientes" | "motor-credito";
};

type BucketStackValue = { bu: string; amount: number };
type BucketStack = { bucket: string; values: BucketStackValue[] };
type BucketStackMap = { not_due: BucketStack[]; overdue: BucketStack[] };
type AgingSide = "not_due" | "overdue";
type AgingBucketsByBuPayload = Array<{ bucket: string; values: Array<{ bu: string; amount: number | string }> }>;

const percentFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
});

function formatPercent(value: number) {
  return `${percentFormatter.format(value)}%`;
}

function formatSharePercent(value: number) {
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) < 0.05) {
    return `${rounded}%`;
  }
  return `${value.toFixed(1).replace(".", ",")}%`;
}

function asMoney(value: number | null) {
  return value ?? 0;
}

const BU_COLORS: Record<string, string> = {
  Additive: "#0F1E3A",
  Fertilizer: "rgba(15, 30, 58, 0.70)",
  "Additive Intl": "rgba(15, 30, 58, 0.50)",
  "Não informado": "rgba(15, 30, 58, 0.25)"
};
const DEFAULT_BU_ORDER = ["Additive", "Fertilizer", "Additive Intl", "Não informado"] as const;
const FIXED_BUCKETS = ["1-30", "31-60", "61-90", "91-120", "121-180", "Above 180"] as const;

function bucketAlias(rawBucket: string): string {
  const value = rawBucket.trim().toLowerCase();
  if (value.includes("1-30")) return "1-30";
  if (value.includes("31-60")) return "31-60";
  if (value.includes("61-90")) return "61-90";
  if (value.includes("91-120")) return "91-120";
  if (value.includes("121-180")) return "121-180";
  if (value.includes("181-360") || value.includes("above 360") || value.includes("360+")) return "Above 180";
  if (value.includes("above 180")) return "Above 180";
  return rawBucket;
}

function resolveBuSeriesOrder(notDueBuckets: AgingBucketsByBuPayload | undefined, overdueBuckets: AgingBucketsByBuPayload | undefined): string[] {
  const seen = new Set<string>();
  const register = (rawBu: string | undefined) => {
    if (!rawBu) return;
    const bu = rawBu.trim();
    if (!bu) return;
    seen.add(bu in BU_COLORS ? bu : "Não informado");
  };

  for (const section of [notDueBuckets, overdueBuckets]) {
    if (!Array.isArray(section)) continue;
    for (const bucket of section) {
      for (const value of bucket.values ?? []) {
        if ((toNumber(value.amount) ?? 0) > 0) {
          register(value.bu);
        }
      }
    }
  }

  const scoped = DEFAULT_BU_ORDER.filter((bu) => seen.has(bu));
  const extras = Array.from(seen).filter((bu) => !DEFAULT_BU_ORDER.includes(bu as (typeof DEFAULT_BU_ORDER)[number])).sort((a, b) => a.localeCompare(b, "pt-BR"));
  return [...scoped, ...extras];
}

function normalizeBucketsByBuFromBackend(
  buckets: AgingBucketsByBuPayload | undefined,
  side: AgingSide,
  buOrder: string[]
): BucketStack[] {
  const bucketMap = new Map<string, Record<string, number>>();
  for (const fixedBucket of FIXED_BUCKETS) {
    bucketMap.set(fixedBucket, Object.fromEntries(buOrder.map((bu) => [bu, 0])));
  }

  if (Array.isArray(buckets)) {
    for (const bucket of buckets) {
      const canonicalBucket = bucketAlias(bucket.bucket);
      if (!bucketMap.has(canonicalBucket)) continue;
      const current = bucketMap.get(canonicalBucket)!;
      for (const value of bucket.values ?? []) {
        const amount = toNumber(value.amount) ?? 0;
        const bu = value.bu in BU_COLORS ? value.bu : "Não informado";
        if (!(bu in current)) {
          current[bu] = 0;
        }
        current[bu] = (current[bu] ?? 0) + amount;
      }
    }
  }

  return FIXED_BUCKETS.map((bucket) => ({
    bucket,
    values: buOrder.map((bu) => ({ bu, amount: bucketMap.get(bucket)?.[bu] ?? 0 })).filter((item) => item.amount > 0)
  })).filter((bucket) => bucket.values.length > 0);
}

type StackedBucketsChartProps = {
  title: string;
  subtitle: string;
  buckets: BucketStack[];
  buOrder: string[];
  sourceHint?: string;
};

function StackedBucketsChart({ title, subtitle, buckets, buOrder, sourceHint }: StackedBucketsChartProps) {
  const totals = buckets.map((bucket) => ({
    bucket: bucket.bucket,
    total: bucket.values.reduce((acc, item) => acc + item.amount, 0),
    values: bucket.values
  }));
  const maxBucketValue = Math.max(...totals.map((item) => item.total), 1);
  const columnsClass = totals.length <= 4 ? "grid-cols-4" : "grid-cols-5 xl:grid-cols-6";

  return (
    <article className="min-h-[320px] rounded-2xl border border-[#e5e9f2] bg-white p-4 shadow-sm xl:min-h-[360px] xl:p-6 2xl:min-h-[400px] 2xl:p-8">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-[#0f172a] 2xl:text-lg">{title}</h3>
          <p className="mt-1 text-xs text-[#8fa3b4]">{subtitle}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap justify-end gap-x-3 gap-y-1 text-[11px] text-[#475569]">
            {buOrder.map((bu) => (
              <span key={bu} className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: BU_COLORS[bu] }} />
                {bu}
              </span>
            ))}
          </div>
          {sourceHint ? <p className="text-[11px] font-medium text-[#64748b]">{sourceHint}</p> : null}
        </div>
      </div>

      <div className="relative">
        <div className={cn("grid h-[190px] items-end gap-3 border-b border-[rgba(15,30,58,0.15)] xl:h-[220px] 2xl:h-[280px]", columnsClass)}>
        {totals.map((bucket, index) => {
          const height = bucket.total > 0 ? Math.max((bucket.total / maxBucketValue) * 100, 16) : 0;
          const nonZeroValues = bucket.values.filter((value) => value.amount > 0);
          return (
            <div key={`${bucket.bucket}-${index}`} className="group relative flex h-full flex-col justify-end">
              <div className="flex w-full flex-col overflow-hidden rounded-t-lg border border-transparent" style={{ height: `${height}%` }}>
                {bucket.values.map((value) => (
                  <div
                    key={`${bucket.bucket}-${value.bu}`}
                    className="w-full transition-all duration-200 group-hover:opacity-90"
                    style={{
                      height: `${bucket.total > 0 ? (value.amount / bucket.total) * 100 : 0}%`,
                      backgroundColor: BU_COLORS[value.bu] ?? BU_COLORS["Não informado"]
                    }}
                  />
                ))}
              </div>
              <div className="pointer-events-none absolute -top-2 left-1/2 z-10 hidden w-[260px] -translate-x-1/2 rounded-lg border border-[#dbe3ef] bg-white px-3 py-2 text-xs text-[#334155] shadow-[0_8px_24px_rgba(15,23,42,0.12)] group-hover:block">
                <p className="mb-1 font-semibold text-[#0f172a]">{bucket.bucket} dias</p>
                {nonZeroValues.length > 0 ? (
                  <div className="space-y-1">
                    {nonZeroValues.map((value) => {
                      const share = bucket.total > 0 ? (value.amount / bucket.total) * 100 : 0;
                      return (
                        <p key={`${bucket.bucket}-${value.bu}`} className="flex items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-1.5">
                            <span
                              className="inline-block h-2 w-2 rounded-full"
                              style={{ backgroundColor: BU_COLORS[value.bu] ?? BU_COLORS["Não informado"] }}
                            />
                            <span>{value.bu}</span>
                          </span>
                          <span className="font-medium text-[#0f172a]">
                            {formatCurrencyInThousands(value.amount)} ({formatSharePercent(share)})
                          </span>
                        </p>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[#64748b]">Sem valor neste bucket</p>
                )}
              </div>
            </div>
          );
        })}
        </div>
        <div className={cn("grid gap-3 pt-2", columnsClass)}>
          {totals.map((bucket, index) => (
            <div key={`${bucket.bucket}-label-${index}`} className="text-center">
              <p className="text-[11px] font-semibold text-[#334155] 2xl:text-xs">{formatCurrencyInThousands(bucket.total)}</p>
              <p className="mt-1 text-[11px] font-medium text-[#64748b] 2xl:text-xs">{bucket.bucket}</p>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}

function movementMetricLabel(metric: PortfolioMovementDto["metric"]) {
  if (metric === "overdue_amount") return "Em atraso";
  if (metric === "uncovered_exposure") return "Exposição descoberta";
  if (metric === "total_open_amount") return "Total em aberto";
  return "Risco provável";
}

function movementTone(movement: PortfolioMovementDto) {
  if (movement.direction === "up") {
    return movement.severity === "critical"
      ? "border-rose-300 bg-rose-50 text-rose-900"
      : "border-amber-300 bg-amber-50 text-amber-900";
  }
  if (movement.direction === "down") {
    return "border-emerald-300 bg-emerald-50 text-emerald-900";
  }
  return "border-slate-300 bg-slate-50 text-slate-700";
}

function movementSymbol(direction: PortfolioMovementDto["direction"]) {
  if (direction === "up") return "↑";
  if (direction === "down") return "↓";
  return "→";
}

function movementReadableMessage(movement: PortfolioMovementDto) {
  const valueLabel = formatCurrencyInThousands(Math.abs(movement.delta));
  const action = movement.direction === "down" ? "reduziu" : "aumentou";
  const subject = movement.entity_name;

  if (movement.metric === "overdue_amount") {
    return `${subject} ${action} ${valueLabel} em valores em atraso.`;
  }
  if (movement.metric === "uncovered_exposure") {
    return `${subject} ${action} ${valueLabel} em exposição descoberta.`;
  }
  if (movement.metric === "total_open_amount") {
    return `${subject} ${action} ${valueLabel} em exposição total.`;
  }
  return `${subject} ${action} ${valueLabel} em risco alto provável.`;
}

export function DashboardPageView({ context = "clientes" }: DashboardPageViewProps) {
  const [permissions, setPermissions] = useState<string[]>([]);
  useEffect(() => {
    setPermissions(getEffectivePermissions());
  }, []);
  const canViewDashboard = context === "motor-credito"
    ? hasPermission("credit.dashboard.view", permissions)
    : hasPermission("clients.dashboard.view", permissions);
  const canImportAging = hasPermission("clients.aging.import", permissions);

  const router = useRouter();
  const searchParams = useSearchParams();
  const businessUnitContext = searchParams.get("business_unit_context") ?? "";
  const buContextQuery = useBusinessUnitContextQuery();
  const snapshotsQuery = usePortfolioSnapshotsQuery();
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string>("current");
  const agingQuery = usePortfolioAgingLatestQuery({ snapshot_id: selectedSnapshotId, business_unit_context: businessUnitContext || undefined });
  const movementsQuery = usePortfolioAgingMovementsLatestQuery(selectedSnapshotId, businessUnitContext || undefined);
  const [showTopMovements, setShowTopMovements] = useState(false);
  const baseDateLabel = useMemo(() => {
    const rawBaseDate = agingQuery.data?.import_meta?.base_date;
    if (!rawBaseDate || typeof rawBaseDate !== "string") {
      return null;
    }
    const parsed = new Date(`${rawBaseDate}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return new Intl.DateTimeFormat("pt-BR").format(parsed);
  }, [agingQuery.data?.import_meta?.base_date]);

  const kpis = useMemo(() => {
    const aging = agingQuery.data;
    const totalOpenAmount = toNumber(aging?.total_open_amount);
    const totalOverdueAmount = toNumber(aging?.total_overdue_amount);
    const totalNotDueAmount = toNumber(aging?.total_not_due_amount);
    const insuredLimitAmount = toNumber(aging?.insured_limit_amount ?? aging?.total_insured_limit_amount);

    const totalOpen = asMoney(totalOpenAmount);
    const overdue = asMoney(totalOverdueAmount);
    const notDue = asMoney(totalNotDueAmount);
    const insured = asMoney(insuredLimitAmount);
    const litigationTotal = toNumber((aging?.litigation_summary as { total_open?: number | string } | undefined)?.total_open);

    return {
      totalOpenAmount,
      totalOverdueAmount,
      totalNotDueAmount,
      insuredLimitAmount,
      litigationTotal,
      customersCount: Number(aging?.distinct_customers ?? 0),
      overduePct: totalOpen > 0 ? (overdue / totalOpen) * 100 : 0,
      notDuePct: totalOpen > 0 ? (notDue / totalOpen) * 100 : 0,
      insuredCoveragePct: totalOpen > 0 ? (insured / totalOpen) * 100 : 0,
      netExposure: Math.max(totalOpen - insured, 0)
    };
  }, [agingQuery.data]);

  const agingBuckets: BucketStackMap = useMemo(() => {
    const buOrder = resolveBuSeriesOrder(agingQuery.data?.aging_buckets_by_bu?.not_due, agingQuery.data?.aging_buckets_by_bu?.overdue);
    const notDueByBu = normalizeBucketsByBuFromBackend(agingQuery.data?.aging_buckets_by_bu?.not_due, "not_due", buOrder);
    const overdueByBu = normalizeBucketsByBuFromBackend(agingQuery.data?.aging_buckets_by_bu?.overdue, "overdue", buOrder);
    return {
      not_due: notDueByBu,
      overdue: overdueByBu
    };
  }, [agingQuery.data?.aging_buckets_by_bu?.not_due, agingQuery.data?.aging_buckets_by_bu?.overdue]);
  const chartBuOrder = useMemo(
    () => resolveBuSeriesOrder(agingQuery.data?.aging_buckets_by_bu?.not_due, agingQuery.data?.aging_buckets_by_bu?.overdue),
    [agingQuery.data?.aging_buckets_by_bu?.not_due, agingQuery.data?.aging_buckets_by_bu?.overdue]
  );

  if (!canViewDashboard) {
    return <PermissionDeniedState />;
  }

  const hasNoImport =
    kpis.customersCount === 0 &&
    kpis.totalOpenAmount === null &&
    kpis.totalOverdueAmount === null &&
    kpis.totalNotDueAmount === null &&
    kpis.insuredLimitAmount === null;

  if (agingQuery.isLoading) {
    return (
      <section className="mx-auto w-full max-w-[min(1800px,calc(100vw-64px))] space-y-6 px-4 sm:px-6 lg:px-8 2xl:px-10">
        <div className="h-16 animate-pulse rounded-2xl bg-white" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-32 animate-pulse rounded-2xl bg-white" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <div className="h-[360px] animate-pulse rounded-2xl bg-white" />
          <div className="h-[360px] animate-pulse rounded-2xl bg-white" />
        </div>
      </section>
    );
  }

  if (agingQuery.isError) {
    const errorMessage = agingQuery.error.message ?? "Falha ao carregar dados da carteira.";
    return (
      <section className="mx-auto w-full max-w-[min(1800px,calc(100vw-64px))] px-4 sm:px-6 lg:px-8 2xl:px-10">
        <ErrorState
          title="Não foi possível carregar o dashboard"
          description={errorMessage}
          onRetry={() => {
            void agingQuery.refetch();
          }}
        />
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-[min(1800px,calc(100vw-64px))] space-y-6 xl:space-y-8 2xl:space-y-10 px-4 sm:px-6 lg:px-8 2xl:px-10">
      <OperationalContextBar>
        {buContextQuery.data ? (
          <BusinessUnitContextSelector
            value={businessUnitContext || (buContextQuery.data.default_context.consolidated ? "consolidated" : String(buContextQuery.data.default_context.business_unit_code ?? ""))}
            onChange={(value) => {
              const next = new URLSearchParams(searchParams.toString());
              next.set("business_unit_context", value);
              router.replace(`?${next.toString()}`);
            }}
            label="Visão"
            consolidatedLabel={buContextQuery.data.consolidated_label}
            canViewConsolidated={buContextQuery.data.can_view_consolidated}
            options={buContextQuery.data.allowed_business_units.map((item) => ({ code: item.code, name: item.name }))}
            compact
          />
        ) : null}
        <div className="inline-flex items-center gap-2 rounded-md border border-[#dbe3ef] bg-[#f8fafc] px-2.5 py-1 text-xs">
          <span className="font-semibold text-[#64748b]">Carteira</span>
          <select
            value={selectedSnapshotId}
            onChange={(event) => setSelectedSnapshotId(event.target.value)}
            className="h-7 rounded border border-[#dbe3ef] bg-white px-2 text-xs text-[#0f172a]"
          >
            <option value="current">Atual</option>
            {(snapshotsQuery.data ?? []).filter((item) => !item.is_current).map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        {baseDateLabel ? (
          <div className="inline-flex items-center gap-2 rounded-md border border-[#dbe3ef] bg-[#f8fafc] px-2.5 py-1 text-xs">
            <span className="font-semibold text-[#64748b]">Base</span>
            <span className="font-medium text-[#0f172a]">{baseDateLabel}</span>
          </div>
        ) : null}
      </OperationalContextBar>

      <header className="rounded-2xl border border-[#dde5f0] bg-gradient-to-br from-white via-[#fbfdff] to-[#f7faff] px-5 py-5 shadow-[0_8px_24px_rgba(15,23,42,0.06)] xl:px-7 xl:py-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-[#7b8797]">Gestão de Carteira</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-[-0.015em] text-[#0f172a] xl:text-[32px]">Dashboard de Clientes</h2>
            <p className="mt-3 max-w-2xl text-sm text-[#5b6b7f]">
              Monitoramento executivo da carteira, exposição financeira e risco de crédito.
            </p>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden rounded-2xl border border-[#1f3754] bg-[#0d1b2a] p-4 shadow-sm xl:p-6 2xl:p-8">
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(41,91,154,0.3)_0%,transparent_60%)]" />
        <div className="relative grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <div className="xl:pr-4">
            <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-white/45">Total em Aberto</p>
            <p className="mt-1 text-3xl font-semibold text-[#75D4EE]">{formatCurrencyInThousands(kpis.totalOpenAmount)}</p>
            <p className="mt-1 text-xs text-white/55">A vencer: {formatPercent(kpis.notDuePct)} | Em atraso: {formatPercent(kpis.overduePct)}</p>
          </div>
          <div className="xl:border-l xl:border-white/10 xl:pl-4">
            <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-white/45">Em Litígio</p>
            <p className="mt-1 text-2xl font-semibold text-white">{formatCurrencyInThousands(kpis.litigationTotal)}</p>
            <p className="mt-1 text-xs text-white/45">Valores classificados como litígio</p>
          </div>
          <div className="xl:border-l xl:border-white/10 xl:pl-4">
            <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-white/45">Limite segurado</p>
            <p className="mt-1 text-2xl font-semibold text-white">{formatCurrencyInThousands(kpis.insuredLimitAmount)}</p>
            <p className="mt-1 text-xs text-white/45">Cobertura COFACE</p>
          </div>
          <div className="xl:border-l xl:border-white/10 xl:pl-4">
            <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-white/45">Exposição Líquida</p>
            <p className="mt-1 text-2xl font-semibold text-white">{formatCurrencyInThousands(kpis.netExposure)}</p>
            <p className="mt-1 text-xs text-white/45">Saldo sem cobertura</p>
          </div>
          <div className="xl:border-l xl:border-white/10 xl:pl-4">
            <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-white/45">Clientes</p>
            <p className="mt-1 text-2xl font-semibold text-white">{kpis.customersCount}</p>
          </div>
        </div>
      </section>

      {hasNoImport ? (
        <EmptyState
          title="Ambiente pronto para a primeira importação AR Aging"
          description="Importe o relatório AR Aging para iniciar a gestão da carteira de clientes, acompanhar exposição, inadimplência, limites e snapshots históricos."
          actionLabel={canImportAging ? "Importar AR Aging" : undefined}
          onActionClick={canImportAging ? openAgingImportDrawer : undefined}
        />
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-[#dbe3ef] bg-white px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#64748b]">Total Not Due</p>
          <p className="mt-1 text-xl font-bold text-[#0f172a]">{formatCurrencyInThousands(kpis.totalNotDueAmount)}</p>
        </div>
        <div className="rounded-xl border border-[#dbe3ef] bg-white px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#64748b]">Total Overdue</p>
          <p className="mt-1 text-xl font-bold text-[#0f172a]">{formatCurrencyInThousands(kpis.totalOverdueAmount)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StackedBucketsChart
          title="A Vencer (Not Due)"
          subtitle="Distribuição por faixa de vencimento"
          buckets={agingBuckets.not_due}
          buOrder={chartBuOrder}
          sourceHint={agingBuckets.not_due.length > 0 ? "Dados da base vigente (bucket + BU)." : "Sem bucket estruturado na base"}
        />
        <StackedBucketsChart
          title="Vencido (Overdue)"
          subtitle="Distribuição por faixa de atraso"
          buckets={agingBuckets.overdue}
          buOrder={chartBuOrder}
          sourceHint={agingBuckets.overdue.length > 0 ? "Dados da base vigente (bucket + BU)." : "Sem bucket estruturado na base"}
        />
      </div>

      <PortfolioRiskSection snapshotId={selectedSnapshotId} businessUnitContext={businessUnitContext || undefined} />

      

      <section className="rounded-2xl border border-[#e5e9f2] bg-white p-4 shadow-sm xl:p-6 2xl:p-8">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-[0.06em] text-[#334155]">Top movimentos da carteira</h3>
            <p className="mt-1 text-sm text-[#64748b]">Principais variações entre a base vigente e a base anterior.</p>
          </div>
          <button
            type="button"
            onClick={() => setShowTopMovements((current) => !current)}
            className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
          >
            {showTopMovements ? "Ocultar" : "Mostrar"}
          </button>
        </div>

        {showTopMovements ? (
          <>
            {movementsQuery.isLoading ? <p className="mt-3 text-sm text-[#64748b]">Carregando movimentos...</p> : null}
            {movementsQuery.isError ? <p className="mt-3 text-sm text-rose-700">Não foi possível carregar os movimentos da carteira.</p> : null}

            {!movementsQuery.isLoading && !movementsQuery.isError ? (
              movementsQuery.data && movementsQuery.data.movements.length > 0 ? (
                <div className="mt-4 space-y-3">
                  {movementsQuery.data.movements.slice(0, 10).map((movement) => (
                    <article key={movement.id} className={cn("rounded-xl border px-4 py-3", movementTone(movement))}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold">{movement.entity_name}</p>
                        <p className="text-xs font-semibold uppercase tracking-[0.06em]">{movementMetricLabel(movement.metric)}</p>
                      </div>
                      <p className="mt-1 text-sm">{movementReadableMessage(movement)}</p>
                      <p className="mt-1 text-xs font-medium">
                        {movementSymbol(movement.direction)} {formatCurrencyInThousands(movement.delta)} | Atual: {formatCurrencyInThousands(movement.current_value)}
                      </p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  {movementsQuery.data?.message ?? "Ainda não há base anterior suficiente para comparação."}
                </p>
              )
            ) : null}
          </>
        ) : null}
      </section>
    </section>
  );
}



