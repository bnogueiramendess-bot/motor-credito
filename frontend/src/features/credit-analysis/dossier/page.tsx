"use client";

import { useEffect, useState } from "react";

import { AccordionRules } from "@/features/credit-analysis/dossier/components/accordion-rules";
import { FactorList } from "@/features/credit-analysis/dossier/components/factor-list";
import { KpiCard } from "@/features/credit-analysis/dossier/components/kpi-card";
import { RatingCard } from "@/features/credit-analysis/dossier/components/rating-card";
import { RecommendationBanner } from "@/features/credit-analysis/dossier/components/recommendation-banner";
import { Timeline } from "@/features/credit-analysis/dossier/components/timeline";
import { Button } from "@/shared/components/ui/button";
import { Skeleton } from "@/shared/components/ui/skeleton";

type CreditAnalysisDossierPageProps = {
  analysisId: string;
};

const PAGE_CONTAINER = "mx-auto w-full max-w-[1360px] px-6";

const dossierData = {
  customerTag: "Produtor rural · Analise em andamento",
  customerName: "Agropecuaria Guarani Ltda.",
  customerDocument: "CNPJ 14.882.341/0001-09 · Protocolo #2024-8841",
  customerMeta: ["Soja · Milho", "Uberlandia, MG", "4 anos de relacionamento"],
  executiveSummary:
    "Cliente com score 610 (Faixa C), com restricao ativa e eventos de cheque sem fundo. Ausencia de dados financeiros limita a recomendacao automatica de limite. Analise requer revisao manual antes de aprovacao.",
  rating: {
    letter: "C",
    score: "610 pts",
    rangeLabel: "Faixa C",
    riskLabel: "Risco moderado",
    scorePill: "610 / 1000",
    dateLabel: "AgRisk · Atualizado 15/04/2024"
  },
  recommendation: {
    title: "Revisar antes de decidir",
    subtitle: "2 fatores criticos impedem aprovacao automatica. Analise manual necessaria.",
    limitSuggested: "Nao recomendado",
    risk: "Moderado",
    confidence: "72%",
    confidencePercent: 72
  },
  kpis: [
    { label: "Faturamento anual", value: "Nao informado", muted: true, helper: "Dado ausente", state: "warning" as const },
    { label: "Endividamento total", value: "Nao informado", muted: true, helper: "Dado ausente", state: "warning" as const },
    { label: "Exposicao atual", value: "R$ 10.000", helper: "Credito ativo em aberto", state: "normal" as const },
    { label: "Limite sugerido", value: "Nao recomendado", helper: "Restricao ativa pendente", state: "danger" as const }
  ],
  insights: [
    { text: "14 regras avaliadas pelo motor", points: "14", tone: "positive" as const },
    { text: "Fatores criticos encontrados", points: "2", tone: "negative" as const },
    { text: "Restricao ativa identificada", points: "", tone: "negative" as const },
    { text: "Dados financeiros insuficientes", points: "", tone: "warning" as const }
  ],
  positiveFactors: [
    { text: "Sem protestos registrados", points: "+0 pts", tone: "positive" as const },
    { text: "Sem acoes judiciais ativas", points: "+0 pts", tone: "positive" as const },
    { text: "4 anos de relacionamento ativo", points: "+40 pts", tone: "positive" as const }
  ],
  riskFactors: [
    { text: "Restricao ativa (SPC/Serasa)", points: "-300 pts", tone: "negative" as const },
    { text: "Cheque sem fundo registrado", points: "-90 pts", tone: "negative" as const },
    { text: "Dados financeiros insuficientes", points: "Atencao", tone: "warning" as const }
  ],
  operationRows: [
    ["Valor solicitado", "R$ 450.000,00"],
    ["Prazo", "12 meses"],
    ["Modalidade", "Capital de giro — Safra 2024/25"],
    ["Mitigacao", "Alienacao fiduciaria de maquinas"],
    ["Garantias", "Imovel rural (Matricula 8.821)"],
    ["Colateral", "Penhor de safra estimada 800 sc/soja"]
  ],
  timeline: [
    { title: "Analise criada", meta: "20/04/2024 · 09:00 · Mariana Costa", tone: "blue" as const },
    { title: "Dados AgRisk importados automaticamente", meta: "20/04/2024 · 09:02 · Motor de importacao v2.1", tone: "blue" as const },
    { title: "Consulta SPC/Serasa realizada", meta: "20/04/2024 · 09:03 · Integracao automatica", tone: "blue" as const },
    { title: "Score calculado: 610 · Restricao ativa detectada", meta: "20/04/2024 · 09:04 · Motor v3.2 · 14 regras aplicadas", tone: "amber" as const },
    { title: "Encaminhado para revisao manual do analista", meta: "20/04/2024 · 09:04 · Aguardando decisao", tone: "amber" as const }
  ],
  rules: [
    { name: "Restricao ativa", condition: "restricoes = true", result: "fail" as const, label: "Falhou ✕" },
    { name: "Cheque sem fundo", condition: "cheque_sf > 0", result: "fail" as const, label: "Falhou ✕" },
    { name: "Score minimo", condition: "score >= 500", result: "warn" as const, label: "Atencao !" },
    { name: "Sem protestos", condition: "protestos = 0", result: "ok" as const, label: "Passou ✓" },
    { name: "Sem acoes judiciais", condition: "acoes_jud = 0", result: "ok" as const, label: "Passou ✓" },
    { name: "Dados financeiros", condition: "faturamento != null", result: "warn" as const, label: "Incompleto !" },
    { name: "Tempo relacionamento", condition: "anos_rel >= 2", result: "ok" as const, label: "Passou ✓" },
    { name: "Exposicao maxima", condition: "exposicao <= limite_max", result: "ok" as const, label: "Passou ✓" }
  ]
};

function DossierSkeleton() {
  return (
    <section className="space-y-4 bg-[#F7F9FC] pb-10">
      <Skeleton className="h-[260px] w-full rounded-none" />
      <div className={`${PAGE_CONTAINER} space-y-4`}>
        <Skeleton className="h-[96px] w-full rounded-[14px]" />
        <Skeleton className="h-[96px] w-full rounded-[14px]" />
        <Skeleton className="h-[240px] w-full rounded-[14px]" />
      </div>
    </section>
  );
}

export function CreditAnalysisDossierPage({ analysisId }: CreditAnalysisDossierPageProps) {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timeout = setTimeout(() => setLoading(false), 600);
    return () => clearTimeout(timeout);
  }, []);

  if (loading) return <DossierSkeleton />;

  return (
    <section className="bg-[#F7F9FC] pb-10" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
      <div className="bg-[#0D1B2A] pb-0 pt-5">
        <div className={PAGE_CONTAINER}>
          <div className="grid grid-cols-12 items-center gap-6">
            <div className="col-span-12 pb-2 xl:col-span-8">
              <div className="mb-3.5 inline-flex items-center gap-1.5 rounded-[20px] border border-[rgba(117,212,238,0.25)] bg-[rgba(117,212,238,0.12)] px-2.5 py-1 text-[11px] text-[#75D4EE]">
                <div className="h-1.5 w-1.5 rounded-full bg-[#75D4EE]" />
                {dossierData.customerTag}
              </div>
              <div className="mb-1.5 text-[32px] font-semibold leading-[1.1] tracking-[-0.5px] text-white">{dossierData.customerName}</div>
              <div className="mb-4 text-xs text-[rgba(255,255,255,0.4)]">{dossierData.customerDocument}</div>
              <div className="flex flex-wrap gap-0">
                {dossierData.customerMeta.map((meta, index) => (
                  <div
                    key={meta}
                    className={
                      index === dossierData.customerMeta.length - 1
                        ? "mr-4 flex items-center gap-1.5 pr-4 text-xs text-[rgba(255,255,255,0.55)]"
                        : "mr-4 flex items-center gap-1.5 border-r border-[rgba(255,255,255,0.1)] pr-4 text-xs text-[rgba(255,255,255,0.55)]"
                    }
                  >
                    <span className="h-3.5 w-3.5 rounded-full border border-[rgba(255,255,255,0.5)]" />
                    {meta}
                  </div>
                ))}
              </div>
            </div>

            <div className="col-span-12 mt-1 xl:col-span-4">
              <RatingCard
                letter={dossierData.rating.letter}
                score={dossierData.rating.score}
                rangeLabel={dossierData.rating.rangeLabel}
                riskLabel={dossierData.rating.riskLabel}
                scorePill={dossierData.rating.scorePill}
                dateLabel={dossierData.rating.dateLabel}
              />
            </div>

            <div className="col-span-12 rounded-[14px] border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.05)] p-5">
              <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.8px] text-[rgba(255,255,255,0.35)]">Resumo executivo</div>
              <div className="text-[13px] leading-[1.6] text-[rgba(255,255,255,0.72)]">{dossierData.executiveSummary}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="h-7 bg-[#0D1B2A]" />

      <div className={PAGE_CONTAINER}>
        <div className="pt-10">
          <RecommendationBanner
            title={dossierData.recommendation.title}
            subtitle={dossierData.recommendation.subtitle}
            limitSuggested={dossierData.recommendation.limitSuggested}
            risk={dossierData.recommendation.risk}
            confidence={dossierData.recommendation.confidence}
            confidencePercent={dossierData.recommendation.confidencePercent}
          />

          <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {dossierData.kpis.map((kpi) => (
              <KpiCard key={kpi.label} label={kpi.label} value={kpi.value} muted={kpi.muted} helper={kpi.helper} state={kpi.state} />
            ))}
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
            <FactorList
              title="Insights da analise"
              titleTone="neutral"
              titleIcon={
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <circle cx="7" cy="7" r="5.5" stroke="#4F647A" strokeWidth="1.2" />
                  <path d="M7 4v3h2.5" stroke="#4F647A" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              }
              items={dossierData.insights}
              isInsights
            />
            <FactorList
              title="Fatores positivos"
              titleTone="positive"
              titleIcon={
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <circle cx="7" cy="7" r="5.5" stroke="#1A7A3A" strokeWidth="1.2" />
                  <path d="M4.5 7l2 2 3-3" stroke="#1A7A3A" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              }
              items={dossierData.positiveFactors}
            />
            <FactorList
              title="Fatores de risco"
              titleTone="negative"
              titleIcon={
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <circle cx="7" cy="7" r="5.5" stroke="#C0392B" strokeWidth="1.2" />
                  <path d="M7 4v3.5M7 9.5v.5" stroke="#C0392B" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              }
              items={dossierData.riskFactors}
            />
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="rounded-[14px] border border-[#D7E1EC] bg-white p-6 shadow-sm transition-all duration-200 hover:-translate-y-0.5">
              <div className="mb-3.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.6px] text-[#4F647A]">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <rect x="1.5" y="2" width="11" height="10" rx="1.5" stroke="#4F647A" strokeWidth="1.2" />
                  <path d="M4 6h6M4 8.5h4" stroke="#4F647A" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                Dados da operacao
              </div>
              {dossierData.operationRows.map((row) => (
                <div key={row[0]} className="flex items-baseline justify-between border-b border-[#F0F4F8] py-2 last:border-b-0">
                  <div className="text-xs text-[#4F647A]">{row[0]}</div>
                  <div className="text-xs font-medium text-[#102033]">{row[1]}</div>
                </div>
              ))}
            </div>

            <div className="rounded-[14px] border border-[#D7E1EC] bg-white p-6 shadow-sm transition-all duration-200 hover:-translate-y-0.5">
              <div className="mb-3.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.6px] text-[#4F647A]">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <circle cx="7" cy="7" r="5.5" stroke="#4F647A" strokeWidth="1.2" />
                  <path d="M7 4.5v3.5M7 9v.5" stroke="#4F647A" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                Linha do tempo da analise
              </div>
              <Timeline items={dossierData.timeline} />
            </div>
          </div>

          <div className="mb-6">
            <AccordionRules rules={dossierData.rules} />
          </div>

          <div className="flex flex-col items-start justify-between gap-4 rounded-[14px] border border-[#D7E1EC] bg-white px-6 py-5 shadow-sm lg:flex-row lg:items-center">
            <div>
              <div className="mb-1 text-[11px] text-[#4F647A]">Decisao do analista · Mariana Costa</div>
              <div className="text-sm font-medium text-[#102033]">Aguardando revisao dos fatores criticos para concluir analise</div>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Button variant="outline" className="h-auto rounded-lg border-[#D7E1EC] px-5 py-2.5 text-[13px] font-medium text-[#102033]">
                Solicitar excecao
              </Button>
              <button type="button" className="rounded-lg bg-[#C0392B] px-5 py-2.5 text-[13px] font-medium text-white transition-all duration-200 hover:-translate-y-0.5">
                Reprovar
              </button>
              <button type="button" className="rounded-lg bg-[#E8B83A] px-5 py-2.5 text-[13px] font-medium text-[#102033] transition-all duration-200 hover:-translate-y-0.5">
                Concluir decisao →
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className={`${PAGE_CONTAINER} mt-3 text-[10px] text-[#9CA3AF]`}>Analise ID: {analysisId}</div>
    </section>
  );
}
