"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { CreditAnalysisListApiResponse } from "@/features/credit-analyses/api/contracts";
import { buildMilestones, buildRuleSignals, decisionPill, getInitials, resolveDecision, toneStyles } from "@/features/credit-analyses/utils/analysis-view-models";
import { formatCurrency, formatDateTime, toNumber } from "@/features/credit-analyses/utils/formatters";

type AnalysisListCardsProps = {
  analyses: CreditAnalysisListApiResponse;
};

function toDecisionText(value: ReturnType<typeof decisionPill>["label"]) {
  if (value === "Aprovado com condição") {
    return "Aprovado cond.";
  }

  return value;
}

function decisionTextClass(tone: ReturnType<typeof decisionPill>["tone"]) {
  if (tone === "success") {
    return "text-[#065f46]";
  }
  if (tone === "warning") {
    return "text-[#92400e]";
  }
  if (tone === "danger") {
    return "text-[#991b1b]";
  }
  if (tone === "info") {
    return "text-[#1e40af]";
  }
  return "text-[#6b7280]";
}

export function AnalysisListCards({ analyses }: AnalysisListCardsProps) {
  const [selectedId, setSelectedId] = useState<number>(analyses[0]?.id ?? 0);

  const selectedAnalysis = useMemo(() => {
    return analyses.find((analysis) => analysis.id === selectedId) ?? analyses[0];
  }, [analyses, selectedId]);

  const stats = useMemo(() => {
    const total = analyses.length;
    const approved = analyses.filter((item) => resolveDecision(item.final_decision, item.motor_result) === "approved").length;
    const rejected = analyses.filter((item) => resolveDecision(item.final_decision, item.motor_result) === "rejected").length;
    const manual = analyses.filter((item) => resolveDecision(item.final_decision, item.motor_result) === "manual_review").length;
    const scoreAvgBase = analyses
      .map((item) => toNumber(item.score?.final_score))
      .filter((value): value is number => value !== null);

    const avgScore = scoreAvgBase.length
      ? Math.round(scoreAvgBase.reduce((acc, value) => acc + value, 0) / scoreAvgBase.length)
      : null;

    return {
      total,
      approved,
      rejected,
      manual,
      avgScore
    };
  }, [analyses]);

  if (!selectedAnalysis) {
    return null;
  }

  const selectedDecision = decisionPill(resolveDecision(selectedAnalysis.final_decision, selectedAnalysis.motor_result));
  const selectedStyles = toneStyles(selectedDecision.tone);
  const selectedRules = buildRuleSignals({
    analysis: selectedAnalysis,
    score: selectedAnalysis.score,
    memory: selectedAnalysis.decision_memory_json
  });
  const selectedMilestones = buildMilestones({
    analysis: selectedAnalysis,
    events: []
  });

  return (
    <section className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <article className="rounded-[8px] border border-[#e2e5eb] bg-white px-3.5 py-3">
          <p className="text-[10px] text-[#9ca3af]">Análises carregadas</p>
          <p className="mt-1 text-[18px] font-medium text-[#111827]">{stats.total}</p>
          <p className="text-[10px] text-[#6b7280]">Dados reais do backend</p>
        </article>
        <article className="rounded-[8px] border border-[#e2e5eb] bg-white px-3.5 py-3">
          <p className="text-[10px] text-[#9ca3af]">Aprovadas</p>
          <p className="mt-1 text-[18px] font-medium text-[#059669]">{stats.approved}</p>
          <p className="text-[10px] text-[#6b7280]">Decisão final/motor</p>
        </article>
        <article className="rounded-[8px] border border-[#e2e5eb] bg-white px-3.5 py-3">
          <p className="text-[10px] text-[#9ca3af]">Reprovadas</p>
          <p className="mt-1 text-[18px] font-medium text-[#dc2626]">{stats.rejected}</p>
          <p className="text-[10px] text-[#6b7280]">Fluxos com bloqueio</p>
        </article>
        <article className="rounded-[8px] border border-[#e2e5eb] bg-white px-3.5 py-3">
          <p className="text-[10px] text-[#9ca3af]">Exceções / revisão</p>
          <p className="mt-1 text-[18px] font-medium text-[#d97706]">{stats.manual}</p>
          <p className="text-[10px] text-[#6b7280]">Revisão manual</p>
        </article>
        <article className="rounded-[8px] border border-[#e2e5eb] bg-white px-3.5 py-3">
          <p className="text-[10px] text-[#9ca3af]">Score médio</p>
          <p className="mt-1 text-[18px] font-medium text-[#111827]">{stats.avgScore ?? "--"}</p>
          <p className="text-[10px] text-[#6b7280]">Último lote</p>
        </article>
      </div>

      <div className="flex items-center gap-2 rounded-[8px] border border-[#e2e5eb] bg-white px-3 py-2.5">
        <Search className="h-3.5 w-3.5 text-[#9ca3af]" />
        <input
          className="h-6 flex-1 border-none bg-transparent text-[12px] text-[#374151] outline-none placeholder:text-[#9ca3af]"
          placeholder="Buscar por cliente, CNPJ, analista ou protocolo..."
          readOnly
          value=""
        />
        <div className="hidden h-4 w-px bg-[#e2e5eb] sm:block" />
        <p className="hidden text-[11px] text-[#6b7280] sm:block">Todas as decisões</p>
        <div className="hidden h-4 w-px bg-[#e2e5eb] sm:block" />
        <p className="hidden text-[11px] text-[#6b7280] sm:block">Período atual</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="overflow-hidden rounded-[10px] border border-[#e2e5eb] bg-white">
          <div className="hidden grid-cols-[140px_1fr_80px_120px_110px_90px] bg-[#f9fafb] px-4 py-2 text-[10px] font-medium uppercase tracking-[0.04em] text-[#6b7280] md:grid">
            <span>Data / Protocolo</span>
            <span>Cliente</span>
            <span className="text-center">Score</span>
            <span>Decisão</span>
            <span>Analista</span>
            <span className="text-right">Limite</span>
          </div>

          <div>
            {analyses.map((analysis) => {
              const decision = decisionPill(resolveDecision(analysis.final_decision, analysis.motor_result));
              const styles = toneStyles(decision.tone);
              const isSelected = analysis.id === selectedAnalysis.id;

              return (
                <button
                  key={analysis.id}
                  className={`grid w-full gap-y-2 border-b border-[#f3f4f6] px-4 py-3 text-left transition hover:bg-[#f9fafb] md:grid-cols-[140px_1fr_80px_120px_110px_90px] md:items-center md:gap-y-0 ${
                    isSelected ? "bg-[#f8f9ff] md:border-l-[2.5px] md:border-l-[#1a2b5e]" : ""
                  }`}
                  onClick={() => setSelectedId(analysis.id)}
                  type="button"
                >
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium text-[#374151]">{formatDateTime(analysis.created_at)}</p>
                    <p className="truncate text-[10px] text-[#9ca3af]">{analysis.protocol_number}</p>
                  </div>

                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-medium text-[#111827]">{analysis.customer?.company_name ?? `Cliente #${analysis.customer_id}`}</p>
                    <p className="truncate text-[10px] text-[#9ca3af]">{analysis.customer?.document_number ?? "Documento não informado"}</p>
                  </div>

                  <div className="text-[12px] font-medium text-[#374151] md:text-center">{analysis.score?.final_score ?? "--"}</div>

                  <div className="inline-flex items-center gap-2 text-[11px] font-medium">
                    <span className={`inline-block h-2 w-2 rounded-full ${styles.dot}`} />
                    <span className={decisionTextClass(decision.tone)}>{toDecisionText(decision.label)}</span>
                  </div>

                  <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-[#6b7280]">
                    <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[#e8edf7] text-[8px] font-semibold text-[#1a2b5e]">
                      {getInitials(analysis.assigned_analyst_name ?? "Motor")}
                    </span>
                    <span className="truncate">{analysis.assigned_analyst_name ?? "Motor auto."}</span>
                  </div>

                  <div className="text-right text-[11px] font-medium text-[#374151]">
                    {formatCurrency(analysis.final_limit ?? analysis.suggested_limit ?? analysis.requested_limit)}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <aside className="h-fit overflow-hidden rounded-[10px] border border-[#e2e5eb] bg-white">
          <div className="border-b border-[#e2e5eb] bg-[#f9fafb] px-4 py-3">
            <p className="truncate text-[12px] font-medium text-[#111827]">{selectedAnalysis.protocol_number}</p>
            <p className="truncate text-[10px] text-[#9ca3af]">{selectedAnalysis.customer?.company_name ?? `Cliente #${selectedAnalysis.customer_id}`}</p>
          </div>

          <div className="space-y-4 px-4 py-4">
            <section>
              <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.04em] text-[#9ca3af]">Resultado</p>
              <div className={`rounded-[7px] border px-3 py-2 text-center ${selectedStyles.badge}`}>
                <p className="text-[11px] font-medium">{selectedDecision.label}</p>
                <p className="my-1 text-[18px] font-medium text-[#111827]">{formatCurrency(selectedAnalysis.final_limit ?? selectedAnalysis.suggested_limit)}</p>
                <p className="text-[10px] text-[#6b7280]">Score {selectedAnalysis.score?.final_score ?? "--"}</p>
              </div>
            </section>

            <section>
              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.04em] text-[#9ca3af]">Dados da análise</p>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between border-b border-[#f9fafb] py-1 text-[11px]">
                  <span className="text-[#6b7280]">Limite solicitado</span>
                  <span className="font-medium text-[#374151]">{formatCurrency(selectedAnalysis.requested_limit)}</span>
                </div>
                <div className="flex items-center justify-between border-b border-[#f9fafb] py-1 text-[11px]">
                  <span className="text-[#6b7280]">Status</span>
                  <span className="font-medium text-[#374151]">{selectedAnalysis.analysis_status}</span>
                </div>
                <div className="flex items-center justify-between border-b border-[#f9fafb] py-1 text-[11px]">
                  <span className="text-[#6b7280]">Analista</span>
                  <span className="font-medium text-[#374151]">{selectedAnalysis.assigned_analyst_name ?? "Não atribuído"}</span>
                </div>
              </div>
            </section>

            <section>
              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.04em] text-[#9ca3af]">Regras aplicadas</p>
              <div className="flex flex-wrap gap-1.5">
                {selectedRules.map((rule) => {
                  const styles = toneStyles(rule.tone);
                  return (
                    <span key={rule.id} className={`rounded px-2 py-0.5 text-[10px] ${styles.badge}`}>
                      {rule.status}
                    </span>
                  );
                })}
              </div>
            </section>

            <section>
              <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.04em] text-[#9ca3af]">Linha do tempo</p>
              <div className="space-y-2">
                {selectedMilestones.map((item) => {
                  const styles = toneStyles(item.tone);
                  return (
                    <div key={item.id} className="flex items-start gap-2">
                      <span className={`mt-1 inline-block h-2 w-2 rounded-full ${styles.dot}`} />
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-medium text-[#374151]">{item.title}</p>
                        <p className="truncate text-[10px] text-[#9ca3af]">{item.meta}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <Link
              href={`/analises/${selectedAnalysis.id}`}
              className="inline-flex w-full items-center justify-center rounded-[6px] border border-[#d1d5db] bg-white px-3 py-2 text-[11px] font-medium text-[#374151] hover:bg-[#f9fafb]"
            >
              Ver análise completa -&gt;
            </Link>
          </div>
        </aside>
      </div>
    </section>
  );
}