"use client";

import Link from "next/link";

import { CreditAnalysisDetailApiResponse } from "@/features/credit-analyses/api/contracts";
import {
  buildExplainabilityRuleRows,
  buildExplainabilitySummary,
  buildMilestones,
  buildRuleSignals,
  decisionPill,
  resolveDecision
} from "@/features/credit-analyses/utils/analysis-view-models";
import { formatCurrency, formatDate, toNumber } from "@/features/credit-analyses/utils/formatters";
import { AccordionRules } from "@/features/credit-analysis/dossier/components/accordion-rules";
import { FactorList } from "@/features/credit-analysis/dossier/components/factor-list";
import { KpiCard } from "@/features/credit-analysis/dossier/components/kpi-card";
import { RatingCard } from "@/features/credit-analysis/dossier/components/rating-card";
import { RecommendationBanner } from "@/features/credit-analysis/dossier/components/recommendation-banner";
import { Timeline } from "@/features/credit-analysis/dossier/components/timeline";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";

type AnalysisDetailCardsProps = {
  data: CreditAnalysisDetailApiResponse;
};

const DOSSIER_CONTAINER = "w-full px-8 xl:px-10 2xl:px-12";

const riskLabelByBand: Record<string, string> = {
  A: "Baixo risco",
  B: "Risco moderado",
  C: "Atenção",
  D: "Alto risco"
};

function inferBand(score: number | null): "A" | "B" | "C" | "D" {
  if (score === null) return "C";
  if (score >= 800) return "A";
  if (score >= 650) return "B";
  if (score >= 500) return "C";
  return "D";
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u00A0/g, " ")
    .trim();
}

function noInfo(value: string | null | undefined, fallback = "Dados não disponíveis") {
  if (!value) return fallback;
  const normalized = normalizeText(value).toLowerCase();
  if (
    normalized.includes("nao informado") ||
    normalized.includes("nao informada") ||
    normalized.includes("nao informados") ||
    normalized.includes("nao informadas") ||
    normalized === "r$ 0,00" ||
    normalized === "r$0,00"
  ) {
    return fallback;
  }
  return value;
}

function committeeSessionStatusLabel(status: string | null | undefined) {
  if (status === "OPEN") return "Em deliberacao";
  if (status === "CLOSED") return "Encerrada";
  if (status === "CANCELLED") return "Cancelada";
  return status || "Nao informado";
}

function committeeVoteStatusLabel(status: string | null | undefined) {
  if (status === "PENDING") return "Pendente";
  if (status === "VOTED") return "Votado";
  if (status === "SKIPPED") return "Dispensado";
  return status || "Nao informado";
}
export function AnalysisDetailCards({ data }: AnalysisDetailCardsProps) {
  const { analysis, customer, score, decision, final_decision: finalDecision, events } = data;
  const committeeSession = analysis.committee_session ?? null;

  const resolvedDecision = decisionPill(
    resolveDecision(finalDecision?.final_decision ?? null, decision?.motor_result ?? analysis.motor_result)
  );
  const scoreNumber = toNumber(score?.executive_score ?? score?.final_score);
  const scoreBand = score?.score_band ?? inferBand(scoreNumber);
  const scoreSummary = buildExplainabilitySummary({
    score,
    decisionMemory: decision?.decision_memory_json ?? analysis.decision_memory_json
  });
  const explainabilityRows = buildExplainabilityRuleRows({
    score,
    decisionMemory: decision?.decision_memory_json ?? analysis.decision_memory_json
  });
  const ruleSignals = buildRuleSignals({
    analysis,
    score,
    memory: decision?.decision_memory_json ?? analysis.decision_memory_json
  });
  const milestones = buildMilestones({ analysis, events });
  const decisionMemory = (decision?.decision_memory_json ?? analysis.decision_memory_json) as Record<string, unknown> | null;
  const recommendationClassification =
    decisionMemory && typeof decisionMemory.recommendation_classification === "object"
      ? (decisionMemory.recommendation_classification as Record<string, unknown>)
      : null;
  const canonicalFinalSuggestedLimit = (() => {
    if (!recommendationClassification) return null;
    const raw = recommendationClassification.final_suggested_limit;
    if (raw === undefined || raw === null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  })();
  const approvalPreview =
    decisionMemory && typeof decisionMemory.approval_matrix_preview === "object"
      ? (decisionMemory.approval_matrix_preview as Record<string, unknown>)
      : null;
  const approvalRequiredRoles = Array.isArray(approvalPreview?.required_roles)
    ? (approvalPreview.required_roles as string[])
    : [];

  const confidencePercent = scoreSummary
    ? Math.round((scoreSummary.matchedRules / Math.max(scoreSummary.evaluatedRules, 1)) * 100)
    : 72;

  const recommendationTitle =
    resolvedDecision.tone === "danger"
      ? "Não recomendado no momento"
      : resolvedDecision.tone === "success"
        ? "Aprovação recomendada"
        : "Revisar antes de decidir";

  const recommendationLimit = noInfo(
    formatCurrency(finalDecision?.final_limit ?? canonicalFinalSuggestedLimit ?? decision?.suggested_limit ?? analysis.suggested_limit)
  );

  const positiveFactorsRaw = explainabilityRows.filter((item) => item.statusLabel === "Atendida").slice(0, 3);
  const riskFactorsRaw = explainabilityRows.filter((item) => item.statusLabel !== "Atendida").slice(0, 3);

  const positiveFactors =
    positiveFactorsRaw.length > 0
      ? positiveFactorsRaw.map((item) => ({
          text: item.label,
          points: item.impactLabel.includes("Sem impacto") ? "+0 pts" : item.impactLabel.replace("pontos", "pts"),
          tone: "positive" as const
        }))
      : [{ text: "Sem protestos registrados", points: "+0 pts", tone: "positive" as const }];

  const riskFactors =
    riskFactorsRaw.length > 0
      ? riskFactorsRaw.map((item) => ({
          text: item.label,
          points: item.impactLabel.replace("pontos", "pts"),
          tone: "negative" as const
        }))
      : [{ text: "Dados financeiros insuficientes", points: "Atenção", tone: "warning" as const }];

  const insights = [
    {
      text: `${(scoreSummary?.evaluatedRules ?? explainabilityRows.length) || 0} regras avaliadas pelo motor`,
      points: String((scoreSummary?.evaluatedRules ?? explainabilityRows.length) || 0),
      tone: "positive" as const
    },
    {
      text: "Fatores críticos encontrados",
      points: String(riskFactors.length),
      tone: "negative" as const
    },
    ...ruleSignals.slice(0, 2).map((signal) => ({
      text: signal.text,
      points: signal.status === "INFO" ? "" : signal.status,
      tone:
        signal.tone === "danger"
          ? ("negative" as const)
          : signal.tone === "warning"
            ? ("warning" as const)
            : ("positive" as const)
    }))
  ].slice(0, 4);

  const rules = explainabilityRows.length
    ? explainabilityRows.slice(0, 14).map((row) => ({
        name: row.label,
        condition: `${row.expectedValueLabel}  ${row.actualValueLabel}`,
        result: row.statusLabel === "Atendida" ? ("ok" as const) : row.tone === "danger" ? ("fail" as const) : ("warn" as const),
        label: row.statusLabel === "Atendida" ? "Passou " : row.tone === "danger" ? "Falhou " : "Atenção!"
      }))
    : [
        { name: "Score mínimo", condition: "score >= 500", result: "warn" as const, label: "Atenção!" },
        { name: "Sem protestos", condition: "protestos = 0", result: "ok" as const, label: "Passou " }
      ];

  const operationRows = [
    ["Valor solicitado", noInfo(formatCurrency(analysis.requested_limit), "Informação não disponível")],
    ["Prazo", "Não disponível no momento"],
    ["Modalidade", "Não disponível no momento"],
    ["Mitigação", "Não disponível no momento"],
    ["Garantias", "Não disponível no momento"],
    ["Colateral", "Não disponível no momento"]
  ] as const;

  const timelineItems = milestones.map((item) => ({
    title: item.title,
    meta: item.meta,
    tone: item.tone === "success" ? ("green" as const) : item.tone === "warning" ? ("amber" as const) : ("blue" as const)
  }));

  const kpiLimitValue = noInfo(formatCurrency(canonicalFinalSuggestedLimit ?? decision?.suggested_limit ?? analysis.suggested_limit));
  const annualRevenue = noInfo(formatCurrency(analysis.annual_revenue_estimated), "Informação não disponível");
  const annualRevenueMissing = annualRevenue === "Informação não disponível";
  const exposureValue = noInfo(formatCurrency(analysis.exposure_amount), "Informação não disponível");
  const exposureMissing = exposureValue === "Informação não disponível";
  const customerMeta = [
    customer?.segment || "Segmento não informado",
    customer?.region || "Região não informada",
    customer?.relationship_start_date ? `Relacionamento: ${formatDate(customer.relationship_start_date)}` : "Relacionamento não informado"
  ];

  return (
    <section className="bg-[#F7F9FC] pb-10" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
      <div className={DOSSIER_CONTAINER}>
        <div className="bg-[#0D1B2A] px-4 py-3 sm:px-5 sm:py-3.5 lg:px-6">
          <div className="grid grid-cols-12 items-start gap-5 xl:items-center xl:gap-4">
            <div className="col-span-12 min-w-0 xl:col-span-9">
              <div className="mb-2 inline-flex items-center gap-1.5 rounded-[20px] border border-[rgba(117,212,238,0.25)] bg-[rgba(117,212,238,0.12)] px-2.5 py-1 text-[11px] text-[#75D4EE]">
                <div className="h-1.5 w-1.5 rounded-full bg-[#75D4EE]" />
                {(customer?.segment || "Cliente") + " · Análise em andamento"}
              </div>
              <div className="mb-0.5 max-w-full break-words text-[26px] font-semibold leading-[1.1] tracking-[-0.5px] text-white [overflow-wrap:anywhere]">
                {customer?.company_name ?? `Cliente #${analysis.customer_id}`}
              </div>
              <div className="mb-2 break-words text-xs text-[rgba(255,255,255,0.45)] [overflow-wrap:anywhere]">
                CNPJ {customer?.document_number ?? "Não disponível no momento"} · Protocolo {analysis.protocol_number}
              </div>
              <div className="flex flex-wrap gap-y-0.5">
                {customerMeta.map((meta, index, arr) => (
                  <div
                    key={`${meta}-${index}`}
                    className={
                      index === arr.length - 1
                        ? "mr-3 flex items-center gap-1 pr-3 text-xs text-[rgba(255,255,255,0.58)]"
                        : "mr-3 flex items-center gap-1 border-r border-[rgba(255,255,255,0.08)] pr-3 text-xs text-[rgba(255,255,255,0.58)]"
                    }
                  >
                    <span className="h-3 w-3 rounded-full border border-[rgba(255,255,255,0.45)]" />
                    {meta}
                  </div>
                ))}
              </div>
            </div>

            <div className="col-span-12 min-w-0 pt-0.5 xl:col-span-3 xl:self-center xl:pt-0">
              <RatingCard
                letter={scoreBand}
                score={`${scoreNumber ?? 0} pts`}
                rangeLabel={`Faixa ${scoreBand}`}
                riskLabel={riskLabelByBand[scoreBand] ?? "Risco moderado"}
                scorePill={`${scoreNumber ?? 0} / 100`}
                dateLabel={`Atualizado ${formatDate(analysis.decision_calculated_at ?? analysis.created_at)}`}
              />
            </div>
          </div>
        </div>

        <div className="pt-6">
          <Card className="mb-6 border border-[#D7E1EC] bg-white p-6 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-[2px]">
            <div className="mb-2 text-xs uppercase text-muted-foreground">Resumo executivo</div>
            <p className="text-base leading-relaxed text-foreground">
              {scoreSummary?.executiveReason ??
                "Análise com sinais de risco que exigem validação humana antes da conclusão."}
            </p>
          </Card>

          <RecommendationBanner
            title={recommendationTitle}
            subtitle={scoreSummary?.executiveReason ?? "A recomendação considera score, regras e sinais de risco."}
            limitSuggested={recommendationLimit}
            risk={riskLabelByBand[scoreBand] ?? "Risco moderado"}
            confidence={`${confidencePercent}%`}
            confidencePercent={confidencePercent}
          />

          <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Faturamento anual"
              value={annualRevenue}
              muted={annualRevenueMissing}
              helper={annualRevenueMissing ? "Informação não disponível" : "Valor informado"}
              state={annualRevenueMissing ? "warning" : "normal"}
            />
            <KpiCard
              label="Endividamento total"
              value="Informação não disponível"
              muted
              helper="Informação não disponível"
              state="warning"
            />
            <KpiCard
              label="Exposição atual"
              value={exposureValue}
              helper={exposureMissing ? "Informação não disponível" : "Crédito ativo em aberto"}
              state={exposureMissing ? "warning" : "normal"}
            />
            <KpiCard
              label="Limite sugerido"
              value={kpiLimitValue}
              muted={kpiLimitValue === "Dados não disponíveis"}
              helper={kpiLimitValue === "Dados não disponíveis" ? "Informação não disponível" : "Calculado pelo motor"}
              state={kpiLimitValue === "Dados não disponíveis" ? "danger" : "normal"}
            />
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
            <FactorList
              title="Insights da análise"
              titleTone="neutral"
              titleIcon={
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <circle cx="7" cy="7" r="5.5" stroke="#4F647A" strokeWidth="1.2" />
                  <path d="M7 4v3h2.5" stroke="#4F647A" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              }
              items={insights}
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
              items={positiveFactors}
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
              items={riskFactors}
            />
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="rounded-[14px] border border-[#D7E1EC] bg-white p-6 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-[2px]">
              <div className="mb-3.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.6px] text-[#4F647A]">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <rect x="1.5" y="2" width="11" height="10" rx="1.5" stroke="#4F647A" strokeWidth="1.2" />
                  <path d="M4 6h6M4 8.5h4" stroke="#4F647A" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                Dados da operação
              </div>
              {operationRows.map((row) => (
                <div key={row[0]} className="flex items-baseline justify-between border-b border-[#F0F4F8] py-2 last:border-b-0">
                  <div className="text-xs text-[#4F647A]">{row[0]}</div>
                  <div className="text-xs font-medium text-[#102033]">{row[1]}</div>
                </div>
              ))}
            </div>

            <div className="rounded-[14px] border border-[#D7E1EC] bg-white p-6 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-[2px]">
              <div className="mb-3.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.6px] text-[#4F647A]">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <circle cx="7" cy="7" r="5.5" stroke="#4F647A" strokeWidth="1.2" />
                  <path d="M7 4.5v3.5M7 9v.5" stroke="#4F647A" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                Linha do tempo da análise
              </div>
              <Timeline items={timelineItems} />
            </div>
          </div>

          <div className="rounded-[14px] border border-[#D7E1EC] bg-white px-6 py-5 shadow-sm">
            <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#4F647A]">Consulta administrativa</div>
                <p className="text-sm font-medium text-[#102033]">As decisões de aprovação ficam centralizadas no Dossiê Executivo da Etapa 4.</p>
                <p className="mt-1 text-xs text-[#4F647A]">Use esta tela para consulta, histórico e leitura dos dados consolidados da análise.</p>
              </div>
              <Link href={`/analises/${analysis.id}/workspace`} className="inline-flex h-10 items-center justify-center rounded-[10px] bg-[#102033] px-4 text-[12px] font-semibold text-white hover:bg-[#1f344d]">
                Abrir Dossiê Executivo
              </Link>
            </div>
          </div>

          <div className="mb-6 rounded-[14px] border border-[#D7E1EC] bg-white p-6 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-[2px]">
            <div className="mb-4 flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#4F647A]">Comite de Credito</div>
                {committeeSession ? (
                  <p className="text-sm font-semibold text-[#102033]">{committeeSession.committee_name}</p>
                ) : (
                  <p className="text-sm font-medium text-[#102033]">Nenhuma sessao de Comite foi aberta para esta analise.</p>
                )}
              </div>
              {committeeSession ? (
                <span className="inline-flex w-fit items-center rounded-[999px] border border-[#F1D48A] bg-[#FFF8E1] px-3 py-1 text-[11px] font-semibold text-[#7A5A12]">
                  {committeeSessionStatusLabel(committeeSession.status)}
                </span>
              ) : null}
            </div>

            {committeeSession ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="rounded-[10px] border border-[#EEF2F6] bg-[#F8FAFC] px-4 py-3">
                    <div className="mb-1 text-[11px] uppercase tracking-[0.06em] text-[#6B7A8A]">Submetido por</div>
                    <div className="text-sm font-medium text-[#102033]">{committeeSession.requested_by ?? "Nao informado"}</div>
                  </div>
                  <div className="rounded-[10px] border border-[#EEF2F6] bg-[#F8FAFC] px-4 py-3">
                    <div className="mb-1 text-[11px] uppercase tracking-[0.06em] text-[#6B7A8A]">Data da submissao</div>
                    <div className="text-sm font-medium text-[#102033]">{formatDate(committeeSession.requested_at)}</div>
                  </div>
                </div>

                <div>
                  <div className="mb-1 text-[11px] uppercase tracking-[0.06em] text-[#6B7A8A]">Justificativa</div>
                  <p className="whitespace-pre-line text-sm leading-6 text-[#102033]">{committeeSession.reason}</p>
                </div>

                <div>
                  <div className="mb-2 text-[11px] uppercase tracking-[0.06em] text-[#6B7A8A]">Membros</div>
                  <div className="divide-y divide-[#EEF2F6] rounded-[10px] border border-[#EEF2F6]">
                    {committeeSession.votes.length > 0 ? (
                      committeeSession.votes.map((vote, index) => (
                        <div key={`${vote.role_code ?? vote.role_name}-${vote.user_name ?? "pending"}-${index}`} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="text-sm font-medium text-[#102033]">
                            {vote.role_name}{vote.user_name ? ` - ${vote.user_name}` : ""}
                          </div>
                          <div className="text-xs font-semibold text-[#7A5A12]">{committeeVoteStatusLabel(vote.status)}</div>
                        </div>
                      ))
                    ) : (
                      <div className="px-4 py-3 text-sm text-[#4F647A]">Nenhum membro pendente foi registrado.</div>
                    )}
                  </div>
                </div>

                {committeeSession.warnings.length > 0 ? (
                  <div className="rounded-[10px] border border-[#F1D48A] bg-[#FFFDF4] px-4 py-3">
                    {committeeSession.warnings.map((warning) => (
                      <div key={warning} className="text-xs leading-5 text-[#7A5A12]">{warning}</div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          <AccordionRules rules={rules} />

          <div className="flex flex-col items-start justify-between gap-4 rounded-[14px] border border-[#D7E1EC] bg-white px-6 py-5 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-[2px] lg:flex-row lg:items-center">
            <div>
              <div className="mb-1 text-[11px] text-[#4F647A]">Decisão do analista · {analysis.assigned_analyst_name ?? "Backoffice"}</div>
              <div className="text-sm font-medium text-[#102033]">
                {resolvedDecision.tone === "success"
                  ? "Motor sugere aprovação. Confirme limites e conclua a análise."
                  : resolvedDecision.tone === "danger"
                    ? "Motor sugere reprovar. Revisão manual recomendada antes da decisão final."
                    : "Aguardando revisão dos fatores críticos para concluir análise."}
              </div>
              {approvalRequiredRoles.length > 0 ? (
                <div className="mt-2 text-xs text-[#4F647A]">Alçada requerida: {approvalRequiredRoles.join(" / ")}</div>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Button variant="outline" className="h-auto rounded-lg border-[#D7E1EC] px-5 py-2.5 text-[13px] font-medium text-[#102033]">
                Solicitar exceção
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

