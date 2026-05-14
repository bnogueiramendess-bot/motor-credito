"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { BusinessUnitContextSelector } from "@/features/business-units/components/business-unit-context-selector";
import { useBusinessUnitContextQuery } from "@/features/business-units/hooks/use-business-unit-context-query";
import { PortfolioComparisonGroupDeltaDto, PortfolioComparisonMetricDto } from "@/features/portfolio/api/contracts";
import { usePortfolioComparisonQuery } from "@/features/portfolio/hooks/use-portfolio-comparison-query";
import { usePortfolioSnapshotsQuery } from "@/features/portfolio/hooks/use-portfolio-snapshots-query";
import { toNumber } from "@/features/credit-analyses/utils/formatters";
import { formatCurrencyInThousands } from "@/features/dashboard/utils/dashboard-formatters";
import { OperationalContextBar } from "@/shared/components/layout/operational-context-bar";
import { EmptyState } from "@/shared/components/states/empty-state";
import { ErrorState } from "@/shared/components/states/error-state";
import { PermissionDeniedState } from "@/shared/components/states/permission-denied-state";
import { getEffectivePermissions, hasPermission } from "@/shared/lib/auth/permissions";

const EMPTY_METRIC: PortfolioComparisonMetricDto = {
  from_value: 0,
  to_value: 0,
  delta: 0,
  delta_pct: 0
};

function formatMoney(value: number | string | null | undefined): string {
  const parsed = toNumber(value);
  if (parsed === null) return "N/A";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(parsed);
}

function formatMoneyCompact(value: number | string | null | undefined): string {
  const parsed = toNumber(value);
  if (parsed === null) return "N/A";
  return formatCurrencyInThousands(parsed);
}

function formatMoneyCompactSigned(value: number | string | null | undefined): string {
  const parsed = toNumber(value);
  if (parsed === null) return "N/A";
  const base = formatMoneyCompact(Math.abs(parsed));
  if (parsed > 0) return `+${base}`;
  if (parsed < 0) return `-${base}`;
  return base;
}

function formatNumber(value: number | string | null | undefined): string {
  const parsed = toNumber(value);
  if (parsed === null) return "N/A";
  return new Intl.NumberFormat("pt-BR").format(parsed);
}

function formatPeriodLabel(label: string | null | undefined, fallback = "Período"): string {
  if (!label) return fallback;
  const monthYear = label.match(/(\d{2})\/(\d{4})/);
  if (monthYear) {
    return `${monthYear[1]}/${monthYear[2]}`;
  }
  return label.replace(/^Fechamento\s*/i, "").trim() || fallback;
}

function deltaMeta(metric: PortfolioComparisonMetricDto, opts?: { positiveIsBad?: boolean }) {
  const delta = toNumber(metric.delta) ?? 0;
  const deltaPct = toNumber(metric.delta_pct);
  const direction = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const pctLabel = deltaPct === null ? "n/a" : `${delta > 0 ? "+" : ""}${deltaPct.toFixed(1).replace(".", ",")}%`;
  const positiveIsBad = opts?.positiveIsBad === true;
  const upTone = positiveIsBad ? "text-rose-700 bg-rose-50 border-rose-200" : "text-emerald-700 bg-emerald-50 border-emerald-200";
  const downTone = positiveIsBad ? "text-emerald-700 bg-emerald-50 border-emerald-200" : "text-rose-700 bg-rose-50 border-rose-200";
  return {
    pctLabel,
    tone:
      direction === "up"
        ? upTone
        : direction === "down"
          ? downTone
          : "text-slate-700 bg-slate-50 border-slate-200"
  };
}

function KpiCard({
  title,
  metric,
  money,
  accent,
  fromLabel,
  toLabel,
  positiveIsBad
}: {
  title: string;
  metric: PortfolioComparisonMetricDto;
  money: boolean;
  accent: string;
  fromLabel: string;
  toLabel: string;
  positiveIsBad?: boolean;
}) {
  const meta = deltaMeta(metric, { positiveIsBad });
  const toValueLabel = money ? formatMoneyCompact(metric.to_value) : formatNumber(metric.to_value);
  const fromValueLabel = money ? formatMoneyCompact(metric.from_value) : formatNumber(metric.from_value);
  const deltaLabel = money ? formatMoneyCompactSigned(metric.delta) : `${(toNumber(metric.delta) ?? 0) > 0 ? "+" : ""}${formatNumber(metric.delta)}`;
  return (
    <article className={`h-full min-h-[140px] rounded-xl border border-[#e2e8f0] border-t-2 bg-white p-3.5 shadow-sm ${accent}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#64748b]">{title}</p>
        <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold ${meta.tone}`}>{meta.pctLabel}</span>
      </div>
      <p className="mt-1.5 text-[24px] font-semibold tracking-[-0.01em] text-[#0f172a]">{deltaLabel}</p>
      <p className="mt-1 text-xs text-[#64748b] break-words">{fromLabel}: {fromValueLabel} → {toLabel}: {toValueLabel}</p>
    </article>
  );
}

function GroupDeltaTable({
  title,
  rows,
  fromPeriodLabel,
  toPeriodLabel
}: {
  title: string;
  rows: PortfolioComparisonGroupDeltaDto[];
  fromPeriodLabel?: string;
  toPeriodLabel?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const visibleRows = expanded ? rows : rows.slice(0, 5);
  const isDecrease = title.includes("Reduç") || title.includes("Remov");
  const isExposureIncreasePanel = title === "Maiores Aumentos de Exposição";
  const isExposureDecreasePanel = title === "Maiores Reduções de Exposição";
  const useInverseExposureTone = isExposureIncreasePanel || isExposureDecreasePanel;
  const resolveFromAmount = (row: PortfolioComparisonGroupDeltaDto) => row.from_exposure_amount ?? row.from_total_open_amount;
  const resolveToAmount = (row: PortfolioComparisonGroupDeltaDto) => row.to_exposure_amount ?? row.to_total_open_amount;
  const resolveDeltaAmount = (row: PortfolioComparisonGroupDeltaDto) => row.delta_exposure_amount ?? row.delta_total_open_amount;
  const totalDelta = rows.reduce((acc, row) => acc + (toNumber(resolveDeltaAmount(row)) ?? 0), 0);
  const deltaToneClass = (delta: number) => {
    if (delta === 0) return "text-slate-700";
    if (useInverseExposureTone) {
      return delta > 0 ? "text-rose-700" : "text-emerald-700";
    }
    return delta > 0 ? "text-emerald-700" : "text-rose-700";
  };
  const headerDotClass = isExposureIncreasePanel ? "bg-rose-500" : isExposureDecreasePanel ? "bg-emerald-500" : isDecrease ? "bg-rose-500" : "bg-emerald-500";

  return (
    <section className="overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-[#edf2f7] bg-slate-50/70 px-4 py-3">
        <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-[#0f172a]">
          <span className={`h-2 w-2 rounded-full ${headerDotClass}`} />
          {title}
        </h3>
        {rows.length > 5 ? (
          <button type="button" onClick={() => setExpanded((current) => !current)} className="text-xs font-semibold text-[#1d4ed8] hover:underline">
            {expanded ? "Mostrar top 5" : "Ver todos"}
          </button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-4 text-sm text-[#64748b]">Nenhum grupo identificado.</p>
      ) : (
        <div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-[0.06em] text-[#64748b]">
                <tr>
                  <th className="px-4 py-2.5">Grupo Econômico</th>
                  <th className="px-4 py-2.5">{fromPeriodLabel ?? "De"}</th>
                  <th className="px-4 py-2.5">{toPeriodLabel ?? "Para"}</th>
                  <th className="px-4 py-2.5">Variação</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const delta = toNumber(resolveDeltaAmount(row)) ?? 0;
                  return (
                    <tr key={row.economic_group} className="border-t border-[#f1f5f9] text-[#0f172a] hover:bg-slate-50/60">
                      <td className="px-4 py-3 font-semibold">{row.economic_group}</td>
                      <td className="px-4 py-3 text-[#475569]">{formatMoneyCompact(resolveFromAmount(row))}</td>
                      <td className="px-4 py-3 text-[#475569]">{formatMoneyCompact(resolveToAmount(row))}</td>
                      <td className={`px-4 py-3 font-semibold ${deltaToneClass(delta)}`}>
                        {formatMoneyCompactSigned(resolveDeltaAmount(row))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {expanded ? (
            <div className="border-t border-[#edf2f7] bg-slate-50/70 px-4 py-2.5">
              <p className="text-right text-xs font-semibold text-[#334155]">
                Total variação:{" "}
                <span className={deltaToneClass(totalDelta)}>
                  {formatMoneyCompactSigned(totalDelta)}
                </span>
              </p>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function topGroupNames(rows: PortfolioComparisonGroupDeltaDto[], max = 3): string[] {
  return rows
    .map((item) => item.economic_group?.trim())
    .filter((name): name is string => Boolean(name))
    .slice(0, max);
}

function WaterfallExecutive({
  waterfall,
}: {
  waterfall?: {
    starting_amount: number;
    new_groups_amount: number;
    existing_growth_amount: number;
    existing_reduction_amount: number;
    removed_groups_amount: number;
    ending_amount: number;
  };
}) {
  if (!waterfall) {
    return (
      <section className="rounded-xl border border-[#e2e8f0] bg-white p-5 shadow-sm">
        <h3 className="text-base font-semibold text-[#0f172a]">Waterfall Executivo de Variação</h3>
        <p className="mt-1 text-sm text-[#64748b]">Decomposição da variação do saldo entre os fechamentos.</p>
        <p className="mt-4 text-sm text-[#64748b]">Waterfall indisponível para a comparação selecionada.</p>
      </section>
    );
  }

  const steps = [
    {
      label: "Saldo inicial",
      value: waterfall.starting_amount,
      tone: "bg-[#2563eb]",
      text: "text-[#1d4ed8]"
    },
    {
      label: "Entrada",
      value: waterfall.new_groups_amount,
      tone: "bg-emerald-500",
      text: "text-emerald-700"
    },
    {
      label: "Aumento",
      value: waterfall.existing_growth_amount,
      tone: "bg-emerald-400",
      text: "text-emerald-700"
    },
    {
      label: "Redução",
      value: waterfall.existing_reduction_amount,
      tone: "bg-rose-400",
      text: "text-rose-700"
    },
    {
      label: "Saída",
      value: waterfall.removed_groups_amount,
      tone: "bg-rose-500",
      text: "text-rose-700"
    },
    {
      label: "Saldo final",
      value: waterfall.ending_amount,
      tone: "bg-[#0f172a]",
      text: "text-[#0f172a]"
    }
  ];

  const maxAbs = Math.max(...steps.map((step) => Math.abs(step.value)), 1);

  return (
    <section className="rounded-xl border border-[#e2e8f0] bg-white p-5 shadow-sm lg:h-[420px] lg:overflow-hidden">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-[#0f172a]">Waterfall Executivo de Variação</h3>
          <p className="mt-1 text-sm text-[#64748b]">Decomposição da variação do saldo entre os fechamentos.</p>
        </div>
        <div className="hidden items-center gap-3 text-[11px] text-[#64748b] md:flex">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[#2563eb]" />Inicial</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-500" />Aumento</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-rose-500" />Redução</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[#0f172a]" />Final</span>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto lg:h-[calc(100%-60px)]">
        <div className="flex min-w-[820px] items-end justify-between gap-1.5 rounded-lg bg-slate-50/45 p-2.5 lg:h-full">
          {steps.map((step, index) => {
            const height = Math.max((Math.abs(step.value) / maxAbs) * 250, 16);
            return (
              <div key={step.label} className="flex flex-1 items-end gap-2">
                <article className="flex-1">
                  <p className={`mb-1 text-[11px] font-semibold ${step.text}`}>{formatMoneyCompactSigned(step.value)}</p>
                  <div className={`w-full rounded-sm ${step.tone}`} style={{ height }} />
                  <p className="mt-2 text-[11px] font-semibold text-[#475569]">{step.label}</p>
                </article>
                {index < steps.length - 1 ? <span className="pb-10 text-[#94a3b8]">→</span> : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function ExecutiveInsights({
  newGroups,
  topIncreases,
  topDecreases,
  removedGroups
}: {
  newGroups: PortfolioComparisonGroupDeltaDto[];
  topIncreases: PortfolioComparisonGroupDeltaDto[];
  topDecreases: PortfolioComparisonGroupDeltaDto[];
  removedGroups: PortfolioComparisonGroupDeltaDto[];
}) {
  const existingIncreases = topIncreases.filter((item) => (toNumber(item.from_total_open_amount) ?? 0) > 0);
  const existingDecreases = topDecreases.filter((item) => (toNumber(item.to_total_open_amount) ?? 0) > 0);
  const blocks = [
    {
      title: "Entrada de novos grupos",
      description: "Grupos que não possuíam saldo no período base e passaram a compor a carteira no período final.",
      groups: topGroupNames(newGroups, 3),
      tone: "border-sky-400/80"
    },
    {
      title: "Aumento em grupos existentes",
      description: "Grupos já presentes ampliaram saldo entre os períodos comparados.",
      groups: topGroupNames(existingIncreases.length > 0 ? existingIncreases : topIncreases, 3),
      tone: "border-emerald-400/80"
    },
    {
      title: "Redução em grupos existentes",
      description: "Grupos existentes reduziram saldo entre os períodos comparados.",
      groups: topGroupNames(existingDecreases.length > 0 ? existingDecreases : topDecreases, 3),
      tone: "border-amber-300/80"
    },
    {
      title: "Saída de grupos da carteira",
      description: "Grupos que possuíam saldo no período base encerraram posição no período final.",
      groups: topGroupNames(removedGroups, 3),
      tone: "border-rose-400/80"
    }
  ];

  return (
    <aside className="rounded-xl border border-[#1e293b] bg-[#0f172a] p-5 text-white shadow-md shadow-slate-900/20 lg:flex lg:h-[420px] lg:flex-col lg:overflow-hidden">
      <h3 className="text-base font-semibold text-white">Composição da Variação</h3>
      <div className="mt-6 space-y-6 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-2">
        {blocks.map((block) => (
          <article key={block.title} className={`rounded-lg border border-white/10 border-l-2 ${block.tone} bg-white/[0.03] px-3 py-3.5`}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-white/75">{block.title}</p>
            <p className="mt-2 text-sm leading-6 text-white/90">{block.description}</p>
            <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-white/65">Principais impactos</p>
            <ul className="mt-1.5 space-y-1.5 text-xs leading-5 text-white/85">
              {(block.groups.length > 0 ? block.groups : ["Sem grupos relevantes"]).map((group) => (
                <li key={`${block.title}-${group}`} className="flex items-start gap-2">
                  <span className="mt-[7px] h-1 w-1 rounded-full bg-white/70" />
                  <span>{group}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </aside>
  );
}

export function PortfolioEvolutionPage() {
  const permissions = getEffectivePermissions();
  const router = useRouter();
  const searchParams = useSearchParams();
  const businessUnitContext = searchParams.get("business_unit_context") ?? "";
  const buContextQuery = useBusinessUnitContextQuery();
  const snapshotsQuery = usePortfolioSnapshotsQuery();
  const monthlyClosingSnapshots = useMemo(() => {
    const allSnapshots = snapshotsQuery.data ?? [];
    return allSnapshots.filter((item) => !item.is_current && item.snapshot_type === "monthly_closing");
  }, [snapshotsQuery.data]);
  const currentSnapshot = useMemo(() => {
    const allSnapshots = snapshotsQuery.data ?? [];
    return allSnapshots.find((item) => item.is_current);
  }, [snapshotsQuery.data]);
  const toSnapshotOptions = useMemo(() => {
    const monthlyClosings = monthlyClosingSnapshots;
    const currentBase = currentSnapshot;
    if (!currentBase) return monthlyClosings;
    const currentOption = { ...currentBase, id: "current" };
    return [currentOption, ...monthlyClosings];
  }, [monthlyClosingSnapshots, currentSnapshot]);

  const [fromSnapshotId, setFromSnapshotId] = useState<string>("");
  const [toSnapshotId, setToSnapshotId] = useState<string>("");
  const comparisonQuery = usePortfolioComparisonQuery(fromSnapshotId || undefined, toSnapshotId || undefined, businessUnitContext || undefined);

  useEffect(() => {
    if (monthlyClosingSnapshots.length < 1 || toSnapshotOptions.length < 1) return;
    if (fromSnapshotId && toSnapshotId) return;
    const defaultTo = currentSnapshot ? "current" : monthlyClosingSnapshots[0]?.id ?? "";
    const defaultFrom =
      monthlyClosingSnapshots.find((snapshot) => snapshot.id !== defaultTo)?.id ??
      monthlyClosingSnapshots[0]?.id ??
      "";
    setFromSnapshotId(defaultFrom);
    setToSnapshotId(defaultTo);
  }, [monthlyClosingSnapshots, toSnapshotOptions, currentSnapshot, fromSnapshotId, toSnapshotId]);

  if (!hasPermission("clients.portfolio.evolution.view", permissions)) {
    return <PermissionDeniedState />;
  }

  if (monthlyClosingSnapshots.length < 1 || toSnapshotOptions.length < 1) {
    return (
      <section className="mx-auto w-full max-w-[1600px] space-y-3 px-6 py-4 lg:px-8">
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
        </OperationalContextBar>
        <header className="rounded-xl border border-[#dde5f0] bg-gradient-to-br from-white via-[#fbfdff] to-[#f7faff] px-6 py-4 shadow-md shadow-slate-200/45">
          <h1 className="text-2xl font-semibold text-[#0f172a]">Evolução da Carteira</h1>
          <p className="mt-1 text-sm text-[#5b6b7f]">Análise estratégica de variação e risco entre períodos de fechamento.</p>
        </header>
        <EmptyState title="Bases insuficientes para comparação" description="Importe pelo menos um fechamento mensal e mantenha uma base atual para visualizar a evolução da carteira." />
      </section>
    );
  }

  const summary = comparisonQuery.data?.summary;
  const totalOpenMetric = summary?.total_open_amount ?? EMPTY_METRIC;
  const overdueMetric = summary?.total_overdue_amount ?? EMPTY_METRIC;
  const notDueMetric = summary?.total_not_due_amount ?? EMPTY_METRIC;
  const exposureMetric = summary?.exposure_amount ?? EMPTY_METRIC;
  const insuredMetric = summary?.insured_limit_amount ?? EMPTY_METRIC;
  const fromPeriod = formatPeriodLabel(comparisonQuery.data?.from_snapshot?.label, "DE");
  const toPeriod = formatPeriodLabel(comparisonQuery.data?.to_snapshot?.label, "PARA");

  return (
    <section className="mx-auto w-full max-w-[1600px] space-y-3 px-6 py-4 lg:px-8">
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
        <div className="inline-flex items-center gap-2 rounded-md border border-[#dbe3ef] bg-[#f8fafc] px-2.5 py-1">
          <div className="inline-flex items-center gap-2">
            <label className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#64748b]">DE</label>
            <select
              value={fromSnapshotId}
              onChange={(event) => setFromSnapshotId(event.target.value)}
              className="h-8 rounded-md border border-[#dbe3ef] bg-white px-2 text-xs font-medium text-[#0f172a]"
            >
              <option value="">Selecione...</option>
              {monthlyClosingSnapshots.map((snapshot) => (
                <option key={`from-${snapshot.id}`} value={snapshot.id}>
                  {snapshot.label}
                </option>
              ))}
            </select>
          </div>
          <div className="hidden h-8 w-px bg-[#dbe3ef] sm:block" />
          <div className="inline-flex items-center gap-2">
            <label className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#64748b]">PARA</label>
            <select
              value={toSnapshotId}
              onChange={(event) => setToSnapshotId(event.target.value)}
              className="h-8 rounded-md border border-[#dbe3ef] bg-white px-2 text-xs font-medium text-[#0f172a]"
            >
              <option value="">Selecione...</option>
              {toSnapshotOptions.map((snapshot) => (
                <option key={`to-${snapshot.id}`} value={snapshot.id}>
                  {snapshot.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </OperationalContextBar>
      <header className="rounded-xl border border-[#dde5f0] bg-gradient-to-br from-white via-[#fbfdff] to-[#f7faff] px-6 py-4 shadow-md shadow-slate-200/45">
        <div>
          <h1 className="text-[30px] font-semibold tracking-[-0.015em] text-[#0f172a]">Evolução da Carteira</h1>
          <p className="mt-1 text-sm text-[#5b6b7f]">Análise estratégica de variação e risco entre períodos de fechamento.</p>
        </div>
      </header>

      {!fromSnapshotId || !toSnapshotId ? <EmptyState title="Selecione o período de comparação" description="Escolha os fechamentos de origem e destino para visualizar a evolução da carteira." /> : null}
      {fromSnapshotId && toSnapshotId && fromSnapshotId === toSnapshotId ? <EmptyState title="Fechamentos iguais" description="Selecione fechamentos diferentes para comparar a evolução da carteira." /> : null}
      {comparisonQuery.isLoading ? <p className="text-sm text-[#64748b]">Carregando comparação da carteira...</p> : null}
      {comparisonQuery.isError ? (
        <ErrorState title="Falha ao carregar comparação" description={comparisonQuery.error.message ?? "Não foi possível carregar a comparação entre fechamentos."} onRetry={comparisonQuery.refetch} />
      ) : null}

      {!comparisonQuery.isLoading && !comparisonQuery.isError && comparisonQuery.data ? (
        <>
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-12">
            <article className="h-full min-h-[140px] rounded-xl border border-[#dbe3ef] border-l-4 border-l-[#2563eb] bg-gradient-to-br from-white to-[#f8fbff] p-3.5 shadow-sm xl:col-span-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#64748b]">Total em Aberto</p>
                <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold ${deltaMeta(totalOpenMetric).tone}`}>{deltaMeta(totalOpenMetric).pctLabel}</span>
              </div>
              <p className="mt-1.5 text-[34px] font-semibold tracking-[-0.02em] text-[#0f172a]">{formatMoneyCompactSigned(totalOpenMetric.delta)}</p>
              <p className="mt-2 text-xs text-[#64748b] break-words">
                {fromPeriod}: {formatMoneyCompact(totalOpenMetric.from_value)} → {toPeriod}: {formatMoneyCompact(totalOpenMetric.to_value)}
              </p>
            </article>
            <div className="xl:col-span-2">
              <KpiCard
                title="Overdue"
                metric={overdueMetric}
                money
                accent="border-t-rose-200"
                fromLabel={fromPeriod}
                toLabel={toPeriod}
                positiveIsBad
              />
            </div>
            <div className="xl:col-span-2">
              <KpiCard
                title="Not Due / A Vencer"
                metric={notDueMetric}
                money
                accent="border-t-blue-200"
                fromLabel={fromPeriod}
                toLabel={toPeriod}
              />
            </div>
            <div className="xl:col-span-2">
              <KpiCard
                title="Exposição"
                metric={exposureMetric}
                money
                accent="border-t-amber-200"
                fromLabel={fromPeriod}
                toLabel={toPeriod}
                positiveIsBad
              />
            </div>
            <div className="xl:col-span-2">
              <KpiCard
                title="Limite COFACE"
                metric={insuredMetric}
                money
                accent="border-t-emerald-200"
                fromLabel={fromPeriod}
                toLabel={toPeriod}
              />
            </div>
          </section>

          <section className="grid grid-cols-1 gap-6 lg:grid-cols-10">
            <div className="lg:col-span-7">
              <WaterfallExecutive
                waterfall={comparisonQuery.data?.waterfall}
              />
            </div>
            <div className="lg:col-span-3">
              <ExecutiveInsights
                newGroups={comparisonQuery.data?.new_groups ?? []}
                topIncreases={comparisonQuery.data?.top_increases ?? []}
                topDecreases={comparisonQuery.data?.top_decreases ?? []}
                removedGroups={comparisonQuery.data?.removed_groups ?? []}
              />
            </div>
          </section>

          <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <GroupDeltaTable
              title="Aumento de Receita"
              rows={comparisonQuery.data?.new_groups ?? []}
              fromPeriodLabel={fromPeriod}
              toPeriodLabel={toPeriod}
            />
            <GroupDeltaTable
              title="Redução de Receita"
              rows={comparisonQuery.data?.removed_groups ?? []}
              fromPeriodLabel={fromPeriod}
              toPeriodLabel={toPeriod}
            />
          </section>

          <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <GroupDeltaTable
              title="Maiores Aumentos de Exposição"
              rows={comparisonQuery.data?.top_increases ?? []}
              fromPeriodLabel={fromPeriod}
              toPeriodLabel={toPeriod}
            />
            <GroupDeltaTable
              title="Maiores Reduções de Exposição"
              rows={comparisonQuery.data?.top_decreases ?? []}
              fromPeriodLabel={fromPeriod}
              toPeriodLabel={toPeriod}
            />
          </section>
        </>
      ) : null}
    </section>
  );
}
