"use client";

import { useMemo } from "react";

import { toNumber } from "@/features/credit-analyses/utils/formatters";
import { PortfolioRiskSection } from "@/features/dashboard/components/portfolio-risk-section";
import { formatCurrencyInThousands } from "@/features/dashboard/utils/dashboard-formatters";
import { PortfolioMovementDto } from "@/features/portfolio/api/contracts";
import { usePortfolioAgingLatestQuery } from "@/features/portfolio/hooks/use-portfolio-aging-latest-query";
import { usePortfolioAgingMovementsLatestQuery } from "@/features/portfolio/hooks/use-portfolio-aging-movements-latest-query";
import { ErrorState } from "@/shared/components/states/error-state";
import { cn } from "@/shared/lib/utils";

type DashboardPageViewProps = {
  context?: "clientes" | "motor-credito";
};

type BucketStackValue = { bu: string; amount: number };
type BucketStack = { bucket: string; values: BucketStackValue[] };
type BucketStackMap = { not_due: BucketStack[]; overdue: BucketStack[] };
type AgingSide = "not_due" | "overdue";

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
const BU_ORDER = ["Additive", "Fertilizer", "Additive Intl", "Não informado"] as const;
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

function normalizeBucketsByBuFromBackend(
  buckets: Array<{ bucket: string; values: Array<{ bu: string; amount: number | string }> }> | undefined,
  side: AgingSide
): BucketStack[] {
  const bucketMap = new Map<string, Record<string, number>>();
  for (const fixedBucket of FIXED_BUCKETS) {
    bucketMap.set(fixedBucket, Object.fromEntries(BU_ORDER.map((bu) => [bu, 0])));
  }

  if (Array.isArray(buckets)) {
    for (const bucket of buckets) {
      const canonicalBucket = bucketAlias(bucket.bucket);
      if (!bucketMap.has(canonicalBucket)) continue;
      const current = bucketMap.get(canonicalBucket)!;
      for (const value of bucket.values ?? []) {
        const amount = toNumber(value.amount) ?? 0;
        const bu = BU_ORDER.includes(value.bu as (typeof BU_ORDER)[number]) ? value.bu : "Não informado";
        current[bu] = (current[bu] ?? 0) + amount;
      }
    }
  }

  return FIXED_BUCKETS.map((bucket) => ({
    bucket,
    values: BU_ORDER.map((bu) => ({ bu, amount: bucketMap.get(bucket)?.[bu] ?? 0 }))
  }));
}

type StackedBucketsChartProps = {
  title: string;
  subtitle: string;
  buckets: BucketStack[];
  sourceHint?: string;
};

function StackedBucketsChart({ title, subtitle, buckets, sourceHint }: StackedBucketsChartProps) {
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
            {BU_ORDER.map((bu) => (
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

export function DashboardPageView(_: DashboardPageViewProps) {
  const agingQuery = usePortfolioAgingLatestQuery();
  const movementsQuery = usePortfolioAgingMovementsLatestQuery();
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
    const notDueByBu = normalizeBucketsByBuFromBackend(agingQuery.data?.aging_buckets_by_bu?.not_due, "not_due");
    const overdueByBu = normalizeBucketsByBuFromBackend(agingQuery.data?.aging_buckets_by_bu?.overdue, "overdue");
    return {
      not_due: notDueByBu,
      overdue: overdueByBu
    };
  }, [agingQuery.data?.aging_buckets_by_bu?.not_due, agingQuery.data?.aging_buckets_by_bu?.overdue]);

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
      <header className="rounded-2xl border border-[#dbe3ef] bg-gradient-to-br from-white to-[#f8fbff] p-4 shadow-sm xl:p-6 2xl:p-8">
        <h2 className="text-2xl font-semibold tracking-[-0.01em] text-[#0f172a] xl:text-[30px]">Clientes — Dashboard</h2>
        <p className="mt-1 text-sm text-[#64748b]">Visão executiva da carteira de contas a receber e análise de risco</p>
        {baseDateLabel ? <p className="mt-2 text-xs font-medium text-[#475569]">Base Aging vigente: {baseDateLabel}</p> : null}
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
        <div className="rounded-2xl border border-[#e2e8f0] bg-gradient-to-br from-white to-[#f8fbff] px-6 py-6 shadow-sm">
          <h3 className="text-base font-semibold text-[#0f172a]">Nenhum dado de carteira disponível</h3>
          <p className="mt-1 text-sm text-[#64748b]">Importe dados de aging para visualizar os KPIs e gráficos executivos.</p>
        </div>
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
          sourceHint={agingBuckets.not_due.length > 0 ? "Dados da base vigente (bucket + BU)." : "Sem bucket estruturado na base"}
        />
        <StackedBucketsChart
          title="Vencido (Overdue)"
          subtitle="Distribuição por faixa de atraso"
          buckets={agingBuckets.overdue}
          sourceHint={agingBuckets.overdue.length > 0 ? "Dados da base vigente (bucket + BU)." : "Sem bucket estruturado na base"}
        />
      </div>

      <PortfolioRiskSection />

      

      <section className="rounded-2xl border border-[#e5e9f2] bg-white p-4 shadow-sm xl:p-6 2xl:p-8">
        <h3 className="text-sm font-semibold uppercase tracking-[0.06em] text-[#334155]">Top movimentos da carteira</h3>
        <p className="mt-1 text-sm text-[#64748b]">Principais variações entre a base vigente e a base anterior.</p>

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
      </section>
    </section>
  );
}



