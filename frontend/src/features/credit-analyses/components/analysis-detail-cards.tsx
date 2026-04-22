import { CreditAnalysisDetailApiResponse } from "@/features/credit-analyses/api/contracts";
import { AnalysisEventsTimeline } from "@/features/credit-analyses/components/analysis-events-timeline";
import { buildRuleSignals, decisionPill, getInitials, resolveDecision, toneStyles } from "@/features/credit-analyses/utils/analysis-view-models";
import { formatCurrency, formatDate, formatDateTime, toNumber } from "@/features/credit-analyses/utils/formatters";

const scoreBandLabel: Record<string, string> = {
  A: "Baixo risco",
  B: "Moderado",
  C: "Atenção",
  D: "Alto risco"
};

type AnalysisDetailCardsProps = {
  data: CreditAnalysisDetailApiResponse;
};

function scorePointer(finalScore: number | null) {
  const normalized = Math.max(0, Math.min(1000, finalScore ?? 0));
  return `${Math.round((normalized / 1000) * 100)}%`;
}

export function AnalysisDetailCards({ data }: AnalysisDetailCardsProps) {
  const { analysis, customer, score, decision, final_decision: finalDecision, events } = data;
  const resolvedDecision = decisionPill(resolveDecision(finalDecision?.final_decision ?? null, decision?.motor_result ?? analysis.motor_result));
  const decisionStyles = toneStyles(resolvedDecision.tone);

  const finalScore = toNumber(score?.final_score);
  const ruleSignals = buildRuleSignals({
    analysis,
    score,
    memory: decision?.decision_memory_json ?? analysis.decision_memory_json
  });

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 rounded-[10px] border border-[#e2e5eb] bg-white px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] bg-[#e8edf7] text-[15px] font-semibold text-[#1a2b5e]">
            {getInitials(customer?.company_name)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-medium text-[#111827]">{customer?.company_name ?? `Cliente #${analysis.customer_id}`}</p>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#6b7280]">
              <p>
                CNPJ: <span className="font-medium text-[#374151]">{customer?.document_number ?? "Não informado"}</span>
              </p>
              <p>
                Segmento: <span className="font-medium text-[#374151]">{customer?.segment ?? "Não informado"}</span>
              </p>
              <p>
                Região: <span className="font-medium text-[#374151]">{customer?.region ?? "Não informada"}</span>
              </p>
              <p>
                Relacionamento: <span className="font-medium text-[#374151]">{formatDate(customer?.relationship_start_date)}</span>
              </p>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <span className="rounded bg-[#dbeafe] px-2 py-1 text-[10px] font-medium text-[#1e40af]">{analysis.protocol_number}</span>
          <span className={`rounded px-2 py-1 text-[10px] font-medium ${decisionStyles.badge}`}>{resolvedDecision.label}</span>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <article className="rounded-[10px] border border-[#e2e5eb] bg-white p-4">
          <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.04em] text-[#6b7280]">Score de crédito</p>
          <div className="flex flex-col items-center">
            <p className="text-[38px] font-medium leading-none text-[#1a2b5e]">{finalScore ?? "--"}</p>
            <p className="mt-1 text-[11px] text-[#6b7280]">Faixa: {score ? scoreBandLabel[score.score_band] ?? score.score_band : "Não calculada"}</p>
            <div className="mt-3 w-full">
              <div className="relative h-1.5 overflow-hidden rounded bg-[#e5e7eb]">
                <div className="h-full w-full rounded bg-[linear-gradient(90deg,#ef4444_0%,#f59e0b_40%,#10b981_70%)]" />
                <span
                  className="absolute -top-1 inline-block h-3 w-3 rounded-full border-2 border-white bg-[#1a2b5e] shadow-[0_0_0_1px_#1a2b5e]"
                  style={{ left: `calc(${scorePointer(finalScore)} - 6px)` }}
                />
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-[#9ca3af]">
                <span>0</span>
                <span>500</span>
                <span>700</span>
                <span>1000</span>
              </div>
            </div>
          </div>
        </article>

        <article className="rounded-[10px] border border-[#e2e5eb] bg-white p-4">
          <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.04em] text-[#6b7280]">Limite sugerido</p>
          <p className="text-[28px] font-medium text-[#111827]">{formatCurrency(decision?.suggested_limit ?? analysis.suggested_limit)}</p>
          <p className="mt-1 text-[11px] text-[#6b7280]">Calculado automaticamente pelo motor</p>

          <div className="mt-3 space-y-2 text-[12px]">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[#6b7280]">Solicitado pelo cliente</span>
              <span className="text-right font-medium text-[#374151]">{formatCurrency(analysis.requested_limit)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[#6b7280]">Limite atual ativo</span>
              <span className="text-right font-medium text-[#374151]">{formatCurrency(analysis.current_limit)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[#6b7280]">Exposição total</span>
              <span className="text-right font-medium text-[#374151]">{formatCurrency(analysis.exposure_amount)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[#6b7280]">Limite final</span>
              <span className="text-right font-medium text-[#d97706]">{formatCurrency(finalDecision?.final_limit ?? analysis.final_limit)}</span>
            </div>
          </div>
        </article>

        <article className="rounded-[10px] border border-[#e2e5eb] bg-white p-4">
          <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.04em] text-[#6b7280]">Indicadores financeiros</p>
          <div className="space-y-2">
            <div className="rounded-[6px] bg-[#f9fafb] px-3 py-2">
              <p className="text-[10px] text-[#9ca3af]">Faturamento estimado</p>
              <p className="text-[16px] font-medium text-[#111827]">{formatCurrency(analysis.annual_revenue_estimated)}</p>
            </div>
            <div className="rounded-[6px] bg-[#f9fafb] px-3 py-2">
              <p className="text-[10px] text-[#9ca3af]">Status da análise</p>
              <p className="text-[16px] font-medium text-[#111827]">{analysis.analysis_status}</p>
            </div>
            <div className="rounded-[6px] bg-[#f9fafb] px-3 py-2">
              <p className="text-[10px] text-[#9ca3af]">Analista responsável</p>
              <p className="text-[16px] font-medium text-[#111827]">{analysis.assigned_analyst_name ?? "Não atribuído"}</p>
            </div>
          </div>
        </article>
      </div>

      <article className="rounded-[10px] border border-[#e2e5eb] bg-white p-4">
        <div className="mb-3 flex flex-col gap-2 border-b border-[#f3f4f6] pb-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <p className="text-[13px] font-medium text-[#111827]">Decisão do motor</p>
            <span className={`rounded-[6px] px-3 py-1 text-[11px] font-medium ${decisionStyles.badge}`}>{resolvedDecision.label.toUpperCase()}</span>
          </div>
          <p className="text-[11px] text-[#6b7280]">Processado em {formatDateTime(decision?.decision_calculated_at ?? analysis.decision_calculated_at)}</p>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_240px]">
          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.04em] text-[#6b7280]">Regras aplicadas</p>
            <div className="space-y-1.5">
              {ruleSignals.map((rule) => {
                const styles = toneStyles(rule.tone);
                return (
                  <div key={rule.id} className="flex items-center gap-2 rounded-[6px] border border-[#e5e7eb] bg-[#f9fafb] px-3 py-2">
                    <span className={`inline-flex h-[18px] w-[18px] items-center justify-center rounded-full text-[9px] font-semibold ${styles.icon}`}>
                      {rule.tone === "success" ? "OK" : rule.tone === "danger" ? "X" : "!"}
                    </span>
                    <p className="flex-1 text-[12px] text-[#374151]">{rule.text}</p>
                    <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${styles.badge}`}>{rule.status}</span>
                  </div>
                );
              })}
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <button className="rounded-[8px] bg-[#059669] px-3 py-2 text-[12px] font-medium text-white">Confirmar aprovação</button>
              <button className="rounded-[8px] bg-[#d97706] px-3 py-2 text-[12px] font-medium text-white">Solicitar exceção</button>
              <button className="rounded-[8px] bg-[#dc2626] px-3 py-2 text-[12px] font-medium text-white">Reprovar</button>
              <button className="rounded-[8px] border border-[#d1d5db] bg-white px-3 py-2 text-[12px] font-medium text-[#374151]">Observações</button>
            </div>
          </div>

          <AnalysisEventsTimeline
            events={events}
            createdAt={analysis.created_at}
            decisionCalculatedAt={decision?.decision_calculated_at ?? analysis.decision_calculated_at}
            completedAt={finalDecision?.completed_at ?? analysis.completed_at}
          />
        </div>
      </article>
    </section>
  );
}
