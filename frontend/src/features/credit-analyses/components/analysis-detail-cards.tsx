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
import { getEffectivePermissions, hasPermission } from "@/shared/lib/auth/permissions";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";

type AnalysisDetailCardsProps = {
  data: CreditAnalysisDetailApiResponse;
};

const DOSSIER_CONTAINER = "w-full px-8 xl:px-10 2xl:px-12";

const riskLabelByBand: Record<string, string> = {
  A: "Baixo risco",
  B: "Risco moderado",
  C: "AtenÃ§Ã£o",
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

function noInfo(value: string | null | undefined, fallback = "Dados nÃ£o disponÃ­veis") {
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

export function AnalysisDetailCards({ data }: AnalysisDetailCardsProps) {
  const permissions = getEffectivePermissions();
  const canApprove = hasPermission("credit.approval.approve", permissions);
  const canReject = hasPermission("credit.approval.reject", permissions);
  const { analysis, customer, score, decision, final_decision: finalDecision, events } = data;

  const resolvedDecision = decisionPill(
    resolveDecision(finalDecision?.final_decision ?? null, decision?.motor_result ?? analysis.motor_result)
  );
  const scoreNumber = toNumber(score?.final_score);
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

  const confidencePercent = scoreSummary
    ? Math.round((scoreSummary.matchedRules / Math.max(scoreSummary.evaluatedRules, 1)) * 100)
    : 72;

  const recommendationTitle =
    resolvedDecision.tone === "danger"
      ? "NÃ£o recomendado no momento"
      : resolvedDecision.tone === "success"
        ? "AprovaÃ§Ã£o recomendada"
        : "Revisar antes de decidir";

  const recommendationLimit = noInfo(
    formatCurrency(finalDecision?.final_limit ?? decision?.suggested_limit ?? analysis.suggested_limit)
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
      : [{ text: "Dados financeiros insuficientes", points: "AtenÃ§Ã£o", tone: "warning" as const }];

  const insights = [
    {
      text: `${(scoreSummary?.evaluatedRules ?? explainabilityRows.length) || 0} regras avaliadas pelo motor`,
      points: String((scoreSummary?.evaluatedRules ?? explainabilityRows.length) || 0),
      tone: "positive" as const
    },
    {
      text: "Fatores crÃ­ticos encontrados",
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
        condition: `${row.expectedValueLabel} â†’ ${row.actualValueLabel}`,
        result: row.statusLabel === "Atendida" ? ("ok" as const) : row.tone === "danger" ? ("fail" as const) : ("warn" as const),
        label: row.statusLabel === "Atendida" ? "Passou âœ“" : row.tone === "danger" ? "Falhou âœ•" : "AtenÃ§Ã£o!"
      }))
    : [
        { name: "Score mÃ­nimo", condition: "score >= 500", result: "warn" as const, label: "AtenÃ§Ã£o!" },
        { name: "Sem protestos", condition: "protestos = 0", result: "ok" as const, label: "Passou âœ“" }
      ];

  const operationRows = [
    ["Valor solicitado", noInfo(formatCurrency(analysis.requested_limit), "InformaÃ§Ã£o nÃ£o disponÃ­vel")],
    ["Prazo", "NÃ£o disponÃ­vel no momento"],
    ["Modalidade", "NÃ£o disponÃ­vel no momento"],
    ["MitigaÃ§Ã£o", "NÃ£o disponÃ­vel no momento"],
    ["Garantias", "NÃ£o disponÃ­vel no momento"],
    ["Colateral", "NÃ£o disponÃ­vel no momento"]
  ] as const;

  const timelineItems = milestones.map((item) => ({
    title: item.title,
    meta: item.meta,
    tone: item.tone === "success" ? ("green" as const) : item.tone === "warning" ? ("amber" as const) : ("blue" as const)
  }));

  const kpiLimitValue = noInfo(formatCurrency(decision?.suggested_limit ?? analysis.suggested_limit));
  const annualRevenue = noInfo(formatCurrency(analysis.annual_revenue_estimated), "InformaÃ§Ã£o nÃ£o disponÃ­vel");
  const annualRevenueMissing = annualRevenue === "InformaÃ§Ã£o nÃ£o disponÃ­vel";
  const exposureValue = noInfo(formatCurrency(analysis.exposure_amount), "InformaÃ§Ã£o nÃ£o disponÃ­vel");
  const exposureMissing = exposureValue === "InformaÃ§Ã£o nÃ£o disponÃ­vel";
  const customerMeta = [
    customer?.segment || "Segmento nÃ£o informado",
    customer?.region || "RegiÃ£o nÃ£o informada",
    customer?.relationship_start_date ? `Relacionamento: ${formatDate(customer.relationship_start_date)}` : "Relacionamento nÃ£o informado"
  ];

  return (
    <section className="bg-[#F7F9FC] pb-10" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
      <div className={DOSSIER_CONTAINER}>
        <div className="bg-[#0D1B2A] px-4 py-3 sm:px-5 sm:py-3.5 lg:px-6">
          <div className="grid grid-cols-12 items-start gap-5 xl:items-center xl:gap-4">
            <div className="col-span-12 min-w-0 xl:col-span-9">
              <div className="mb-2 inline-flex items-center gap-1.5 rounded-[20px] border border-[rgba(117,212,238,0.25)] bg-[rgba(117,212,238,0.12)] px-2.5 py-1 text-[11px] text-[#75D4EE]">
                <div className="h-1.5 w-1.5 rounded-full bg-[#75D4EE]" />
                {(customer?.segment || "Cliente") + " Â· AnÃ¡lise em andamento"}
              </div>
              <div className="mb-0.5 max-w-full break-words text-[26px] font-semibold leading-[1.1] tracking-[-0.5px] text-white [overflow-wrap:anywhere]">
                {customer?.company_name ?? `Cliente #${analysis.customer_id}`}
              </div>
              <div className="mb-2 break-words text-xs text-[rgba(255,255,255,0.45)] [overflow-wrap:anywhere]">
                CNPJ {customer?.document_number ?? "NÃ£o disponÃ­vel no momento"} Â· Protocolo {analysis.protocol_number}
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
                scorePill={`${scoreNumber ?? 0} / 1000`}
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
                "AnÃ¡lise com sinais de risco que exigem validaÃ§Ã£o humana antes da conclusÃ£o."}
            </p>
          </Card>

          <RecommendationBanner
            title={recommendationTitle}
            subtitle={scoreSummary?.executiveReason ?? "A recomendaÃ§Ã£o considera score, regras e sinais de risco."}
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
              helper={annualRevenueMissing ? "InformaÃ§Ã£o nÃ£o disponÃ­vel" : "Valor informado"}
              state={annualRevenueMissing ? "warning" : "normal"}
            />
            <KpiCard
              label="Endividamento total"
              value="InformaÃ§Ã£o nÃ£o disponÃ­vel"
              muted
              helper="InformaÃ§Ã£o nÃ£o disponÃ­vel"
              state="warning"
            />
            <KpiCard
              label="ExposiÃ§Ã£o atual"
              value={exposureValue}
              helper={exposureMissing ? "InformaÃ§Ã£o nÃ£o disponÃ­vel" : "CrÃ©dito ativo em aberto"}
              state={exposureMissing ? "warning" : "normal"}
            />
            <KpiCard
              label="Limite sugerido"
              value={kpiLimitValue}
              muted={kpiLimitValue === "Dados nÃ£o disponÃ­veis"}
              helper={kpiLimitValue === "Dados nÃ£o disponÃ­veis" ? "InformaÃ§Ã£o nÃ£o disponÃ­vel" : "Calculado pelo motor"}
              state={kpiLimitValue === "Dados nÃ£o disponÃ­veis" ? "danger" : "normal"}
            />
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
            <FactorList
              title="Insights da anÃ¡lise"
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
                Dados da operaÃ§Ã£o
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
                Linha do tempo da anÃ¡lise
              </div>
              <Timeline items={timelineItems} />
            </div>
          </div>

          <AccordionRules rules={rules} />

          <div className="flex flex-col items-start justify-between gap-4 rounded-[14px] border border-[#D7E1EC] bg-white px-6 py-5 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-[2px] lg:flex-row lg:items-center">
            <div>
              <div className="mb-1 text-[11px] text-[#4F647A]">DecisÃ£o do analista Â· {analysis.assigned_analyst_name ?? "Backoffice"}</div>
              <div className="text-sm font-medium text-[#102033]">
                {resolvedDecision.tone === "success"
                  ? "Motor sugere aprovaÃ§Ã£o. Confirme limites e conclua a anÃ¡lise."
                  : resolvedDecision.tone === "danger"
                    ? "Motor sugere reprovar. RevisÃ£o manual recomendada antes da decisÃ£o final."
                    : "Aguardando revisÃ£o dos fatores crÃ­ticos para concluir anÃ¡lise."}
              </div>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Button variant="outline" className="h-auto rounded-lg border-[#D7E1EC] px-5 py-2.5 text-[13px] font-medium text-[#102033]">
                Solicitar exceÃ§Ã£o
              </Button>
              {canReject ? (
                <button
                  type="button"
                  className="rounded-lg bg-[#C0392B] px-5 py-2.5 text-[13px] font-medium text-white transition-all duration-200 hover:shadow-md hover:-translate-y-[2px]"
                >
                  Reprovar
                </button>
              ) : null}
              {canApprove ? (
                <button
                  type="button"
                  className="rounded-lg bg-[#E8B83A] px-5 py-2.5 text-[13px] font-medium text-[#102033] transition-all duration-200 hover:shadow-md hover:-translate-y-[2px]"
                >
                  Concluir decisÃ£o â†’
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

