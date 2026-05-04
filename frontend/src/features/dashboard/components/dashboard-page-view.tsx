"use client";

import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";

import { toNumber } from "@/features/credit-analyses/utils/formatters";
import { formatCurrencyInThousands } from "@/features/dashboard/utils/dashboard-formatters";
import { PortfolioAgingAlertDto, PortfolioBodAgingBucketDto, PortfolioMovementDto } from "@/features/portfolio/api/contracts";
import { usePortfolioAgingAlertsLatestQuery } from "@/features/portfolio/hooks/use-portfolio-aging-alerts-latest-query";
import { usePortfolioAgingLatestQuery } from "@/features/portfolio/hooks/use-portfolio-aging-latest-query";
import { usePortfolioAgingMovementsLatestQuery } from "@/features/portfolio/hooks/use-portfolio-aging-movements-latest-query";
import { ErrorState } from "@/shared/components/states/error-state";
import { cn } from "@/shared/lib/utils";

type DashboardPageViewProps = {
  context?: "clientes" | "motor-credito";
};

type Bucket = {
  label: string;
  value: number;
  percentOfGroup: number;
};

const percentFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
});

function formatPercent(value: number) {
  return `${percentFormatter.format(value)}%`;
}

function asMoney(value: number | null) {
  return value ?? 0;
}

function toCents(value: number) {
  return Math.round(value * 100);
}

function fromCents(value: number) {
  return value / 100;
}

function distributeToBuckets(total: number, labels: string[], weights: number[]): Bucket[] {
  if (labels.length !== weights.length || labels.length === 0 || total <= 0) {
    return labels.map((label) => ({ label, value: 0, percentOfGroup: 0 }));
  }

  const totalCents = toCents(total);
  const normalizedWeight = weights.reduce((acc, item) => acc + item, 0);
  if (normalizedWeight <= 0) {
    return labels.map((label) => ({ label, value: 0, percentOfGroup: 0 }));
  }

  const rawAllocations = weights.map((weight) => (totalCents * weight) / normalizedWeight);
  const floored = rawAllocations.map((item) => Math.floor(item));
  const ranking = rawAllocations
    .map((raw, index) => ({ index, fraction: raw - Math.floor(raw) }))
    .sort((a, b) => b.fraction - a.fraction);
  let remainder = totalCents - floored.reduce((acc, item) => acc + item, 0);

  for (let i = 0; i < remainder; i += 1) {
    floored[ranking[i % ranking.length].index] += 1;
  }

  return labels.map((label, index) => {
    const value = fromCents(floored[index]);
    return {
      label,
      value,
      percentOfGroup: total > 0 ? (value / total) * 100 : 0
    };
  });
}

function normalizeBucketsFromBackend(buckets: PortfolioBodAgingBucketDto[] | undefined): Bucket[] {
  if (!Array.isArray(buckets) || buckets.length === 0) {
    return [];
  }

  const parsed = buckets
    .map((item) => ({
      label: item.label,
      value: toNumber(item.amount)
    }))
    .filter((item): item is { label: string; value: number } => item.value !== null && item.value > 0);

  const total = parsed.reduce((acc, item) => acc + item.value, 0);
  if (total <= 0) {
    return [];
  }

  return parsed.map((item) => ({
    label: item.label,
    value: item.value,
    percentOfGroup: (item.value / total) * 100
  }));
}

type WaterfallCardProps = {
  title: string;
  subtitle: string;
  buckets: Bucket[];
  groupTotal: number;
  colors: string[];
  sourceHint?: string;
  criticalHint?: string;
};

function WaterfallCard({ title, subtitle, buckets, groupTotal, colors, sourceHint, criticalHint }: WaterfallCardProps) {
  const maxBucketValue = Math.max(...buckets.map((item) => item.value), 1);

  return (
    <article className="min-h-[320px] rounded-2xl border border-[#e5e9f2] bg-white p-4 shadow-sm xl:min-h-[360px] xl:p-6 2xl:min-h-[400px] 2xl:p-8">
      <div className="mb-4 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-[#0f172a] 2xl:text-lg">{title}</h3>
          <p className="mt-1 text-xs text-[#8fa3b4]">{subtitle}</p>
        </div>
        {sourceHint ? <p className="text-[11px] font-medium text-[#64748b]">{sourceHint}</p> : null}
      </div>

      <div className={cn("grid h-[230px] items-end gap-3 xl:h-[260px] 2xl:h-[340px]", buckets.length <= 4 ? "grid-cols-4" : "grid-cols-5 xl:grid-cols-6")}>
        {buckets.map((bucket, index) => {
          const height = Math.max((bucket.value / maxBucketValue) * 100, bucket.value > 0 ? 16 : 0);
          const isCriticalBucket = bucket.label.includes("90+");
          return (
            <div key={`${bucket.label}-${index}`} className="group relative flex h-full flex-col justify-end">
              <div className="absolute -top-2 left-1/2 z-10 hidden w-[180px] -translate-x-1/2 rounded-lg border border-[#d7deea] bg-[#0f172a] px-2.5 py-2 text-xs text-[#e2e8f0] shadow-lg group-hover:block group-focus-within:block">
                <p className="font-semibold text-white">{bucket.label}</p>
                <p>{formatCurrencyInThousands(bucket.value)}</p>
                <p>{formatPercent(bucket.percentOfGroup)} do grupo</p>
                <p className="mt-1 text-[#94a3b8]">{formatPercent(groupTotal > 0 ? (bucket.value / groupTotal) * 100 : 0)} do total em aberto</p>
              </div>

              <div
                className={cn(
                  "w-full rounded-t-lg transition-all duration-200 group-hover:opacity-90",
                  colors[index % colors.length],
                  isCriticalBucket ? "ring-2 ring-rose-300/80 ring-offset-1 ring-offset-white" : ""
                )}
                style={{ height: `${height}%` }}
              />
              <p className="mt-2 text-center text-[11px] font-semibold text-[#334155] 2xl:text-xs">{formatCurrencyInThousands(bucket.value)}</p>
              <p className={cn("mt-1 text-center text-[11px] font-medium text-[#64748b] 2xl:text-xs", isCriticalBucket ? "text-rose-700" : "")}>{bucket.label}</p>
            </div>
          );
        })}
      </div>
      {criticalHint ? <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{criticalHint}</div> : null}
    </article>
  );
}

type RiskCardProps = {
  title: "Probable" | "Possible" | "Rare";
  amount: number | null;
  customersCount: number | null;
  totalOpen: number;
};

function alertTone(severity: PortfolioAgingAlertDto["severity"]) {
  if (severity === "critical") {
    return "border-2 border-rose-500 bg-rose-50 text-rose-900 shadow-[0_4px_12px_rgba(190,24,93,0.12)]";
  }
  if (severity === "warning") {
    return "border border-amber-400 bg-amber-50 text-amber-900";
  }
  return "border border-slate-300 bg-slate-50 text-slate-700";
}

function alertSeverityLabel(severity: PortfolioAgingAlertDto["severity"]) {
  if (severity === "critical") {
    return "Crítico";
  }
  if (severity === "warning") {
    return "Atenção";
  }
  return "Monitoramento";
}

function normalizeAlertMessage(alert: PortfolioAgingAlertDto) {
  if (alert.metric === "probable_risk_amount" && typeof alert.value === "number") {
    return `${formatCurrencyInThousands(alert.value)} em risco alto (provável)`;
  }
  return alert.message;
}

function alertDeltaTone(direction: NonNullable<PortfolioAgingAlertDto["delta"]>["direction"]) {
  if (direction === "up") {
    return "text-rose-700";
  }
  if (direction === "down") {
    return "text-emerald-700";
  }
  return "text-slate-600";
}

function alertDeltaSymbol(direction: NonNullable<PortfolioAgingAlertDto["delta"]>["direction"]) {
  if (direction === "up") {
    return "↑";
  }
  if (direction === "down") {
    return "↓";
  }
  return "→";
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

function RiskCard({ title, amount, customersCount, totalOpen }: RiskCardProps) {
  const tone =
    title === "Probable"
      ? "border-[#fca5a5] bg-[#fff5f5] text-[#991b1b] ring-1 ring-rose-200"
      : title === "Possible"
        ? "border-[#fed7aa] bg-[#fff7ed] text-[#f97316]"
        : "border-[#a7f3d0] bg-[#ecfdf5] text-[#10b981]";

  const percent = amount !== null && totalOpen > 0 ? (amount / totalOpen) * 100 : null;

  return (
    <article className={cn("min-h-[140px] rounded-xl border px-4 py-4 shadow-sm xl:min-h-[160px] xl:px-5 xl:py-5 2xl:min-h-[180px] 2xl:px-6 2xl:py-6", tone)}>
      <p className="text-xs font-semibold uppercase tracking-[0.06em]">{title}{title === "Probable" ? " · Crítico" : ""}</p>
      <p className="mt-2 text-[28px] font-bold leading-none 2xl:text-[34px]">{amount === null ? "Sem dado estruturado" : formatCurrencyInThousands(amount)}</p>
      <p className="mt-1 text-xs font-medium">{percent === null ? "Não identificado" : `${formatPercent(percent)} do total em aberto`}</p>
      <p className="mt-2 text-xs">{customersCount === null ? "Clientes: Não identificado" : `Clientes: ${customersCount}`}</p>
    </article>
  );
}

export function DashboardPageView(_: DashboardPageViewProps) {
  const agingQuery = usePortfolioAgingLatestQuery();
  const alertsQuery = usePortfolioAgingAlertsLatestQuery();
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

    return {
      totalOpenAmount,
      totalOverdueAmount,
      totalNotDueAmount,
      insuredLimitAmount,
      customersCount: Number(aging?.distinct_customers ?? 0),
      overduePct: totalOpen > 0 ? (overdue / totalOpen) * 100 : 0,
      notDuePct: totalOpen > 0 ? (notDue / totalOpen) * 100 : 0,
      insuredCoveragePct: totalOpen > 0 ? (insured / totalOpen) * 100 : 0,
      netExposure: Math.max(totalOpen - insured, 0)
    };
  }, [agingQuery.data]);

  const bodSnapshot = agingQuery.data?.bod_snapshot ?? null;
  const bodRisk = bodSnapshot?.risk;
  const bodWarnings = Array.isArray(bodSnapshot?.warnings) ? bodSnapshot?.warnings : [];
  const orderedAlerts = useMemo(() => {
    const severityOrder: Record<PortfolioAgingAlertDto["severity"], number> = {
      critical: 0,
      warning: 1,
      info: 2
    };
    return (alertsQuery.data ?? [])
      .slice()
      .sort((a, b) => {
        const bySeverity = severityOrder[a.severity] - severityOrder[b.severity];
        return bySeverity !== 0 ? bySeverity : a.id.localeCompare(b.id);
      })
      .slice(0, 5);
  }, [alertsQuery.data]);

  const probableAmount = toNumber(bodRisk?.probable?.amount);
  const possibleAmount = toNumber(bodRisk?.possible?.amount);
  const rareAmount = toNumber(bodRisk?.rare?.amount);
  const probableCustomers = bodRisk?.probable?.customers_count ?? null;
  const possibleCustomers = bodRisk?.possible?.customers_count ?? null;
  const rareCustomers = bodRisk?.rare?.customers_count ?? null;

  const atRiskAmount = probableAmount !== null || possibleAmount !== null ? (probableAmount ?? 0) + (possibleAmount ?? 0) : null;
  const atRiskPct = atRiskAmount !== null && asMoney(kpis.totalOpenAmount) > 0 ? (atRiskAmount / asMoney(kpis.totalOpenAmount)) * 100 : null;
  const probablePct = probableAmount !== null && asMoney(kpis.totalOpenAmount) > 0 ? (probableAmount / asMoney(kpis.totalOpenAmount)) * 100 : null;

  const notDueRealBuckets = useMemo(() => normalizeBucketsFromBackend(bodSnapshot?.aging_buckets?.not_due), [bodSnapshot?.aging_buckets?.not_due]);
  const overdueRealBuckets = useMemo(() => normalizeBucketsFromBackend(bodSnapshot?.aging_buckets?.overdue), [bodSnapshot?.aging_buckets?.overdue]);

  const notDueFallback = useMemo(
    () => distributeToBuckets(asMoney(kpis.totalNotDueAmount), ["0–30 dias", "31–60 dias", "61–90 dias", "90+ dias"], [0.48, 0.27, 0.17, 0.08]),
    [kpis.totalNotDueAmount]
  );
  const overdueFallback = useMemo(
    () => distributeToBuckets(asMoney(kpis.totalOverdueAmount), ["1–30 dias", "31–60 dias", "61–90 dias", "90+ dias"], [0.34, 0.29, 0.22, 0.15]),
    [kpis.totalOverdueAmount]
  );

  const useRealNotDue = notDueRealBuckets.length > 0;
  const useRealOverdue = overdueRealBuckets.length > 0;
  const notDueBuckets = useRealNotDue ? notDueRealBuckets : notDueFallback;
  const overdueBuckets = useRealOverdue ? overdueRealBuckets : overdueFallback;
  const usingAnyFallback = !useRealNotDue || !useRealOverdue;

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
            <p className="mt-1 text-2xl font-semibold text-[#75D4EE]">{formatCurrencyInThousands(kpis.totalOpenAmount)}</p>
          </div>
          <div className="xl:border-l xl:border-white/10 xl:pl-4">
            <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-white/45">% Overdue</p>
            <p className="mt-1 text-2xl font-semibold text-[#E8B83A]">{formatPercent(kpis.overduePct)}</p>
          </div>
          <div className="xl:border-l xl:border-white/10 xl:pl-4">
            <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-white/45">Cobertura segurada</p>
            <p className="mt-1 text-2xl font-semibold text-white">{formatPercent(kpis.insuredCoveragePct)}</p>
          </div>
          <div className="xl:border-l xl:border-white/10 xl:pl-4">
            <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-white/45">Clientes na carteira</p>
            <p className="mt-1 text-2xl font-semibold text-white">{kpis.customersCount}</p>
          </div>
          <div className="xl:border-l xl:border-white/10 xl:pl-4">
            <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-white/45">Exposição líquida</p>
            <p className="mt-1 text-2xl font-semibold text-white">{formatCurrencyInThousands(kpis.netExposure)}</p>
          </div>
        </div>
      </section>

      {hasNoImport ? (
        <div className="rounded-2xl border border-[#e2e8f0] bg-gradient-to-br from-white to-[#f8fbff] px-6 py-6 shadow-sm">
          <h3 className="text-base font-semibold text-[#0f172a]">Nenhum dado de carteira disponível</h3>
          <p className="mt-1 text-sm text-[#64748b]">Importe dados de aging para visualizar os KPIs e gráficos executivos.</p>
        </div>
      ) : null}

            <div className="grid grid-cols-1 gap-4 xl:gap-6 2xl:gap-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <article className="flex min-h-[132px] flex-col justify-between rounded-2xl border-2 border-rose-300 bg-rose-50/70 px-4 py-4 shadow-sm xl:px-5 xl:py-5 2xl:px-6 2xl:py-6">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-rose-700">Overdue</p>
            <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-semibold text-white">{formatPercent(kpis.overduePct)}</span>
          </div>
          <p className="whitespace-nowrap text-[34px] font-bold leading-none tracking-[-0.02em] text-[#1e3a8a] 2xl:text-[40px]">{formatCurrencyInThousands(kpis.totalOverdueAmount)}</p>
          <p className="mt-2 text-[11px] text-rose-700/80">Vencido · em cobrança</p>
        </article>
        <article className="flex min-h-[132px] flex-col justify-between rounded-2xl border border-[#fde68a] bg-[#fffdf4] px-4 py-4 shadow-sm xl:px-5 xl:py-5 2xl:px-6 2xl:py-6">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-[#a16207]">Not Due</p>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">{formatPercent(kpis.notDuePct)}</span>
          </div>
          <p className="whitespace-nowrap text-[34px] font-bold leading-none tracking-[-0.02em] text-[#854d0e] 2xl:text-[40px]">{formatCurrencyInThousands(kpis.totalNotDueAmount)}</p>
          <p className="mt-2 text-[11px] text-[#8fa3b4]">A vencer · adimplente</p>
        </article>
        <article className="flex min-h-[132px] flex-col justify-between rounded-2xl border border-[#bbf7d0] bg-[#f4fdf6] px-4 py-4 shadow-sm xl:px-5 xl:py-5 2xl:px-6 2xl:py-6">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-[#047857]">Limite Segurado</p>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">{formatPercent(kpis.insuredCoveragePct)}</span>
          </div>
          <p className="whitespace-nowrap text-[34px] font-bold leading-none tracking-[-0.02em] text-[#065f46] 2xl:text-[40px]">{formatCurrencyInThousands(kpis.insuredLimitAmount)}</p>
          <p className="mt-2 text-[11px] text-[#8fa3b4]">Cobertura COFACE</p>
        </article>
        <article className="flex min-h-[132px] flex-col justify-between rounded-2xl border border-[#dbe3ef] bg-[#f8fafe] px-4 py-4 shadow-sm xl:px-5 xl:py-5 2xl:px-6 2xl:py-6">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-[#64748b]">At Risk Exposure</p>
            <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700">
              {atRiskPct === null ? "Sem dado" : formatPercent(atRiskPct)}
            </span>
          </div>
          <p className="whitespace-nowrap text-[32px] font-bold leading-none tracking-[-0.02em] text-[#0f172a] 2xl:text-[38px]">
            {atRiskAmount === null ? "Sem dado estruturado" : formatCurrencyInThousands(atRiskAmount)}
          </p>
          <p className="mt-2 text-[11px] text-[#8fa3b4]">Probable + Possible</p>
        </article>
        <article className="flex min-h-[132px] flex-col justify-between rounded-2xl border border-rose-200 bg-rose-50/50 px-4 py-4 shadow-sm xl:px-5 xl:py-5 2xl:px-6 2xl:py-6">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-rose-800">Probable</p>
            <span className="rounded-full border border-rose-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-rose-700">
              {probablePct === null ? "Sem dado" : formatPercent(probablePct)}
            </span>
          </div>
          <p className="whitespace-nowrap text-[32px] font-bold leading-none tracking-[-0.02em] text-rose-900 2xl:text-[38px]">
            {probableAmount === null ? "Sem dado estruturado" : formatCurrencyInThousands(probableAmount)}
          </p>
          <p className="mt-2 text-[11px] text-rose-800/80">Alta probabilidade de perda</p>
        </article>
      </div>
      {usingAnyFallback ? (
        <div className="rounded-xl border border-[#fde68a] bg-[#fffdf4] px-4 py-3 text-sm text-[#92400e]">
          Buckets estimados por distribuição visual, pois a origem ainda não retornou faixas estruturadas.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:gap-8 2xl:gap-10 xl:grid-cols-2">
        <WaterfallCard
          title="A Vencer (Not Due)"
          subtitle="Distribuição por faixa de vencimento"
          buckets={notDueBuckets}
          groupTotal={asMoney(kpis.totalOpenAmount)}
          colors={["bg-emerald-500", "bg-emerald-400", "bg-amber-400", "bg-pink-500"]}
          sourceHint={useRealNotDue ? "Dados derivados da importação Aging AR." : "Distribuição visual controlada"}
          criticalHint="Faixa 90+ dias indica maior pressão de risco temporal."
        />
        <WaterfallCard
          title="Vencido (Overdue)"
          subtitle="Distribuição por faixa de atraso"
          buckets={overdueBuckets}
          groupTotal={asMoney(kpis.totalOpenAmount)}
          colors={["bg-amber-500", "bg-orange-500", "bg-rose-500", "bg-red-700"]}
          sourceHint={useRealOverdue ? "Dados derivados da importação Aging AR." : "Distribuição visual controlada"}
          criticalHint="Monitorar especialmente 90+ dias para priorização de cobrança."
        />
      </div>

      <section className="rounded-2xl border border-[#e5e9f2] bg-white p-4 shadow-sm xl:p-6 2xl:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-[#0f172a]">Risco da Carteira</h3>
            <p className="mt-1 text-sm text-[#64748b]">Classificação de exposição por probabilidade de perda</p>
          </div>
          <div className="rounded-xl bg-[#0D1B2A] px-4 py-3 text-right xl:px-5 xl:py-4 2xl:px-6 2xl:py-5">
            <p className="text-[10px] uppercase tracking-[0.08em] text-white/45">At Risk Exposure (Probable + Possible)</p>
            <p className="text-xl font-bold text-[#75D4EE]">{atRiskAmount === null ? "Sem dado estruturado" : formatCurrencyInThousands(atRiskAmount)}</p>
            <p className="text-xs text-white/45">{atRiskPct === null ? "Não identificado" : `${formatPercent(atRiskPct)} do total em aberto`}</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <article className="min-h-[140px] rounded-xl border border-[#dbe3ef] bg-[#eef3f8] px-4 py-4 shadow-sm xl:min-h-[160px] xl:px-5 xl:py-5 2xl:min-h-[180px] 2xl:px-6 2xl:py-6">
            <p className="text-xs font-semibold uppercase tracking-[0.06em] text-[#64748b]">At Risk Exposure</p>
            <p className="mt-2 text-2xl font-bold text-[#102033] 2xl:text-[30px]">{atRiskAmount === null ? "Sem dado estruturado" : formatCurrencyInThousands(atRiskAmount)}</p>
            <p className="mt-1 text-xs text-[#64748b]">{atRiskPct === null ? "Não identificado" : `${formatPercent(atRiskPct)} do total em aberto`}</p>
          </article>
          <RiskCard title="Probable" amount={probableAmount} customersCount={probableCustomers} totalOpen={asMoney(kpis.totalOpenAmount)} />
          <RiskCard title="Possible" amount={possibleAmount} customersCount={possibleCustomers} totalOpen={asMoney(kpis.totalOpenAmount)} />
          <RiskCard title="Rare" amount={rareAmount} customersCount={rareCustomers} totalOpen={asMoney(kpis.totalOpenAmount)} />
        </div>
      </section>

      <section className="rounded-2xl border border-[#e5e9f2] bg-white p-4 shadow-sm xl:p-6 2xl:p-8">
        <h3 className="text-sm font-semibold uppercase tracking-[0.06em] text-[#334155]">Alertas Executivos</h3>
        {alertsQuery.isLoading ? <p className="mt-3 text-sm text-[#64748b]">Carregando alertas...</p> : null}
        {alertsQuery.isError ? <p className="mt-3 text-sm text-rose-700">Não foi possível carregar os alertas executivos.</p> : null}
        {!alertsQuery.isLoading && !alertsQuery.isError ? (
          orderedAlerts.length > 0 ? (
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {orderedAlerts.map((alert) => (
                <article key={alert.id} className={cn("rounded-xl px-4 py-4 text-sm", alertTone(alert.severity))}>
                  <p className="text-xs font-semibold uppercase tracking-[0.06em]">{alertSeverityLabel(alert.severity)}</p>
                  <p className={cn("mt-1", alert.severity === "critical" ? "font-semibold" : "font-medium")}>{alert.title}</p>
                  <p className="mt-2 leading-relaxed">{normalizeAlertMessage(alert)}</p>
                  {alert.delta ? (
                    <p className={cn("mt-2 text-xs font-medium", alertDeltaTone(alert.delta.direction))}>
                      {alertDeltaSymbol(alert.delta.direction)} {alert.delta.formatted} vs base anterior
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              Nenhum alerta crítico identificado na base vigente.
            </p>
          )
        ) : null}
      </section>

      <section className="rounded-2xl border border-[#e5e9f2] bg-white p-4 shadow-sm xl:p-6 2xl:p-8">
        <h3 className="text-sm font-semibold uppercase tracking-[0.06em] text-[#334155]">Avisos da Base</h3>
        {bodWarnings.length > 0 ? (
          <div className="mt-4 space-y-3">
            {bodWarnings.map((warning) => (
              <div key={warning} className="flex items-start gap-2 rounded-lg border border-[#fed7aa] bg-[#fff7ed] px-4 py-3 text-sm text-[#f97316]">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-[#f97316]" />
                <span>{warning}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            Nenhum aviso técnico identificado na base vigente.
          </p>
        )}
      </section>

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



