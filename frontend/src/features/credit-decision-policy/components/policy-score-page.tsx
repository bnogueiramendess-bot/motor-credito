"use client";

import {
  AlertCircle,
  ArrowRight,
  Beaker,
  Building2,
  Calculator,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  CircleDot,
  Database,
  Factory,
  FileClock,
  Globe2,
  Layers3,
  Lock,
  Percent,
  Scale,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp
} from "lucide-react";
import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";

import {
  getCurrentScoreStructure,
  PillarOneSimulationResultDto,
  PillarFourSimulationResultDto,
  PillarTwoSimulationResultDto,
  ScoreIndicatorDto,
  ScorePillarDto,
  ScorePillarRoadmapDto,
  ScorePolicyProgressDto,
  ScoreRangeDto,
  ScoreStructureDto,
  ScoreSubgroupDto,
  ScoreValidationCheckDto,
  ScoreValidationIssueDto,
  simulatePillarOneScore,
  simulatePillarFourScore,
  simulatePillarTwoScore
} from "@/features/credit-decision-policy/api/score-policy.api";
import { formatCurrencyInputBRL, toNullableNumberInput } from "@/features/analysis-journey/utils/formatters";
import { hasPermission } from "@/shared/lib/auth/permissions";

function toNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(numberValue) ? numberValue : null;
}

function displayPercent(value: string | number | null | undefined) {
  const numberValue = toNumber(value);
  if (numberValue === null) return "-";
  return `${numberValue.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

function displayDecimal(value: string | number | null | undefined) {
  const numberValue = toNumber(value);
  if (numberValue === null) return "-";
  return numberValue.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function displayScore(value: string | number | null | undefined) {
  const numberValue = toNumber(value);
  if (numberValue === null) return "-";
  return numberValue.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function displayCurrency(value: string | number | null | undefined) {
  const numberValue = toNumber(value);
  if (numberValue === null) return "-";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(numberValue);
}

function displayPoints(value: string | number | null | undefined) {
  const numberValue = toNumber(value);
  if (numberValue === null) return "-";
  return `${numberValue.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} pontos`;
}

function formatOptionalCurrencyInput(value: string) {
  return value.replace(/\D/g, "") ? formatCurrencyInputBRL(value) : "";
}

type PillarOneInputKind = "currency" | "decimal" | "percent" | "count";

const PILLAR_ONE_INPUT_KIND: Record<string, PillarOneInputKind> = {
  current_liquidity: "decimal",
  quick_liquidity: "decimal",
  general_liquidity: "decimal",
  immediate_liquidity: "decimal",
  ebitda: "currency",
  cash_flow: "currency",
  dre_result: "currency",
  indebtedness: "percent",
  financial_leverage: "decimal",
  gross_margin: "percent",
  operational_index: "decimal",
  financial_inconsistencies: "count",
  critical_alerts: "count",
  detected_anomalies: "count"
};

const PILLAR_ONE_HELPER_TEXT: Record<string, string> = {
  financial_inconsistencies: "Quantidade de inconsistências identificadas.",
  critical_alerts: "Quantidade de alertas críticos identificados.",
  detected_anomalies: "Quantidade de anomalias detectadas."
};

function formatDecimalInput(value: string) {
  const normalized = value.replace(/[^\d,.-]/g, "").replace(/\./g, ",");
  const [integer = "", ...decimalParts] = normalized.split(",");
  const decimal = decimalParts.join("").slice(0, 4);
  return decimalParts.length ? `${integer},${decimal}` : integer;
}

function formatPillarOneInput(code: string, value: string) {
  const kind = PILLAR_ONE_INPUT_KIND[code] ?? "decimal";
  if (kind === "currency") return formatOptionalCurrencyInput(value);
  if (kind === "count") return value.replace(/\D/g, "");
  const decimal = formatDecimalInput(value);
  return kind === "percent" && decimal ? `${decimal}%` : decimal;
}

function pillarOneInputPlaceholder(code: string) {
  const kind = PILLAR_ONE_INPUT_KIND[code] ?? "decimal";
  if (kind === "currency") return "R$ 1.500.000,00";
  if (kind === "percent") return "Ex.: 35%";
  if (kind === "count") return "Ex.: 0";
  return "Ex.: 1,80";
}

function pillarOnePayloadValue(code: string, value: string) {
  const kind = PILLAR_ONE_INPUT_KIND[code] ?? "decimal";
  if (kind === "currency" || kind === "percent" || kind === "decimal") return toNullableNumberInput(value);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function displayPillarOneIndicatorValue(code: string, value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return "-";
  const kind = PILLAR_ONE_INPUT_KIND[code] ?? "decimal";
  if (kind === "currency") return displayCurrency(value);
  if (kind === "percent") return displayPercent(value);
  if (kind === "count") return String(value);
  return displayDecimal(value);
}

function displayRatioPercent(value: string | number | null | undefined) {
  const numberValue = toNumber(value);
  if (numberValue === null) return "-";
  return `${(numberValue * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

function formatCnpjInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 14);
  return digits
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

function displaySnapshotDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  const month = date.toLocaleString("pt-BR", { month: "short" }).replace(".", "");
  return `${month.charAt(0).toUpperCase()}${month.slice(1)}/${date.getFullYear()}`;
}

function displayRatioRange(range: ScoreRangeDto) {
  if (range.operator === "between") {
    return `Entre ${displayRatioPercent(range.threshold_value)} e ${displayRatioPercent(range.threshold_value_to)}`;
  }
  return `${range.operator} ${displayRatioPercent(range.threshold_value)}`;
}

function displayRange(range: ScoreRangeDto) {
  const operatorLabel: Record<string, string> = {
    ">=": ">=",
    ">": ">",
    "<=": "<=",
    "<": "<",
    "=": "=",
    between: "Entre"
  };
  if (range.operator === "between") {
    return `${operatorLabel.between} ${displayDecimal(range.threshold_value)} e ${displayDecimal(range.threshold_value_to)}`;
  }
  return `${operatorLabel[range.operator] ?? range.operator} ${displayDecimal(range.threshold_value)}`;
}

function statusLabel(status: string) {
  if (status === "validated" || status === "valid") return "Validada";
  if (status === "incomplete") return "Em construção";
  if (status === "warning") return "Com alertas";
  if (status === "invalid") return "Inválida";
  if (status === "covered_by_coface") return "Coberta por COFACE";
  if (status === "not_available") return "Não disponibilizado";
  if (status === "calculated") return "Calculada";
  return status;
}

function statusClass(status: string) {
  if (status === "validated" || status === "valid" || status === "calculated" || status === "covered_by_coface") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "incomplete" || status === "warning" || status === "not_available") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (status === "invalid") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function lifecycleLabel(status: string | undefined) {
  if (status === "active") return "Política ativa";
  if (status === "draft") return "Rascunho";
  if (status === "archived") return "Arquivada";
  return status ?? "Carregando";
}

function lifecycleClass(status: string | undefined) {
  if (status === "active") return "border-emerald-300/30 bg-emerald-400/15 text-emerald-100";
  if (status === "draft") return "border-amber-300/30 bg-amber-400/15 text-amber-100";
  return "border-white/15 bg-white/10 text-white/75";
}

function sourceInfo(indicator: ScoreIndicatorDto) {
  const sourceKey = indicator.source_key ?? "";
  if (sourceKey.startsWith("agrisk_financial.")) {
    return {
      origin: "Agrisk Financial Analysis",
      field: indicator.name,
      technicalPath: sourceKey
    };
  }
  return {
    origin: "Política de Decisão",
    field: indicator.name,
    technicalPath: sourceKey
  };
}

function firstEnabled<T>(items: T[] | undefined): T | null {
  return items && items.length > 0 ? items[0] : null;
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">{text}</div>;
}

function Disclosure({
  title,
  subtitle,
  children,
  defaultOpen = false,
  icon
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  icon?: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group rounded-lg border border-slate-200 bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4">
        <span className="flex min-w-0 items-start gap-3">
          {icon ? <span className="mt-0.5 text-slate-500">{icon}</span> : null}
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-900">{title}</span>
            {subtitle ? <span className="mt-1 block text-xs leading-5 text-slate-500">{subtitle}</span> : null}
          </span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-180" />
      </summary>
      <div className="border-t border-slate-100 p-4">{children}</div>
    </details>
  );
}

function Hero({ structure, selectedPillar }: { structure: ScoreStructureDto | null; selectedPillar: ScorePillarDto | null }) {
  const policy = structure?.policy;
  const configurationStatus = structure?.validation_summary.configuration_status ?? "incomplete";
  return (
    <section className="overflow-hidden rounded-lg bg-[#0B132B] text-white shadow-[0_12px_30px_rgba(15,23,42,0.12)]">
      <div className="relative border border-white/10 bg-[#0B132B] px-5 py-4 sm:px-6">
        <div className="relative grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase text-white/55">Motor de Crédito · Administração da Política</div>
            <h1 className="mt-1.5 max-w-4xl text-xl font-semibold leading-tight text-white sm:text-2xl">
              Política de Decisão Configurável
            </h1>
            <p className="mt-1 text-sm font-semibold text-blue-100">
              {selectedPillar ? `Pilar ${selectedPillar.sort_order} · ${selectedPillar.name}` : "Estrutura da Política"}
            </p>
            <p className="mt-1.5 max-w-3xl text-xs leading-5 text-white/60">
              Governança, validação e simulação isolada da política parametrizável, ainda não conectada ao motor oficial.
            </p>
          </div>
          <div className="rounded-lg border border-white/12 bg-white/[0.07] px-3 py-2.5 backdrop-blur sm:min-w-[390px]">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${lifecycleClass(policy?.status)}`}>
                {lifecycleLabel(policy?.status)}
              </span>
              <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${statusClass(configurationStatus)}`}>
                {statusLabel(configurationStatus)}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
              <span className="text-white/48">
                Código <strong className="ml-1 text-white/90">{policy?.code ?? "-"}</strong>
              </span>
              <span className="text-white/48">
                Versão <strong className="ml-1 text-white/90">{policy?.version ?? "-"}</strong>
              </span>
              <span className="min-w-0 text-white/48">
                Política <strong className="ml-1 text-white/90">{policy?.name ?? "Política de Decisão"}</strong>
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Toolbar() {
  return (
    <div className="flex flex-col gap-3 py-5 lg:flex-row lg:items-center lg:justify-between">
      <div className="inline-flex w-fit rounded-full bg-slate-200 p-1 text-xs font-semibold text-slate-600">
        <span className="rounded-full px-4 py-2">Cenários</span>
        <span className="rounded-full bg-white px-4 py-2 text-blue-700 shadow-sm">Score Institucional</span>
        <span className="rounded-full px-4 py-2">Comitê</span>
        <span className="rounded-full px-4 py-2">Versões</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button disabled className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-400">
          Salvar rascunho
        </button>
        <button disabled className="rounded-lg border border-slate-200 bg-slate-100 px-4 py-2 text-xs font-bold text-slate-400">
          Ativar nova versao
        </button>
      </div>
    </div>
  );
}

function PillarSidebar({
  pillars,
  roadmap,
  selectedPillarCode,
  onSelect
}: {
  pillars: ScorePillarDto[];
  roadmap: ScorePillarRoadmapDto[];
  selectedPillarCode: string | null;
  onSelect: (item: ScorePillarRoadmapDto, pillar: ScorePillarDto | null) => void;
}) {
  return (
    <aside className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)]">
      <div className="border-b border-slate-200 px-4 py-4">
        <h2 className="text-sm font-semibold text-slate-900">Evolução da Política</h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">Roadmap dos pilares previstos nesta versão.</p>
      </div>
      <div className="max-h-[calc(100vh-9rem)] overflow-auto p-3">
        <div className="grid gap-2">
          {roadmap.map((item) => {
            const pillar = pillars.find((candidate) => candidate.id === item.id) ?? null;
            const active = item.code === selectedPillarCode;
            const selectable = Boolean(pillar) || item.code === PILLAR_THREE_CODE;
            const StatusIcon = item.status === "configured" ? CheckCircle2 : item.status === "partial" ? CircleDot : CircleDashed;
            return (
              <button
                key={item.code}
                type="button"
                disabled={!selectable}
                onClick={() => selectable && onSelect(item, pillar)}
                className={`rounded-lg border p-3 text-left transition ${
                  active
                    ? "border-blue-200 bg-blue-50 text-blue-800"
                    : pillar
                      ? "border-transparent text-slate-700 hover:border-slate-200 hover:bg-slate-50"
                      : selectable
                        ? "border-dashed border-slate-200 bg-slate-50/70 text-slate-500 hover:border-slate-300 hover:bg-slate-50"
                        : "cursor-default border-dashed border-slate-200 bg-slate-50/70 text-slate-500"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 gap-2.5">
                    <StatusIcon
                      className={`mt-0.5 h-4 w-4 shrink-0 ${
                        item.status === "configured" ? "text-emerald-600" : item.status === "partial" ? "text-amber-600" : "text-slate-400"
                      }`}
                    />
                    <div>
                      <span className="block text-[11px] font-bold uppercase text-slate-400">Pilar {item.sort_order}</span>
                      <strong className="mt-1 block text-sm leading-5">{item.code === PILLAR_THREE_CODE ? "Condições de Mercado" : item.name}</strong>
                      <span className="mt-2 block text-xs text-slate-500">
                        {item.status === "configured" ? "Configurado" : item.status === "partial" ? "Em configuração" : "Não iniciado"}
                      </span>
                    </div>
                  </div>
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-700 shadow-sm">{displayPercent(item.weight_percent)}</span>
                </div>
              </button>
            );
          })}
          {roadmap.length === 0 ? <EmptyState text="Nenhum pilar previsto para a política selecionada." /> : null}
        </div>
      </div>
    </aside>
  );
}

function PillarSummary({ pillar, validationStatus }: { pillar: ScorePillarDto | null; validationStatus: string }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-4">
        <h2 className="text-sm font-semibold text-slate-900">Resumo do Pilar</h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">Visao executiva da estrutura parametrizada.</p>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <span className="text-xs font-bold uppercase text-slate-500">Peso institucional</span>
          <strong className="mt-2 block text-2xl text-slate-950">{displayPercent(pillar?.weight_percent)}</strong>
          <small className="text-xs text-slate-500">Configurável por versão</small>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <span className="text-xs font-bold uppercase text-slate-500">Subgrupos</span>
          <strong className="mt-2 block text-2xl text-slate-950">{pillar?.subgroups_count ?? "-"}</strong>
          <small className="text-xs text-slate-500">Soma validada no backend</small>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <span className="text-xs font-bold uppercase text-slate-500">Indicadores</span>
          <strong className="mt-2 block text-2xl text-slate-950">{pillar?.indicators_count ?? "-"}</strong>
          <small className="text-xs text-slate-500">Com origem rastreável</small>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <span className="text-xs font-bold uppercase text-slate-500">Status geral</span>
          <strong className={`mt-2 inline-flex rounded-full border px-3 py-1 text-sm ${statusClass(validationStatus)}`}>{statusLabel(validationStatus)}</strong>
          <small className="mt-2 block text-xs text-slate-500">Detalhado no painel lateral</small>
        </div>
      </div>
    </section>
  );
}

function PolicyProgress({ progress }: { progress: ScorePolicyProgressDto | null }) {
  const items = progress
    ? [
        { label: "Pilares configurados", value: progress.pillars.configured, expected: progress.pillars.expected },
        { label: "Subgrupos configurados", value: progress.subgroups.configured, expected: progress.subgroups.expected },
        { label: "Indicadores configurados", value: progress.indicators.configured, expected: progress.indicators.expected },
        {
          label: "Indicadores com faixas",
          value: progress.indicators_with_ranges.configured,
          expected: progress.indicators_with_ranges.expected
        }
      ]
    : [];

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Progresso da Configuração</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">Leitura executiva do estágio atual da política.</p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800">
          <Layers3 className="h-4 w-4" />
          {progress?.score_ranges_count ?? 0} faixas cadastradas
        </div>
      </div>
      <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => {
          const percent = item.expected > 0 ? Math.min(100, (item.value / item.expected) * 100) : 0;
          return (
            <div key={item.label} className="min-w-0">
              <div className="flex items-end justify-between gap-3">
                <span className="text-xs font-semibold leading-5 text-slate-600">{item.label}</span>
                <strong className="shrink-0 text-sm text-slate-950">
                  {item.value} / {item.expected}
                </strong>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-blue-600 transition-[width]" style={{ width: `${percent}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SubgroupList({
  pillar,
  selectedSubgroupId,
  onSelect
}: {
  pillar: ScorePillarDto | null;
  selectedSubgroupId: number | null;
  onSelect: (subgroup: ScoreSubgroupDto) => void;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-4">
        <h2 className="text-sm font-semibold text-slate-900">Subgrupos do Pilar</h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">Selecione um subgrupo para revisar seus indicadores.</p>
      </div>
      <div className="max-h-[360px] overflow-auto p-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
          {pillar?.subgroups.map((subgroup) => {
            const active = subgroup.id === selectedSubgroupId;
            return (
              <button
                key={subgroup.id}
                type="button"
                onClick={() => onSelect(subgroup)}
                className={`rounded-lg border p-3 text-left transition ${
                  active ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"
                }`}
              >
                <strong className="block min-h-10 text-sm leading-5 text-slate-900">{subgroup.name}</strong>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full rounded-full bg-blue-600" style={{ width: displayPercent(subgroup.weight_percent) }} />
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{displayPercent(subgroup.weight_percent)}</span>
                  <span className="text-xs text-slate-500">{subgroup.indicators_count} indicadores</span>
                </div>
              </button>
            );
          })}
          {!pillar?.subgroups.length ? <EmptyState text="Nenhum subgrupo cadastrado para este pilar." /> : null}
        </div>
      </div>
    </section>
  );
}

function IndicatorList({
  subgroup,
  selectedIndicatorId,
  onSelect
}: {
  subgroup: ScoreSubgroupDto | null;
  selectedIndicatorId: number | null;
  onSelect: (indicator: ScoreIndicatorDto) => void;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-4">
        <h2 className="text-sm font-semibold text-slate-900">Indicadores{subgroup ? ` · ${subgroup.name}` : ""}</h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">Linguagem de negócio primeiro; detalhe técnico sob demanda.</p>
      </div>
      <div className="p-4">
        <div className="max-h-[440px] overflow-auto rounded-lg border border-slate-200">
          {subgroup?.indicators.map((indicator) => {
            const active = indicator.id === selectedIndicatorId;
            const info = sourceInfo(indicator);
            return (
              <button
                key={indicator.id}
                type="button"
                onClick={() => onSelect(indicator)}
                className={`grid w-full grid-cols-[1fr_auto] gap-3 border-b border-slate-200 px-4 py-3 text-left last:border-b-0 lg:grid-cols-[1fr_90px] ${
                  active ? "bg-blue-50 shadow-[inset_3px_0_0_#2563eb]" : "bg-white hover:bg-slate-50"
                }`}
              >
                <span>
                  <strong className="block text-sm text-slate-900">{indicator.name}</strong>
                  <span className="mt-1 block text-xs leading-5 text-slate-500">
                    Origem: {info.origin} · Campo: {info.field}
                  </span>
                </span>
                <span className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-right text-xs font-bold text-slate-800">{displayPercent(indicator.weight_percent)}</span>
              </button>
            );
          })}
          {!subgroup?.indicators.length ? <EmptyState text="Nenhum indicador cadastrado para este subgrupo." /> : null}
        </div>
      </div>
    </section>
  );
}

function TechnicalIndicatorDetail({ indicator }: { indicator: ScoreIndicatorDto | null }) {
  if (!indicator) return null;
  const info = sourceInfo(indicator);
  return (
    <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-bold text-slate-600">
        Ver detalhe técnico
        <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" />
      </summary>
      <div className="border-t border-slate-200 px-3 py-3 text-xs leading-5 text-slate-600">
        <p>
          <strong>source_key:</strong> <span className="break-all font-mono">{info.technicalPath}</span>
        </p>
        <p>
          <strong>Metodo:</strong> {indicator.aggregation_method}
        </p>
        <p>
          <strong>Dados ausentes:</strong> {indicator.missing_data_behavior}
        </p>
      </div>
    </details>
  );
}

function ScoreRangeTable({ indicator }: { indicator: ScoreIndicatorDto | null }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-4">
        <h2 className="text-sm font-semibold text-slate-900">Faixas de Pontuação{indicator ? ` · ${indicator.name}` : ""}</h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">Tabela executiva das condicoes avaliadas pelo backend.</p>
        <TechnicalIndicatorDetail indicator={indicator} />
      </div>
      <div className="p-4">
        <div className="max-h-[420px] overflow-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[420px] border-collapse text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="px-4 py-3">Faixa</th>
                <th className="w-28 px-4 py-3 text-right">Nota</th>
              </tr>
            </thead>
            <tbody>
              {indicator?.score_ranges.map((range) => (
                <tr key={range.id} className="border-b border-slate-100 bg-white last:border-b-0">
                  <td className="px-4 py-3 font-semibold text-slate-800">{displayRange(range)}</td>
                  <td className="px-4 py-3 text-right">
                    <span className="inline-flex min-w-10 justify-center rounded-lg bg-indigo-50 px-3 py-2 font-black text-indigo-700">{displayScore(range.score)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!indicator?.score_ranges.length ? <div className="p-4"><EmptyState text="Nenhuma faixa cadastrada para este indicador." /></div> : null}
        </div>
        {indicator?.score_ranges.length ? (
          <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50">
            <summary className="cursor-pointer list-none px-3 py-2 text-xs font-bold text-slate-600">Ver informacoes completas das faixas</summary>
            <div className="grid gap-2 border-t border-slate-200 p-3 text-xs text-slate-600">
              {indicator.score_ranges.map((range) => (
                <div key={range.id} className="rounded-md bg-white p-2">
                  Ordem {range.sort_order} · operador {range.operator} · valor {displayDecimal(range.threshold_value)} · valor final {displayDecimal(range.threshold_value_to)} · label {range.label ?? "-"}
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </section>
  );
}

function ValidationItem({ item }: { item: ScoreValidationIssueDto | ScoreValidationCheckDto }) {
  const message = "message" in item ? item.message : item.label;
  const code = "code" in item ? item.code : "validation";
  const status = "status" in item ? item.status : "issue";
  return (
    <details className="rounded-md border border-slate-200 bg-white">
      <summary className="cursor-pointer list-none px-3 py-2 text-xs font-semibold text-slate-700">{message}</summary>
      <div className="border-t border-slate-100 px-3 py-2 text-xs leading-5 text-slate-500">
        <p>Codigo: {code}</p>
        {"scope" in item ? <p>Escopo: {item.scope}</p> : null}
        {"value" in item ? <p>Valor atual: {displayPercent(item.value)}</p> : null}
        {"expected" in item ? <p>Esperado: {displayPercent(item.expected)}</p> : null}
        {"status" in item ? <p>Status: {statusLabel(status)}</p> : null}
      </div>
    </details>
  );
}

type WarningGroupDto = {
  severity: string;
  code: string;
  message: string;
  warnings: ScoreValidationIssueDto[];
};

function normalizedText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function warningTaxonomy(warning: ScoreValidationIssueDto) {
  const message = normalizedText(warning.message);
  const isIndicatorWithoutRanges =
    warning.code === "indicator_without_score_ranges" ||
    ((warning.entity_type === "indicator" || warning.scope === "indicator") && message.includes("sem faixa"));
  if (isIndicatorWithoutRanges) {
    return {
      code: "indicator_without_score_ranges",
      message: "Indicador habilitado sem faixa de pontuação cadastrada."
    };
  }

  const isPolicyUnderConstruction =
    warning.code === "pillars_not_configured" ||
    ((warning.entity_type === "policy" || warning.scope === "policy") && message.includes("pilar") && message.includes("configur"));
  if (isPolicyUnderConstruction) {
    return {
      code: "pillars_not_configured",
      message: "Política em construção com pilares ainda não configurados."
    };
  }

  return { code: warning.code, message: warning.message };
}

function groupWarnings(warnings: ScoreValidationIssueDto[]): WarningGroupDto[] {
  const groups = new Map<string, WarningGroupDto>();
  for (const warning of warnings) {
    const severity = warning.severity ?? "warning";
    const taxonomy = warningTaxonomy(warning);
    const key = `${severity}::${taxonomy.code}::${taxonomy.message}`;
    const current = groups.get(key);
    groups.set(key, {
      severity,
      code: taxonomy.code,
      message: taxonomy.message,
      warnings: [...(current?.warnings ?? []), warning]
    });
  }
  return Array.from(groups.values());
}

function WarningGroup({ group }: { group: WarningGroupDto }) {
  const warnings = group.warnings;
  const first = warnings[0];
  const entities = Array.from(
    new Map(
      warnings
        .filter((warning) => (warning.entity_type === "indicator" || warning.scope === "indicator") && warning.entity_name)
        .map((warning) => [warning.entity_code ?? warning.entity_name, warning])
    ).values()
  );
  const affectedCount = group.code === "pillars_not_configured" ? first.affected_count ?? warnings.length : entities.length || warnings.length;
  const title =
    group.code === "pillars_not_configured"
      ? "Política em construção"
      : group.code === "indicator_without_score_ranges"
        ? "Indicadores sem faixa de pontuação"
        : group.message;
  const summary =
    group.code === "pillars_not_configured"
      ? `${affectedCount} ${affectedCount === 1 ? "pilar ainda não foi configurado" : "pilares ainda não foram configurados"}.`
      : group.code === "indicator_without_score_ranges"
        ? `${affectedCount} ${affectedCount === 1 ? "indicador habilitado ainda não possui" : "indicadores habilitados ainda não possuem"} faixas de pontuação.`
        : `${affectedCount} ${affectedCount === 1 ? "item requer" : "itens requerem"} revisão.`;

  return (
    <details className="group rounded-lg border border-amber-200 bg-amber-50/70">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-3 py-3">
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <strong className="text-sm text-amber-950">{title}</strong>
            <span className="rounded-full bg-amber-200/70 px-2 py-0.5 text-[11px] font-bold text-amber-900">{warnings.length}</span>
          </span>
          <span className="mt-1 block text-xs leading-5 text-amber-900/75">{summary}</span>
          {entities.length ? <span className="mt-2 block text-xs font-bold text-amber-800">Ver indicadores</span> : null}
        </span>
        <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-amber-700 transition group-open:rotate-180" />
      </summary>
      <div className="border-t border-amber-200 px-3 py-3">
        {entities.length ? (
          <div className="max-h-56 overflow-auto pr-1">
            <ul className="grid gap-1.5">
              {entities.map((warning, index) => (
                <li key={`${warning.entity_code}-${index}`} className="rounded-md border border-amber-100 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                  {warning.entity_name}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-xs leading-5 text-amber-900/80">{first.message}</p>
        )}
        <details className="mt-3 rounded-md border border-amber-200 bg-white/70">
          <summary className="cursor-pointer list-none px-3 py-2 text-[11px] font-bold text-amber-800">Ver detalhes técnicos</summary>
          <div className="grid gap-2 border-t border-amber-100 px-3 py-2 font-mono text-[11px] leading-5 text-slate-600">
            <p>severity: {group.severity}</p>
            <p>group_code: {group.code}</p>
            <p>group_message: {group.message}</p>
            <p>source_codes: {Array.from(new Set(warnings.map((warning) => warning.code))).join(", ")}</p>
          </div>
        </details>
      </div>
    </details>
  );
}

function ValidationPanel({ structure }: { structure: ScoreStructureDto | null }) {
  const validation = structure?.validation_summary;
  const approved = validation?.checks.filter((check) => check.status === "valid") ?? [];
  const warnings = validation?.warnings ?? [];
  const warningGroups = groupWarnings(warnings);
  const errors = validation?.errors ?? [];
  return (
    <div className="grid gap-4">
      <div className={`rounded-lg border p-3 ${statusClass(validation?.configuration_status ?? "incomplete")}`}>
        <div className="text-xs font-bold uppercase">Status geral</div>
        <div className="mt-1 text-lg font-bold">{statusLabel(validation?.configuration_status ?? "incomplete")}</div>
        <p className="mt-1 text-xs leading-5 opacity-80">
          {validation?.configuration_status === "invalid"
            ? "Existem erros estruturais que precisam ser corrigidos."
            : validation?.configuration_status === "validated"
              ? "A estrutura está pronta para o próximo ciclo de governança."
              : "A política está em evolução e ainda possui itens pendentes."}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-rose-100 bg-rose-50 p-3">
          <span className="block text-[11px] font-bold uppercase text-rose-700">Erros</span>
          <strong className="mt-1 block text-xl text-rose-800">{errors.length}</strong>
        </div>
        <div className="rounded-lg border border-amber-100 bg-amber-50 p-3">
          <span className="block text-[11px] font-bold uppercase text-amber-700">Alertas</span>
          <strong className="mt-1 block text-xl text-amber-800">{warnings.length}</strong>
        </div>
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3">
          <span className="block text-[11px] font-bold uppercase text-emerald-700">Aprovadas</span>
          <strong className="mt-1 block text-xl text-emerald-800">{approved.length}</strong>
        </div>
      </div>
      <div className="grid gap-3">
        <Disclosure title={`Erros críticos (${errors.length})`} defaultOpen={errors.length > 0}>
          <div className="grid gap-2">
            {errors.map((error, index) => <ValidationItem key={`${error.scope}-${error.code}-${index}`} item={error} />)}
            {!errors.length ? <p className="text-xs text-slate-500">Nenhum erro critico encontrado.</p> : null}
          </div>
        </Disclosure>
        <Disclosure title={`Alertas (${warnings.length})`} defaultOpen={errors.length === 0 && warnings.length > 0}>
          <div className="grid gap-2">
            {warningGroups.map((group) => <WarningGroup key={`${group.severity}-${group.code}-${group.message}`} group={group} />)}
            {!warnings.length ? <p className="text-xs text-slate-500">Nenhum alerta encontrado.</p> : null}
          </div>
        </Disclosure>
        <Disclosure title={`Validações aprovadas (${approved.length})`}>
          <div className="grid max-h-72 gap-2 overflow-auto pr-1">
            {approved.map((check, index) => <ValidationItem key={`${check.code}-${index}`} item={check} />)}
            {!approved.length ? <p className="text-xs text-slate-500">Nenhuma validação aprovada retornada.</p> : null}
          </div>
        </Disclosure>
      </div>
    </div>
  );
}

function SimulationPanel({
  policyId,
  subgroups,
  result,
  onResult
}: {
  policyId: number | null;
  subgroups: ScoreSubgroupDto[];
  result: PillarOneSimulationResultDto | null;
  onResult: (result: PillarOneSimulationResultDto | null) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [analysisId, setAnalysisId] = useState("");
  const [cofaceValid, setCofaceValid] = useState(false);
  const [openSubgroupId, setOpenSubgroupId] = useState<number | null>(subgroups[0]?.id ?? null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValues({});
    setAnalysisId("");
    setCofaceValid(false);
    setOpenSubgroupId(subgroups[0]?.id ?? null);
    setError(null);
    onResult(null);
  }, [policyId, onResult, subgroups]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!policyId) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const cleanAnalysisId = analysisId.trim() ? Number(analysisId.trim()) : null;
      const indicatorValues = Object.fromEntries(
        Object.entries(values)
          .filter(([, value]) => value.trim() !== "")
          .map(([code, value]) => [code, pillarOnePayloadValue(code, value)])
      );
      const response = await simulatePillarOneScore(policyId, {
        coface_valid: cofaceValid,
        analysis_id: cleanAnalysisId,
        indicator_values: cleanAnalysisId || cofaceValid ? undefined : indicatorValues
      });
      onResult(response);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível simular o Pilar 1.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function clearSimulation() {
    setValues({});
    setAnalysisId("");
    setCofaceValid(false);
    setOpenSubgroupId(subgroups[0]?.id ?? null);
    setError(null);
    onResult(null);
  }

  const resultIndicators = result?.indicators.filter(
    (indicator): indicator is Record<string, unknown> & { code: string } => typeof indicator.code === "string"
  ) ?? [];

  return (
    <form onSubmit={handleSubmit} className="grid gap-3">
      <fieldset className="rounded-lg border border-blue-100 bg-blue-50/60 p-3">
        <legend className="px-1 text-[10px] font-black uppercase tracking-wide text-blue-800">Modo de simulação</legend>
        <div className="grid gap-2">
          <label className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 transition ${!cofaceValid ? "border-blue-200 bg-white shadow-sm" : "border-transparent"}`}>
            <input type="radio" name="pillar-one-mode" checked={!cofaceValid} onChange={() => setCofaceValid(false)} className="mt-0.5" />
            <span><b className="block text-xs text-slate-800">Utilizar indicadores financeiros</b><small className="mt-0.5 block text-[10px] leading-4 text-slate-500">Avalia os dados informados ou carregados da análise.</small></span>
          </label>
          <label className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 transition ${cofaceValid ? "border-emerald-200 bg-white shadow-sm" : "border-transparent"}`}>
            <input type="radio" name="pillar-one-mode" checked={cofaceValid} onChange={() => setCofaceValid(true)} className="mt-0.5" />
            <span><b className="block text-xs text-slate-800">Simular cliente coberto pela COFACE</b><small className="mt-0.5 block text-[10px] leading-4 text-slate-500">Aplica a regra especial 10/10 do Pilar 1 no backend.</small></span>
          </label>
        </div>
      </fieldset>
      <label className="grid gap-1 text-xs font-semibold text-slate-700">
        ID da análise (opcional)
        <input
          value={analysisId}
          onChange={(event) => setAnalysisId(event.target.value)}
          className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 outline-none focus:border-blue-500"
          placeholder="Ex.: 123"
        />
        <small className="text-[10px] font-normal leading-4 text-slate-500">Se informado, os dados do Agrisk Financial Analysis serão carregados automaticamente.</small>
      </label>
      <div className="grid gap-2">
        {subgroups.map((subgroup) => {
          const open = subgroup.id === openSubgroupId;
          return (
            <section key={subgroup.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <button type="button" onClick={() => setOpenSubgroupId(open ? null : subgroup.id)} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left">
                <span><b className="block text-xs text-slate-800">{subgroup.name}</b><small className="mt-0.5 block text-[10px] text-slate-500">{subgroup.indicators.length} indicadores</small></span>
                <ChevronDown className={`h-4 w-4 text-slate-400 transition ${open ? "rotate-180" : ""}`} />
              </button>
              {open ? (
                <div className="grid gap-2 border-t border-slate-100 bg-slate-50/60 p-3">
                  {subgroup.indicators.map((indicator) => (
                    <label key={indicator.id} className="grid gap-1 text-xs font-semibold text-slate-700">
                      {indicator.name}
                      <input
                        inputMode={PILLAR_ONE_INPUT_KIND[indicator.code] === "count" ? "numeric" : "decimal"}
                        value={values[indicator.code] ?? ""}
                        onChange={(event) => setValues((current) => ({ ...current, [indicator.code]: formatPillarOneInput(indicator.code, event.target.value) }))}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 outline-none focus:border-blue-500"
                        placeholder={pillarOneInputPlaceholder(indicator.code)}
                        disabled={cofaceValid || Boolean(analysisId.trim())}
                      />
                      {PILLAR_ONE_HELPER_TEXT[indicator.code] ? <small className="text-[10px] font-normal leading-4 text-slate-500">{PILLAR_ONE_HELPER_TEXT[indicator.code]}</small> : null}
                    </label>
                  ))}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="submit" disabled={isSubmitting || !policyId} className="h-10 whitespace-nowrap rounded-lg bg-indigo-600 px-3 text-xs font-black text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300">
          {isSubmitting ? "Simulando..." : "Simular"}
        </button>
        <button type="button" onClick={clearSimulation} disabled={isSubmitting || (!Object.keys(values).length && !analysisId && !cofaceValid && !result && !error)} className="h-10 whitespace-nowrap rounded-lg border border-blue-200 bg-white px-3 text-xs font-black text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:text-slate-300">
          Limpar simulação
        </button>
      </div>
      {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</div> : null}
      {result ? (
        <div className="grid gap-2.5 rounded-xl border border-blue-100 bg-white p-3 text-xs text-slate-600">
          <div className="rounded-xl bg-[#111936] p-4 text-white shadow-[0_10px_24px_rgba(15,23,42,0.16)]">
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-blue-200/75">Nota do Pilar</span>
            <strong className="mt-1 block text-4xl font-black tracking-tight">{displayScore(result.score)} <small className="text-sm font-bold text-white/50">/ 10</small></strong>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-emerald-100 bg-emerald-50/70 p-3">
              <span className="block text-[10px] font-bold uppercase tracking-wide text-emerald-700">Contribuição ao Score</span>
              <strong className="mt-1 block text-lg font-black text-emerald-800">{displayPoints(result.weighted_score)}</strong>
            </div>
            <div className="rounded-lg border border-indigo-100 bg-indigo-50/70 p-3">
              <span className="block text-[10px] font-bold uppercase tracking-wide text-indigo-600">Peso do Pilar</span>
              <strong className="mt-1 block text-xl font-black text-indigo-800">{displayPercent(result.weight_percent)}</strong>
            </div>
          </div>
          {result.reason ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-emerald-800">{result.reason}</div> : null}
          <details className="rounded-lg border border-slate-200 bg-white">
            <summary className="cursor-pointer list-none px-3 py-2.5 font-bold text-slate-700">Como o resultado foi calculado</summary>
            <div className="grid gap-2 border-t border-slate-100 px-3 py-3">
              {resultIndicators.map((indicator) => (
                <div key={indicator.code} className="flex items-start justify-between gap-3">
                  <span className="text-slate-500">{typeof indicator.name === "string" ? indicator.name : indicator.code}</span>
                  <b className="text-right text-slate-800">{displayPillarOneIndicatorValue(indicator.code, indicator.raw_value)}</b>
                </div>
              ))}
              <div className="flex items-start justify-between gap-3 border-t border-slate-100 pt-2">
                <span className="text-slate-500">Nota final</span>
                <b className="text-right text-slate-800">{displayScore(result.score)} / 10</b>
              </div>
            </div>
          </details>
          <details className="rounded-lg border border-slate-200 bg-slate-50">
            <summary className="cursor-pointer list-none px-3 py-2.5 font-bold text-slate-600">Ver detalhes técnicos</summary>
            <pre className="max-h-64 overflow-auto border-t border-slate-200 p-3 text-[10px] leading-5 text-slate-600">{JSON.stringify(result, null, 2)}</pre>
          </details>
        </div>
      ) : null}
    </form>
  );
}

const PILLAR_TWO_CODE = "guarantees_credit_insurance";
const PILLAR_THREE_CODE = "market_conditions";
const PILLAR_FOUR_CODE = "payment_history";

const RANGE_BUSINESS_LABELS: Record<string, string> = {
  ">=:1": "Cobertura integral do limite solicitado",
  ">=:0.8": "Cobertura Elevada",
  ">=:0.6": "Cobertura relevante",
  ">=:0.4": "Cobertura parcial moderada",
  ">:0": "Cobertura residual",
  "=:0": "Sem cobertura COFACE disponível"
};

function PillarTwoSummary({ pillar, status }: { pillar: ScorePillarDto; status: ScorePillarRoadmapDto["status"] }) {
  const activeSubgroup = pillar.subgroups[0] ?? null;
  const activeIndicator = activeSubgroup?.indicators[0] ?? null;
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-4">
        <h2 className="text-sm font-semibold text-slate-900">Resumo do Pilar</h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">Versão atual usa exclusivamente a cobertura COFACE sobre o limite solicitado.</p>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Peso institucional", displayPercent(pillar.weight_percent), "Configurável por versão"],
          ["Subgrupos ativos", String(pillar.subgroups_count), activeSubgroup?.name ?? "Seguro de Crédito"],
          ["Indicadores ativos", String(pillar.indicators_count), activeIndicator?.name ?? "COFACE / Limite solicitado"]
        ].map(([label, value, detail]) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</span>
            <strong className="mt-2 block text-2xl text-slate-950">{value}</strong>
            <small className="text-xs leading-5 text-slate-500">{detail}</small>
          </div>
        ))}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Status geral</span>
          <strong className="mt-2 block">
            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${status === "configured" ? statusClass("valid") : statusClass("warning")}`}>
              {status === "configured" ? "Configurado" : "Em construção"}
            </span>
          </strong>
          <small className="mt-2 block text-xs text-slate-500">Pronto para simulação isolada</small>
        </div>
      </div>
    </section>
  );
}

function PillarTwoSubgroups({ activeSubgroup }: { activeSubgroup: ScoreSubgroupDto | null }) {
  const groups = [
    {
      name: activeSubgroup?.name ?? "Cobertura por Seguro de Crédito",
      weight: displayPercent(activeSubgroup?.weight_percent ?? 100),
      status: "Ativo",
      active: true
    },
    { name: "Garantias Reais e Fiduciárias", weight: "0%", status: "Planejado", active: false },
    { name: "Qualidade Jurídica da Garantia", weight: "0%", status: "Planejado", active: false }
  ];
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-4">
        <h2 className="text-sm font-semibold text-slate-900">Subgrupos do Pilar</h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">A estrutura prevê expansão futura para gestão de garantias pelo Jurídico.</p>
      </div>
      <div className="grid gap-3 p-4 lg:grid-cols-3">
        {groups.map((group) => (
          <div
            key={group.name}
            className={`rounded-xl border p-4 ${group.active ? "border-blue-200 bg-blue-50/80" : "border-dashed border-slate-300 bg-slate-50/70"}`}
          >
            <h3 className="min-h-10 text-sm font-semibold leading-5 text-slate-900">{group.name}</h3>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200">
              <div className={`h-full rounded-full ${group.active ? "w-full bg-indigo-600" : "w-0 bg-slate-400"}`} />
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${group.active ? "bg-indigo-100 text-indigo-700" : "bg-white text-slate-500"}`}>
                {group.status}
              </span>
              <strong className="text-xs text-slate-700">{group.weight}</strong>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function PillarTwoIndicator({ indicator }: { indicator: ScoreIndicatorDto | null }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-4">
        <h2 className="text-sm font-semibold text-slate-900">Indicadores · Cobertura por Seguro de Crédito</h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">Regra objetiva v1: quanto maior a cobertura COFACE frente ao limite solicitado, maior a nota.</p>
      </div>
      <div className="p-4">
        <div className="grid gap-3 rounded-xl border border-blue-100 bg-blue-50/50 px-4 py-4 shadow-[inset_3px_0_0_#4f46e5] lg:grid-cols-[1fr_auto_auto] lg:items-center">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">{indicator?.name ?? "Cobertura COFACE sobre Limite Solicitado"}</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">Origem: COFACE · Fórmula: valor coberto COFACE / limite solicitado</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-center text-xs font-black text-slate-800">
            {displayPercent(indicator?.weight_percent)}
          </div>
          <span className="inline-flex items-center gap-1 text-xs font-bold text-indigo-700">
            Faixas parametrizadas <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>
    </section>
  );
}

function PillarTwoRanges({ indicator }: { indicator: ScoreIndicatorDto | null }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-4">
        <h2 className="text-sm font-semibold text-slate-900">Faixas de Pontuação · Cobertura COFACE</h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">Condições parametrizadas e executadas exclusivamente pelo backend.</p>
      </div>
      <div className="overflow-auto p-4">
        <table className="w-full min-w-[560px] overflow-hidden rounded-xl border border-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
            <tr><th className="px-4 py-3">Faixa</th><th className="px-4 py-3">Nota</th><th className="px-4 py-3">Leitura de negócio</th></tr>
          </thead>
          <tbody>
            {indicator?.score_ranges.map((range) => {
              const key = `${range.operator}:${toNumber(range.threshold_value)}`;
              return (
                <tr key={range.id} className="border-t border-slate-100 bg-white">
                  <td className="px-4 py-3 font-semibold text-slate-800">{displayRatioRange(range)}</td>
                  <td className="px-4 py-3"><span className="inline-flex min-w-10 justify-center rounded-lg bg-indigo-50 px-3 py-2 font-black text-indigo-700">{displayScore(range.score)}</span></td>
                  <td className="px-4 py-3 text-xs text-slate-500">{RANGE_BUSINESS_LABELS[key] ?? range.label ?? "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PillarTwoSimulation({
  policyId,
  result,
  onResult
}: {
  policyId: number | null;
  result: PillarTwoSimulationResultDto | null;
  onResult: (result: PillarTwoSimulationResultDto | null) => void;
}) {
  const [requestedLimit, setRequestedLimit] = useState("");
  const [cofaceCoverage, setCofaceCoverage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const indicator = result?.indicators[0] ?? null;
  const matchedRange = indicator?.matched_range ?? null;
  const matchedRangeKey = matchedRange ? `${matchedRange.operator}:${toNumber(matchedRange.threshold_value)}` : "";
  const matchedRangeBusinessLabel = matchedRange ? RANGE_BUSINESS_LABELS[matchedRangeKey] ?? "Faixa parametrizada aplicada" : "Nenhuma faixa encontrada";
  const trace = result?.calculation_trace[0] ?? null;
  const traceRequestedLimit = trace && "requested_limit_amount" in trace ? trace.requested_limit_amount as string | number | null : null;
  const traceCofaceCoverage = trace && "coface_coverage_amount" in trace ? trace.coface_coverage_amount as string | number | null : null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!policyId) return;
    setIsSubmitting(true);
    setError(null);
    try {
      onResult(await simulatePillarTwoScore(policyId, {
        requested_limit_amount: toNullableNumberInput(requestedLimit),
        coface_coverage_amount: toNullableNumberInput(cofaceCoverage)
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível simular o Pilar 2.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function clearSimulation() {
    setRequestedLimit("");
    setCofaceCoverage("");
    setError(null);
    onResult(null);
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-blue-200 bg-blue-50/70 p-3">
      <div className="grid gap-3">
        <label className="grid gap-1.5 text-xs font-bold text-slate-700">
          Limite solicitado
          <input inputMode="numeric" required value={requestedLimit} onChange={(event) => setRequestedLimit(formatOptionalCurrencyInput(event.target.value))} className="h-10 rounded-lg border border-blue-200 bg-white px-3 text-sm font-semibold outline-none focus:border-indigo-500" placeholder="R$ 5.000.000,00" />
        </label>
        <label className="grid gap-1.5 text-xs font-bold text-slate-700">
          Valor coberto COFACE
          <input inputMode="numeric" value={cofaceCoverage} onChange={(event) => setCofaceCoverage(formatOptionalCurrencyInput(event.target.value))} className="h-10 rounded-lg border border-blue-200 bg-white px-3 text-sm font-semibold outline-none focus:border-indigo-500" placeholder="R$ 3.500.000,00" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button type="submit" disabled={isSubmitting || !policyId} className="h-10 whitespace-nowrap rounded-lg bg-indigo-600 px-3 text-xs font-black text-white shadow-sm transition hover:bg-indigo-700 disabled:bg-indigo-300">
            {isSubmitting ? "Simulando..." : "Simular"}
          </button>
          <button type="button" onClick={clearSimulation} disabled={isSubmitting || (!requestedLimit && !cofaceCoverage && !result && !error)} className="h-10 whitespace-nowrap rounded-lg border border-blue-200 bg-white px-3 text-xs font-black text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:text-slate-300">
            Limpar simulação
          </button>
        </div>
      </div>
      {error ? <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</div> : null}
      {result ? (
        <div className="mt-3 grid gap-2.5 rounded-xl border border-blue-100 bg-white p-3 text-xs text-slate-600">
          <div className="relative overflow-hidden rounded-xl bg-[#111936] p-4 text-white shadow-[0_10px_24px_rgba(15,23,42,0.16)]">
            <div className="absolute -right-5 -top-7 h-24 w-24 rounded-full border-[18px] border-white/[0.06]" />
            <div className="relative">
              <div>
                <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-blue-200/75"><Percent className="h-3.5 w-3.5" /> Cobertura COFACE</span>
                <strong className="mt-1 block text-4xl font-black tracking-tight">{displayRatioPercent(indicator?.raw_ratio)}</strong>
                <span className="mt-1 block text-[11px] text-white/55">do limite solicitado</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-indigo-100 bg-indigo-50/70 p-3">
              <span className="block text-[10px] font-bold uppercase tracking-wide text-indigo-600">Nota atribuída</span>
              <strong className="mt-1 block text-xl font-black text-indigo-800">{displayScore(result.score)} <small className="text-xs font-bold text-indigo-500">/ 10</small></strong>
            </div>
            <div className="rounded-lg border border-emerald-100 bg-emerald-50/70 p-3">
              <span className="block text-[10px] font-bold uppercase tracking-wide text-emerald-700">Contribuição ao Score</span>
              <strong className="mt-1 block text-lg font-black text-emerald-800">{displayPoints(result.weighted_score)}</strong>
              <span className="mt-1 block text-[10px] leading-4 text-emerald-700/75">Peso máximo do Pilar no Score Institucional: {displayPercent(result.weight_percent)}</span>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
            <div className="flex items-center gap-2 text-slate-700"><Calculator className="h-3.5 w-3.5 text-slate-500" /><b>Contribuição para o Score Institucional</b></div>
            <p className="mt-1 text-[11px] leading-5 text-slate-500">
              Nota {displayScore(result.score)} × peso do Pilar {displayPercent(result.weight_percent)} = <strong className="text-slate-700">{displayPoints(result.weighted_score)}</strong>
            </p>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
            <span className="block text-[10px] font-bold uppercase tracking-wide text-amber-700">Faixa de Cobertura</span>
            <strong className="mt-1 block text-sm text-amber-950">{matchedRangeBusinessLabel}</strong>
            <span className="mt-0.5 block text-[11px] text-amber-800/75">
              Regra técnica: {matchedRange ? `${matchedRange.operator} ${displayRatioPercent(matchedRange.threshold_value)}` : "não disponível"}
            </span>
          </div>

          <details className="rounded-lg border border-slate-200 bg-white">
            <summary className="cursor-pointer list-none px-3 py-2.5 font-bold text-slate-700">Como o resultado foi calculado</summary>
            <div className="grid gap-2 border-t border-slate-100 px-3 py-3">
              {[
                ["Limite solicitado", displayCurrency(traceRequestedLimit)],
                ["Valor coberto COFACE", displayCurrency(traceCofaceCoverage)],
                ["Cobertura", displayRatioPercent(indicator?.raw_ratio)],
                ["Faixa encontrada", matchedRange ? `${matchedRange.operator} ${displayRatioPercent(matchedRange.threshold_value)}` : "Nenhuma"],
                ["Nota atribuída", `${displayScore(result.score)} / 10`]
              ].map(([label, value]) => (
                <div key={label} className="flex items-start justify-between gap-3">
                  <span className="text-slate-500">{label}</span>
                  <b className="text-right text-slate-800">{value}</b>
                </div>
              ))}
            </div>
          </details>

          <details className="rounded-lg border border-slate-200 bg-slate-50">
            <summary className="cursor-pointer list-none px-3 py-2.5 font-bold text-slate-600">Ver detalhes técnicos</summary>
            <pre className="max-h-64 overflow-auto border-t border-slate-200 p-3 text-[10px] leading-5 text-slate-600">{JSON.stringify(result, null, 2)}</pre>
          </details>
        </div>
      ) : null}
    </form>
  );
}

function PillarTwoRightRail({
  policyId,
  result,
  onResult
}: {
  policyId: number | null;
  result: PillarTwoSimulationResultDto | null;
  onResult: (result: PillarTwoSimulationResultDto | null) => void;
}) {
  return (
    <aside className="grid content-start gap-3 pr-1 xl:sticky xl:top-4">
      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-4"><h2 className="text-sm font-semibold text-slate-900">Simulação isolada</h2><p className="mt-1 text-xs leading-5 text-slate-500">Não persiste resultado e não afeta o motor oficial.</p></div>
        <div className="p-4"><PillarTwoSimulation policyId={policyId} result={result} onResult={onResult} /></div>
      </section>
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-700" /><h2 className="text-sm font-semibold text-slate-900">Regra vigente v1</h2></div>
        <p className="mt-2 text-xs leading-5 text-slate-600">Nesta versão, o cálculo considera apenas COFACE. Cliente sem cobertura COFACE recebe nota 0 neste pilar.</p>
      </section>
      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-4"><h2 className="text-sm font-semibold text-slate-900">Garantias Reais e Jurídico</h2><p className="mt-1 text-xs leading-5 text-slate-500">Preparado para futura integração com módulo de gestão de garantias do Jurídico.</p></div>
        <div className="grid gap-2 p-4">
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3"><div className="flex items-center gap-2"><Building2 className="h-4 w-4 text-slate-500" /><b className="text-xs text-slate-800">Garantias Reais e Fiduciárias</b></div><span className="mt-1 block text-xs leading-5 text-slate-500">Mitigadores e bens vinculados, planejados com peso 0%.</span></div>
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3"><div className="flex items-center gap-2"><Scale className="h-4 w-4 text-slate-500" /><b className="text-xs text-slate-800">Qualidade Jurídica da Garantia</b></div><span className="mt-1 block text-xs leading-5 text-slate-500">Formalização, registro e executabilidade, planejados com peso 0%.</span></div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">Estes blocos são informativos e não interferem no cálculo COFACE v1.</div>
        </div>
      </section>
    </aside>
  );
}

const PAYMENT_HISTORY_RANGE_LABELS: Record<string, string> = {
  "=:0": "Sem vencidos",
  "<=:0.05": "Baixo nível de vencidos",
  "<=:0.1": "Atenção moderada",
  "<=:0.2": "Atenção elevada",
  ">:0.2": "Histórico crítico de vencidos"
};

function PillarFourContent({ pillar, status }: { pillar: ScorePillarDto; status: ScorePillarRoadmapDto["status"] }) {
  const currentSubgroup = pillar.subgroups.find((item) => item.code === "current_payment_position") ?? null;
  const historicalSubgroup = pillar.subgroups.find((item) => item.code === "historical_payment_behavior") ?? null;
  const ranges = currentSubgroup?.indicators[0]?.score_ranges ?? [];
  const subgroupCards = [
    {
      subgroup: currentSubgroup,
      description: "Fotografia mais recente da carteira do cliente.",
      indicatorDescription: "Mede quanto da exposição atual do cliente está vencida.",
      formula: "overdue_amount / total_exposure_amount"
    },
    {
      subgroup: historicalSubgroup,
      description: "Comportamento médio nos fechamentos mensais históricos disponíveis.",
      indicatorDescription: "Média dos percentuais vencidos nos fechamentos mensais históricos do AR Aging.",
      formula: "average(overdue_amount / total_exposure_amount)"
    }
  ];

  return (
    <section className="grid min-w-0 gap-4">
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-4">
          <div>
            <span className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">Resumo do Pilar 4</span>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">{pillar.name}</h2>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
              Este pilar avalia o comportamento de pagamento do cliente utilizando a posição atual da carteira e o histórico de fechamentos mensais do AR Aging.
            </p>
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs font-bold ${status === "configured" ? statusClass("valid") : statusClass("warning")}`}>
            {status === "configured" ? "Configurado" : "Em construção"}
          </span>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Peso institucional", displayPercent(pillar.weight_percent), "Contribuição máxima prevista de 0,50 ponto"],
            ["Fonte de dados", "AR Aging interno", "Posição atual e fechamentos mensais históricos"],
            ["Subgrupos ativos", String(pillar.subgroups_count), "Posição atual e histórico de fechamentos"],
            ["Objetivo", "Evidência interna", "Diferencia histórico disponível de cliente novo"]
          ].map(([label, value, detail]) => (
            <div key={label} className="min-h-28 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</span>
              <strong className="mt-2 block text-xl leading-tight text-slate-950">{value}</strong>
              <small className="mt-1 block text-xs leading-5 text-slate-500">{detail}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        {subgroupCards.map(({ subgroup, description, indicatorDescription, formula }) => {
          const indicator = subgroup?.indicators[0] ?? null;
          return (
            <article key={subgroup?.code ?? description} className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-950">{subgroup?.name ?? "-"}</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
                </div>
                <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-black text-blue-700">{displayPercent(subgroup?.weight_percent)}</span>
              </div>
              <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
                <strong className="block text-xs text-slate-900">{indicator?.name ?? "-"}</strong>
                <p className="mt-2 text-xs leading-5 text-slate-500">{indicator?.description ?? indicatorDescription}</p>
                <div className="mt-3 overflow-auto rounded-lg bg-slate-950 px-3 py-2.5 font-mono text-[10px] text-blue-100">{formula}</div>
              </div>
            </article>
          );
        })}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Faixas de Pontuação</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">As mesmas faixas parametrizadas são aplicadas à posição atual e à média histórica.</p>
          </div>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-600">Parametrizado no backend</span>
        </div>
        <div className="overflow-auto p-4">
          <table className="w-full min-w-[560px] overflow-hidden rounded-xl border border-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr><th className="px-4 py-3">Condição de overdue</th><th className="px-4 py-3">Leitura de negócio</th><th className="px-4 py-3">Nota</th></tr>
            </thead>
            <tbody>
              {ranges.map((range) => {
                const key = `${range.operator}:${toNumber(range.threshold_value)}`;
                return (
                  <tr key={range.id} className="border-t border-slate-100 bg-white">
                    <td className="px-4 py-3 font-semibold text-slate-800">{displayRatioRange(range)}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{PAYMENT_HISTORY_RANGE_LABELS[key] ?? range.label ?? "-"}</td>
                    <td className="px-4 py-3"><span className="inline-flex min-w-10 justify-center rounded-lg bg-indigo-50 px-3 py-2 font-black text-indigo-700">{displayScore(range.score)}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

function PillarFourSimulation({
  policyId,
  result,
  onResult
}: {
  policyId: number | null;
  result: PillarFourSimulationResultDto | null;
  onResult: (result: PillarFourSimulationResultDto | null) => void;
}) {
  const [cnpj, setCnpj] = useState("");
  const [analysisId, setAnalysisId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentSubgroup = result?.subgroups.find((item) => item.code === "current_payment_position") ?? null;
  const historicalSubgroup = result?.subgroups.find((item) => item.code === "historical_payment_behavior") ?? null;
  const currentIndicator = currentSubgroup?.indicators[0] ?? null;
  const historicalIndicator = historicalSubgroup?.indicators[0] ?? null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!policyId) return;
    setIsSubmitting(true);
    setError(null);
    try {
      onResult(await simulatePillarFourScore(policyId, {
        cnpj: cnpj.replace(/\D/g, "") || null,
        analysis_id: analysisId ? Number(analysisId) : null
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível simular o Pilar 4.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function clearSimulation() {
    setCnpj("");
    setAnalysisId("");
    setError(null);
    onResult(null);
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-3">
      <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3">
        <div className="grid gap-3">
          <label className="grid gap-1.5 text-xs font-bold text-slate-700">
            CNPJ
            <input inputMode="numeric" value={cnpj} onChange={(event) => setCnpj(formatCnpjInput(event.target.value))} className="h-10 rounded-lg border border-blue-200 bg-white px-3 text-sm font-semibold outline-none focus:border-indigo-500" placeholder="12.345.678/0001-90" />
            <span className="text-[10px] font-normal leading-4 text-slate-500">Usado para localizar a posição atual e os fechamentos mensais históricos.</span>
          </label>
          <label className="grid gap-1.5 text-xs font-bold text-slate-700">
            Analysis ID <span className="font-normal text-slate-400">(opcional)</span>
            <input inputMode="numeric" value={analysisId} onChange={(event) => setAnalysisId(event.target.value.replace(/\D/g, ""))} className="h-10 rounded-lg border border-blue-200 bg-white px-3 text-sm font-semibold outline-none focus:border-indigo-500" placeholder="Ex.: 1234" />
            <span className="text-[10px] font-normal leading-4 text-slate-500">Se informado, o sistema tentará localizar automaticamente a análise relacionada.</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button type="submit" disabled={isSubmitting || !policyId || (!cnpj && !analysisId)} className="h-10 whitespace-nowrap rounded-lg bg-indigo-600 px-3 text-xs font-black text-white shadow-sm transition hover:bg-indigo-700 disabled:bg-indigo-300">
              {isSubmitting ? "Simulando..." : "Simular"}
            </button>
            <button type="button" onClick={clearSimulation} disabled={isSubmitting || (!cnpj && !analysisId && !result && !error)} className="h-10 whitespace-nowrap rounded-lg border border-blue-200 bg-white px-3 text-xs font-black text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:text-slate-300">
              Limpar simulação
            </button>
          </div>
        </div>
      </div>

      {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</div> : null}
      {result?.status === "not_available" ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex gap-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <div>
              <h3 className="text-sm font-semibold text-amber-950">Histórico de fechamentos indisponível</h3>
              <p className="mt-1 text-xs leading-5 text-amber-900">Não foram encontrados fechamentos mensais suficientes para avaliar o comportamento histórico deste cliente.</p>
              <p className="mt-2 text-xs leading-5 text-amber-800">O score foi calculado apenas com os dados disponíveis.</p>
            </div>
          </div>
        </div>
      ) : null}

      {result ? (
        <div className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="relative overflow-hidden rounded-xl bg-[#111936] p-4 text-white shadow-[0_10px_24px_rgba(15,23,42,0.16)] sm:col-span-2">
              <div className="absolute -right-5 -top-7 h-24 w-24 rounded-full border-[18px] border-white/[0.06]" />
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-blue-200/75">Nota do Pilar</span>
              <strong className="mt-1 block text-4xl font-black tracking-tight">{displayScore(result.score)} <small className="text-sm text-white/60">/ 10</small></strong>
              <span className="mt-1 block text-[11px] text-white/55">
                {result.weight_rebalanced ? "Calculado com base apenas na posição atual disponível." : "Combina posição atual e histórico de fechamentos."}
              </span>
            </div>
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-3">
              <span className="block text-[10px] font-bold uppercase tracking-wide text-emerald-700">Contribuição institucional</span>
              <strong className="mt-1 block text-xl font-black text-emerald-800">{displayPoints(result.weighted_score)}</strong>
              <span className="mt-1 block text-[10px] text-emerald-700/75">Peso institucional: {displayPercent(result.weight_percent)}</span>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-500">Status</span>
              <strong className={`mt-1 block text-lg ${result.status === "calculated" ? "text-emerald-700" : "text-amber-700"}`}>{result.status === "calculated" ? "Calculado" : "Histórico de fechamentos indisponível"}</strong>
              <span className="mt-1 block text-[10px] text-slate-500">Fonte: AR Aging interno</span>
            </div>
          </div>

          {result.weight_rebalanced ? (
            <div className="flex gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-900">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
              <p><b>A avaliação histórica não pôde ser realizada.</b> O resultado foi calculado utilizando apenas a posição atual disponível.</p>
            </div>
          ) : null}

          <section className="rounded-xl border border-slate-200 bg-white p-3">
            <h3 className="text-xs font-bold text-slate-900">Resultado por subgrupo</h3>
            <div className="mt-3 grid gap-2">
              {[currentSubgroup, historicalSubgroup].filter(Boolean).map((subgroup) => {
                const indicator = subgroup?.indicators[0] ?? null;
                return (
                  <div key={subgroup?.code} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <b className="text-xs text-slate-800">{subgroup?.name}</b>
                        {subgroup?.status === "not_available" ? (
                          <>
                            <span className="mt-1 block text-[10px] font-bold text-amber-700">Histórico indisponível</span>
                            <span className="mt-0.5 block text-[10px] leading-4 text-slate-500">Não foram encontrados fechamentos históricos suficientes para avaliação.</span>
                          </>
                        ) : null}
                      </div>
                      <b className={`text-sm ${subgroup?.status === "not_available" ? "text-amber-700" : "text-indigo-700"}`}>
                        {subgroup?.status === "not_available" ? "Não disponível" : `${displayScore(subgroup?.score)} / 10`}
                      </b>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-slate-500">
                      <span>
                        {subgroup?.code === "current_payment_position" ? "Overdue atual" : "Média histórica de overdue"}:{" "}
                        <b className="text-slate-700">{subgroup?.status === "not_available" ? "Não disponível" : displayRatioPercent(indicator?.raw_value)}</b>
                      </span>
                      <span>Peso: <b className="text-slate-700">{displayPercent(subgroup?.weight_percent)}</b></span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <details className="rounded-xl border border-slate-200 bg-white">
            <summary className="cursor-pointer list-none px-3 py-3 text-xs font-bold text-slate-700">Como o resultado foi calculado</summary>
            <div className="grid gap-2 border-t border-slate-100 p-3">
              {[
                ["Percentual vencido atual", displayRatioPercent(currentIndicator?.raw_value)],
                ["Nota da posição atual", `${displayScore(currentIndicator?.score)} / 10`],
                ["Média histórica vencida", historicalSubgroup?.status === "not_available" ? "Não disponível" : displayRatioPercent(historicalIndicator?.raw_value)],
                [
                  "Comportamento histórico",
                  historicalSubgroup?.status === "not_available" ? "Não considerado no cálculo" : `${displayScore(historicalIndicator?.score)} / 10`
                ],
                ["Resultado final", `${displayScore(result.score)} / 10`]
              ].map(([label, value]) => (
                <div key={label} className="flex items-start justify-between gap-3 text-xs">
                  <span className="text-slate-500">{label}</span><b className="text-right text-slate-800">{value}</b>
                </div>
              ))}
            </div>
          </details>

          <details className="rounded-xl border border-slate-200 bg-slate-50">
            <summary className="cursor-pointer list-none px-3 py-3 text-xs font-bold text-slate-600">Ver detalhes técnicos</summary>
            <pre className="max-h-64 overflow-auto border-t border-slate-200 p-3 text-[10px] leading-5 text-slate-600">{JSON.stringify(result, null, 2)}</pre>
          </details>
        </div>
      ) : null}
    </form>
  );
}

function PillarFourRightRail({
  policyId,
  result,
  onResult
}: {
  policyId: number | null;
  result: PillarFourSimulationResultDto | null;
  onResult: (result: PillarFourSimulationResultDto | null) => void;
}) {
  return (
    <aside className="grid content-start gap-3 pr-1 xl:sticky xl:top-4">
      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Simulação Isolada</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">Consulta o AR Aging interno sem persistir resultado ou afetar o motor oficial.</p>
        </div>
        <div className="p-4"><PillarFourSimulation policyId={policyId} result={result} onResult={onResult} /></div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Histórico de fechamentos utilizado</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">Fechamentos mensais históricos considerados pelo backend.</p>
        </div>
        <div className="p-4">
          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
            <span className="text-slate-500">Fechamentos utilizados</span><b className="text-slate-900">{result?.snapshots_used_count ?? "-"}</b>
          </div>
          <div className="mt-3 grid gap-2">
            {result?.snapshot_dates_used.map((date) => (
              <div key={date} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                <FileClock className="h-3.5 w-3.5 text-indigo-600" /><b>{displaySnapshotDate(date)}</b>
              </div>
            ))}
            {result && result.snapshot_dates_used.length === 0 ? <p className="text-xs leading-5 text-slate-500">Nenhum fechamento mensal histórico foi localizado para o cliente consultado.</p> : null}
            {!result ? <p className="text-xs leading-5 text-slate-500">As datas utilizadas serão exibidas após a simulação.</p> : null}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 shadow-sm">
        <div className="flex gap-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
          <div><h2 className="text-sm font-semibold text-amber-950">Histórico de fechamentos indisponível</h2><p className="mt-1 text-xs leading-5 text-amber-900">Não foram encontrados fechamentos mensais suficientes para avaliar o comportamento histórico deste cliente.</p><p className="mt-1 text-xs leading-5 text-amber-800">O score foi calculado apenas com os dados disponíveis.</p></div>
        </div>
      </section>
    </aside>
  );
}

const PILLAR_THREE_SUBGROUPS = [
  {
    name: "Risco Setorial",
    description: "Classificação de risco por setor econômico, CNAE ou segmento de atuação do cliente.",
    icon: Factory
  },
  {
    name: "Perspectiva Macroeconômica",
    description: "Leitura futura de juros, inflação, câmbio e cenário econômico relevante.",
    icon: Globe2
  },
  {
    name: "Exposição a Ciclo / Commodities",
    description: "Avaliação de exposição a safras, commodities, preços internacionais e ciclos econômicos.",
    icon: TrendingUp
  }
];

const PILLAR_THREE_FUTURE_SOURCES = [
  ["Análise de risco por setor/carteira", "Leitura de concentração, inadimplência e exposição por segmento."],
  ["CNAE / segmento econômico", "Vínculo estruturado entre cliente e classificação setorial."],
  ["Relatórios macroeconômicos importados", "Visões periódicas com fonte, vigência e conclusão de risco."],
  ["Base interna de inteligência de mercado", "Curadoria administrativa para consulta futura da política."],
  ["Indicadores de commodities", "Referências aplicáveis a clientes expostos a preços e ciclos específicos."]
];

const PILLAR_THREE_ROADMAP = [
  "Criar base de inteligência de mercado",
  "Definir classificação setorial",
  "Importar relatórios macroeconômicos",
  "Vincular cliente, setor e CNAE",
  "Ativar cálculo parametrizado do Pilar 3"
];

function PillarThreeContent({ roadmapItem }: { roadmapItem: ScorePillarRoadmapDto }) {
  return (
    <section className="grid min-w-0 gap-4">
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-4">
          <span className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">Resumo do Pilar</span>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">Condições de Mercado</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">Estrutura planejada para futura leitura de risco setorial e macroeconômico, sem cálculo operacional ativo nesta versão.</p>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Peso previsto", displayPercent(roadmapItem.weight_percent), "Previsto na política completa"],
            ["Status operacional", "Planejado", "Em construção"],
            ["Fonte atual", "Não disponível", "Sem fonte operacional confiável"],
            ["Impacto atual", "Nenhum", "Não participa do motor oficial"]
          ].map(([label, value, detail]) => (
            <div key={label} className="min-h-28 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</span>
              <strong className={`mt-2 block leading-tight ${label === "Status operacional" ? "text-xl text-amber-700" : "text-2xl text-slate-950"}`}>{value}</strong>
              <small className="mt-1 block text-xs leading-5 text-slate-500">{detail}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-4">
          <span className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">Estrutura planejada</span>
          <h2 className="mt-1 text-sm font-semibold text-slate-900">Subgrupos futuros do Pilar 3</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">Preparação para inteligência de mercado quando fontes confiáveis forem definidas.</p>
        </div>
        <div className="grid gap-3 p-4 lg:grid-cols-3">
          {PILLAR_THREE_SUBGROUPS.map((subgroup, index) => {
            const Icon = subgroup.icon;
            return (
              <article key={subgroup.name} className={`rounded-xl border p-4 ${index === 0 ? "border-amber-200 bg-amber-50/70" : "border-dashed border-slate-300 bg-slate-50/70"}`}>
                <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${index === 0 ? "bg-amber-100 text-amber-700" : "bg-indigo-50 text-indigo-600"}`}><Icon className="h-4 w-4" /></span>
                <h3 className="mt-3 text-sm font-semibold text-slate-900">{subgroup.name}</h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">{subgroup.description}</p>
                <span className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ${index === 0 ? "bg-amber-100 text-amber-800" : "bg-white text-slate-500"}`}>Planejado · sem peso operacional</span>
              </article>
            );
          })}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-4">
          <span className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">Fontes futuras possíveis</span>
          <h2 className="mt-1 text-sm font-semibold text-slate-900">Inteligência de mercado para evolução da política</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">Nenhuma destas fontes participa do cálculo atual.</p>
        </div>
        <div className="grid gap-2 p-4">
          {PILLAR_THREE_FUTURE_SOURCES.map(([name, description]) => (
            <div key={name} className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <div><strong className="block text-xs text-slate-800">{name}</strong><span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span></div>
              <span className="w-fit rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-700">Planejado</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
          <div><h2 className="text-sm font-semibold text-amber-950">Decisão de governança</h2><p className="mt-1 text-xs leading-5 text-amber-900/80">Este pilar ainda não participa do cálculo oficial. A estrutura está preparada para futura integração com inteligência de mercado, sem criar nota artificial nesta versão.</p></div>
        </div>
      </section>
    </section>
  );
}

function PillarThreeRightRail() {
  return (
    <aside className="grid content-start gap-3 pr-1 xl:sticky xl:top-4">
      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-4"><h2 className="text-sm font-semibold text-slate-900">Não configurado para cálculo</h2><p className="mt-1 text-xs leading-5 text-slate-500">Estado informativo esperado nesta versão.</p></div>
        <div className="p-4"><div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><CircleDashed className="h-5 w-5 text-amber-700" /><h3 className="mt-2 text-sm font-semibold text-amber-950">Pilar em construção</h3><p className="mt-1 text-xs leading-5 text-amber-900/80">Não há simulação disponível porque nenhuma fonte operacional foi homologada. O impacto atual no motor é nenhum.</p></div></div>
      </section>
      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-4"><h2 className="text-sm font-semibold text-slate-900">Roadmap futuro</h2><p className="mt-1 text-xs leading-5 text-slate-500">Etapas necessárias antes da ativação.</p></div>
        <div className="grid gap-3 p-4">
          {PILLAR_THREE_ROADMAP.map((step, index) => (
            <div key={step} className="flex items-start gap-3"><span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[10px] font-black text-indigo-700">{index + 1}</span><span className="text-xs leading-5 text-slate-600">{step}</span></div>
          ))}
        </div>
      </section>
      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-4"><h2 className="text-sm font-semibold text-slate-900">Próxima evolução</h2><p className="mt-1 text-xs leading-5 text-slate-500">Base futura fora do workflow.</p></div>
        <div className="p-4"><div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4"><Database className="h-5 w-5 text-slate-500" /><strong className="mt-2 block text-xs text-slate-800">Administração · Inteligência de Mercado</strong><span className="mt-1 block text-xs leading-5 text-slate-500">Espaço futuro para importar relatórios, classificar setores e parametrizar vigência das leituras de mercado.</span></div></div>
      </section>
    </aside>
  );
}

function GovernancePanel({ structure }: { structure: ScoreStructureDto | null }) {
  return (
    <div className="grid gap-3 text-xs leading-5 text-slate-600">
      <div className="flex gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <Lock className="mt-0.5 h-4 w-4 text-slate-600" />
        <p>Política ativa não deve ser editada diretamente; alterações futuras devem gerar nova versão.</p>
      </div>
      <div className="flex gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 text-slate-600" />
        <p>Política parametrizável ainda não conectada ao motor oficial.</p>
      </div>
      <div className="flex gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <FileClock className="mt-0.5 h-4 w-4 text-slate-600" />
        <p>Flag de ativacao controlada: {structure?.governance.configurable_score_policy_enabled ? "ligada" : "desligada"}.</p>
      </div>
    </div>
  );
}

function CofaceRulePanel() {
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-emerald-700" />
        <h2 className="text-sm font-semibold text-slate-900">Regra COFACE</h2>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-700">
        Quando houver cobertura COFACE válida, o backend aplica a regra da política para o Pilar 1 e preserva a justificativa no retorno.
      </p>
    </div>
  );
}

function RightRail({
  structure,
  policyId,
  subgroups,
  simulationResult,
  onSimulationResult
}: {
  structure: ScoreStructureDto | null;
  policyId: number | null;
  subgroups: ScoreSubgroupDto[];
  simulationResult: PillarOneSimulationResultDto | null;
  onSimulationResult: (result: PillarOneSimulationResultDto | null) => void;
}) {
  return (
    <aside className="grid gap-3 pr-1 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-auto">
      <Disclosure title="Simulação isolada" subtitle="Não persiste resultado e não afeta o motor oficial." defaultOpen icon={<Beaker className="h-4 w-4" />}>
        <SimulationPanel policyId={policyId} subgroups={subgroups} result={simulationResult} onResult={onSimulationResult} />
      </Disclosure>
      <Disclosure
        title="Validação da Política"
        subtitle="Status geral, erros, alertas e validações aprovadas."
        defaultOpen={(structure?.validation_summary.errors.length ?? 0) > 0}
        icon={<CheckCircle2 className="h-4 w-4" />}
      >
        <ValidationPanel structure={structure} />
      </Disclosure>
      <Disclosure title="Regra COFACE" subtitle="Prevalência de cobertura válida para o Pilar 1." icon={<ShieldCheck className="h-4 w-4" />}>
        <CofaceRulePanel />
      </Disclosure>
      <Disclosure title="Governanca" subtitle="Versionamento, bloqueios e flags." icon={<SlidersHorizontal className="h-4 w-4" />}>
        <GovernancePanel structure={structure} />
      </Disclosure>
    </aside>
  );
}

export function PolicyScorePage() {
  const [structure, setStructure] = useState<ScoreStructureDto | null>(null);
  const [selectedPillarId, setSelectedPillarId] = useState<number | null>(null);
  const [selectedPillarCode, setSelectedPillarCode] = useState<string | null>(null);
  const [selectedSubgroupId, setSelectedSubgroupId] = useState<number | null>(null);
  const [selectedIndicatorId, setSelectedIndicatorId] = useState<number | null>(null);
  const [simulationResult, setSimulationResult] = useState<PillarOneSimulationResultDto | null>(null);
  const [pillarTwoSimulationResult, setPillarTwoSimulationResult] = useState<PillarTwoSimulationResultDto | null>(null);
  const [pillarFourSimulationResult, setPillarFourSimulationResult] = useState<PillarFourSimulationResultDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canViewPolicy, setCanViewPolicy] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      const canView = hasPermission("credit.policy.view");
      if (!canView) {
        if (mounted) {
          setCanViewPolicy(false);
          setIsLoading(false);
        }
        return;
      }

      if (mounted) setCanViewPolicy(true);
      setIsLoading(true);
      setError(null);
      try {
        const response = await getCurrentScoreStructure();
        if (!mounted) return;
        setStructure(response);
        const pillar = firstEnabled(response.pillars);
        setSelectedPillarId(pillar?.id ?? null);
        setSelectedPillarCode(pillar?.code ?? response.pillar_roadmap[0]?.code ?? null);
        const subgroup = firstEnabled(pillar?.subgroups);
        setSelectedSubgroupId(subgroup?.id ?? null);
        setSelectedIndicatorId(firstEnabled(subgroup?.indicators)?.id ?? null);
      } catch (caught) {
        if (mounted) setError(caught instanceof Error ? caught.message : "Não foi possível carregar a Política.");
      } finally {
        if (mounted) setIsLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const selectedPillar = useMemo(
    () => structure?.pillars.find((pillar) => pillar.id === selectedPillarId) ?? null,
    [selectedPillarId, structure]
  );
  const selectedSubgroup = useMemo(
    () => selectedPillar?.subgroups.find((subgroup) => subgroup.id === selectedSubgroupId) ?? null,
    [selectedPillar, selectedSubgroupId]
  );
  const selectedIndicator = useMemo(
    () => selectedSubgroup?.indicators.find((indicator) => indicator.id === selectedIndicatorId) ?? null,
    [selectedIndicatorId, selectedSubgroup]
  );
  const selectedRoadmapItem = useMemo(
    () => structure?.pillar_roadmap.find((item) => item.code === selectedPillarCode) ?? null,
    [selectedPillarCode, structure]
  );
  const isPillarTwo = selectedPillar?.code === PILLAR_TWO_CODE;
  const isPillarThree = selectedPillarCode === PILLAR_THREE_CODE;
  const isPillarFour = selectedPillar?.code === PILLAR_FOUR_CODE;

  function selectPillar(item: ScorePillarRoadmapDto, pillar: ScorePillarDto | null) {
    setSelectedPillarCode(item.code);
    setSelectedPillarId(pillar?.id ?? null);
    const subgroup = firstEnabled(pillar?.subgroups);
    setSelectedSubgroupId(subgroup?.id ?? null);
    setSelectedIndicatorId(firstEnabled(subgroup?.indicators)?.id ?? null);
  }

  function selectSubgroup(subgroup: ScoreSubgroupDto) {
    setSelectedSubgroupId(subgroup.id);
    setSelectedIndicatorId(firstEnabled(subgroup.indicators)?.id ?? null);
  }

  if (canViewPolicy === null) {
    return <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">Carregando Política de Decisão...</div>;
  }

  if (!canViewPolicy) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
        Você não possui permissão para visualizar a Política de Crédito.
      </div>
    );
  }

  if (isLoading) {
    return <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">Carregando Política de Decisão...</div>;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
        <div className="flex items-center gap-2 font-semibold">
          <AlertCircle className="h-4 w-4" />
          Não foi possível carregar a tela.
        </div>
        <p className="mt-2">{error}</p>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#f5f7fb] px-4 pb-4 pt-2 text-slate-950 sm:px-6 sm:pb-6 sm:pt-3">
      <Hero structure={structure} selectedPillar={selectedPillar} />
      <Toolbar />
      <section className="grid gap-4 xl:grid-cols-[310px_minmax(0,1fr)_350px]">
        <PillarSidebar
          pillars={structure?.pillars ?? []}
          roadmap={structure?.pillar_roadmap ?? []}
          selectedPillarCode={selectedPillarCode}
          onSelect={selectPillar}
        />
        {isPillarThree && selectedRoadmapItem ? (
          <>
            <PillarThreeContent roadmapItem={selectedRoadmapItem} />
            <PillarThreeRightRail />
          </>
        ) : isPillarTwo && selectedPillar ? (
          <>
            <section className="grid min-w-0 gap-4">
              <PillarTwoSummary pillar={selectedPillar} status={selectedRoadmapItem?.status ?? "partial"} />
              <PillarTwoSubgroups activeSubgroup={selectedSubgroup} />
              <PillarTwoIndicator indicator={selectedIndicator} />
              <PillarTwoRanges indicator={selectedIndicator} />
            </section>
            <PillarTwoRightRail
              policyId={structure?.policy.id ?? null}
              result={pillarTwoSimulationResult}
              onResult={setPillarTwoSimulationResult}
            />
          </>
        ) : isPillarFour && selectedPillar ? (
          <>
            <PillarFourContent pillar={selectedPillar} status={selectedRoadmapItem?.status ?? "partial"} />
            <PillarFourRightRail
              policyId={structure?.policy.id ?? null}
              result={pillarFourSimulationResult}
              onResult={setPillarFourSimulationResult}
            />
          </>
        ) : (
          <>
            <section className="grid min-w-0 gap-4">
              <PolicyProgress progress={structure?.policy_progress ?? null} />
              <PillarSummary pillar={selectedPillar} validationStatus={structure?.validation_summary.configuration_status ?? "incomplete"} />
              <SubgroupList pillar={selectedPillar} selectedSubgroupId={selectedSubgroupId} onSelect={selectSubgroup} />
              <IndicatorList subgroup={selectedSubgroup} selectedIndicatorId={selectedIndicatorId} onSelect={(indicator) => setSelectedIndicatorId(indicator.id)} />
              <ScoreRangeTable indicator={selectedIndicator} />
            </section>
            <RightRail
              structure={structure}
              policyId={structure?.policy.id ?? null}
              subgroups={selectedPillar?.subgroups ?? []}
              simulationResult={simulationResult}
              onSimulationResult={setSimulationResult}
            />
          </>
        )}
      </section>
    </main>
  );
}
