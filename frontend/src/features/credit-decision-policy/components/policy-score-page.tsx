"use client";

import {
  AlertCircle,
  Beaker,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  CircleDot,
  FileClock,
  Layers3,
  Lock,
  ShieldCheck,
  SlidersHorizontal
} from "lucide-react";
import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";

import {
  getCurrentScoreStructure,
  PillarOneSimulationResultDto,
  ScoreIndicatorDto,
  ScorePillarDto,
  ScorePillarRoadmapDto,
  ScorePolicyProgressDto,
  ScoreRangeDto,
  ScoreStructureDto,
  ScoreSubgroupDto,
  ScoreValidationCheckDto,
  ScoreValidationIssueDto,
  simulatePillarOneScore
} from "@/features/credit-decision-policy/api/score-policy.api";
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

function flattenIndicators(pillar: ScorePillarDto | null) {
  return pillar?.subgroups.flatMap((subgroup) => subgroup.indicators) ?? [];
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
  selectedPillarId,
  onSelect
}: {
  pillars: ScorePillarDto[];
  roadmap: ScorePillarRoadmapDto[];
  selectedPillarId: number | null;
  onSelect: (pillar: ScorePillarDto) => void;
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
            const pillar = pillars.find((candidate) => candidate.id === item.id);
            const active = item.id === selectedPillarId;
            const selectable = Boolean(pillar);
            const StatusIcon = item.status === "configured" ? CheckCircle2 : item.status === "partial" ? CircleDot : CircleDashed;
            return (
              <button
                key={item.code}
                type="button"
                disabled={!selectable}
                onClick={() => pillar && onSelect(pillar)}
                className={`rounded-lg border p-3 text-left transition ${
                  active
                    ? "border-blue-200 bg-blue-50 text-blue-800"
                    : selectable
                      ? "border-transparent text-slate-700 hover:border-slate-200 hover:bg-slate-50"
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
                      <strong className="mt-1 block text-sm leading-5">{item.name}</strong>
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
  indicators,
  result,
  onResult
}: {
  policyId: number | null;
  indicators: ScoreIndicatorDto[];
  result: PillarOneSimulationResultDto | null;
  onResult: (result: PillarOneSimulationResultDto | null) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [analysisId, setAnalysisId] = useState("");
  const [cofaceValid, setCofaceValid] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValues({});
    onResult(null);
  }, [policyId, onResult]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!policyId) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const cleanAnalysisId = analysisId.trim() ? Number(analysisId.trim()) : null;
      const indicatorValues = Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim() !== ""));
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

  return (
    <form onSubmit={handleSubmit} className="grid gap-3">
      <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
        <input type="checkbox" checked={cofaceValid} onChange={(event) => setCofaceValid(event.target.checked)} />
        COFACE válida para a simulação
      </label>
      <label className="grid gap-1 text-xs font-semibold text-slate-700">
        ID da análise (opcional)
        <input
          value={analysisId}
          onChange={(event) => setAnalysisId(event.target.value)}
          className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 outline-none focus:border-blue-500"
          placeholder="Ex.: 123"
        />
      </label>
      <div className="max-h-72 overflow-auto rounded-lg border border-blue-100 bg-white p-3">
        <div className="grid gap-2">
          {indicators.map((indicator) => (
            <label key={indicator.id} className="grid gap-1 text-xs font-semibold text-slate-700">
              {indicator.name}
              <input
                value={values[indicator.code] ?? ""}
                onChange={(event) => setValues((current) => ({ ...current, [indicator.code]: event.target.value }))}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-800 outline-none focus:border-blue-500"
                placeholder="Informe o valor"
                disabled={cofaceValid || Boolean(analysisId.trim())}
              />
            </label>
          ))}
        </div>
      </div>
      <button
        type="submit"
        disabled={isSubmitting || !policyId}
        className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-blue-300"
      >
        {isSubmitting ? "Simulando..." : "Simular no backend"}
      </button>
      {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</div> : null}
      {result ? (
        <div className="rounded-lg border border-blue-100 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-slate-500">Nota retornada</span>
            <strong className="text-2xl text-blue-700">{displayScore(result.score)}</strong>
          </div>
          <div className="mt-3 grid gap-2 text-xs text-slate-600">
            <p>Status: <strong>{statusLabel(result.status)}</strong></p>
            <p>Fonte: <strong>{result.source}</strong></p>
            {result.reason ? <p>{result.reason}</p> : null}
          </div>
        </div>
      ) : null}
    </form>
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
  indicators,
  simulationResult,
  onSimulationResult
}: {
  structure: ScoreStructureDto | null;
  policyId: number | null;
  indicators: ScoreIndicatorDto[];
  simulationResult: PillarOneSimulationResultDto | null;
  onSimulationResult: (result: PillarOneSimulationResultDto | null) => void;
}) {
  return (
    <aside className="grid gap-3 pr-1 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-auto">
      <Disclosure title="Simulação isolada" subtitle="Não persiste resultado e não afeta o motor oficial." defaultOpen icon={<Beaker className="h-4 w-4" />}>
        <SimulationPanel policyId={policyId} indicators={indicators} result={simulationResult} onResult={onSimulationResult} />
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
  const [selectedSubgroupId, setSelectedSubgroupId] = useState<number | null>(null);
  const [selectedIndicatorId, setSelectedIndicatorId] = useState<number | null>(null);
  const [simulationResult, setSimulationResult] = useState<PillarOneSimulationResultDto | null>(null);
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
  const pillarIndicators = useMemo(() => flattenIndicators(selectedPillar), [selectedPillar]);

  function selectPillar(pillar: ScorePillarDto) {
    setSelectedPillarId(pillar.id);
    const subgroup = firstEnabled(pillar.subgroups);
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
          selectedPillarId={selectedPillarId}
          onSelect={selectPillar}
        />
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
          indicators={pillarIndicators}
          simulationResult={simulationResult}
          onSimulationResult={setSimulationResult}
        />
      </section>
    </main>
  );
}
