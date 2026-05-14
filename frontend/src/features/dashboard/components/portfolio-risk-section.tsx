"use client";

import { useState } from "react";

import { formatCurrencyInThousands } from "@/features/dashboard/utils/dashboard-formatters";
import { toNumber } from "@/features/credit-analyses/utils/formatters";
import { usePortfolioAgingLatestQuery } from "@/features/portfolio/hooks/use-portfolio-aging-latest-query";
import { usePortfolioRiskSummaryQuery } from "@/features/portfolio/hooks/use-portfolio-risk-summary-query";

const percent = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function formatPctFromFraction(value: number) {
  return `${percent.format((value || 0) * 100)}%`;
}

function RiskMiniCard({
  title,
  amount,
  clients,
  action,
  tone,
  labelTone,
  highlightHover = false
}: {
  title: string;
  amount: number;
  clients: number;
  action: string;
  tone: string;
  labelTone: string;
  highlightHover?: boolean;
}) {
  return (
    <article className={`rounded-xl border p-4 transition-shadow ${tone} ${highlightHover ? "hover:shadow-[0_0_20px_rgba(255,0,0,0.15)]" : ""}`}>
      <p className={`text-xs font-semibold uppercase tracking-[0.08em] ${labelTone}`}>{title}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-white">{formatCurrencyInThousands(amount)}</p>
      <p className="mt-1 text-sm text-white/60">{clients} clientes</p>
      <p className="mt-2 text-xs font-medium text-white/70">{action}</p>
    </article>
  );
}

export function PortfolioRiskSection({ snapshotId, businessUnitContext }: { snapshotId?: string; businessUnitContext?: string }) {
  const query = usePortfolioRiskSummaryQuery(snapshotId, businessUnitContext);
  const agingQuery = usePortfolioAgingLatestQuery({ snapshot_id: snapshotId, business_unit_context: businessUnitContext });
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [showTopClients, setShowTopClients] = useState(false);
  const isConsolidatedContext = !businessUnitContext || businessUnitContext === "consolidated";

  if (query.isLoading) {
    return (
      <section className="rounded-2xl border border-[#1f3754] bg-[#0d1b2a] p-5">
        <div className="h-5 w-44 animate-pulse rounded bg-white/15" />
        <div className="mt-2 h-4 w-96 max-w-full animate-pulse rounded bg-white/10" />
        <div className="mt-4 h-28 animate-pulse rounded-xl bg-white/10" />
      </section>
    );
  }

  if (query.isError) {
    return (
      <section className="rounded-2xl border border-[#1f3754] bg-[#0d1b2a] p-5">
        <h3 className="text-lg font-semibold text-white">Risco da Carteira</h3>
        <p className="mt-3 rounded-lg border border-rose-300/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">
          Não foi possível carregar o risco da carteira.
        </p>
      </section>
    );
  }

  const data = query.data;
  if (!data) {
    return (
      <section className="rounded-2xl border border-[#1f3754] bg-[#0d1b2a] p-5">
        <h3 className="text-lg font-semibold text-white">Risco da Carteira</h3>
        <p className="mt-3 text-sm text-white/70">Nenhuma exposição classificada no último snapshot.</p>
      </section>
    );
  }

  const critical = data.distribution.critical;
  const attention = data.distribution.attention;
  const healthy = data.distribution.healthy;
  // Conversao oficial de risco (sem expor termos tecnicos na UI):
  // Critical = Probable, Attention = Possible, Healthy = Rare.
  const total = critical.amount + attention.amount + healthy.amount;
  const totalClientsInDistribution = critical.clients + attention.clients + healthy.clients;
  const totalOpenAr = toNumber(agingQuery.data?.total_open_amount) ?? 0;
  const totalRiskVsAr = totalOpenAr > 0 ? total / totalOpenAr : 0;

  if (total <= 0) {
    return (
      <section className="rounded-2xl border border-[#1f3754] bg-[#0d1b2a] p-5">
        <h3 className="text-lg font-semibold text-white">Risco da Carteira</h3>
        <p className="mt-1 text-sm text-white/60">Exposição consolidada por severidade, baseada no último snapshot BoD disponível.</p>
        <p className="mt-3 text-sm text-white/75">Nenhuma exposição classificada no último snapshot.</p>
      </section>
    );
  }

  const segments = [
    { label: "Probable", value: critical.percentage, color: "bg-rose-500" },
    { label: "Possible", value: attention.percentage, color: "bg-amber-400" },
    { label: "Rare", value: healthy.percentage, color: "bg-emerald-400" }
  ];
  const topRiskTotal = (data.top_clients_at_risk ?? []).reduce((acc, item) => acc + (item.amount || 0), 0);
  const topRiskShare = total > 0 ? topRiskTotal / total : 0;
  const topListSubtitle = isConsolidatedContext ? "Exposições acima de R$ 500 mil" : "Top 5 da BU selecionada";

  return (
    <section className="rounded-2xl border border-[#1f3754] bg-[#0d1b2a] p-5 xl:p-6">
      <h3 className="text-lg font-semibold text-white">Risco da Carteira</h3>
      <p className="mt-1 text-sm text-white/60">Onde está o risco da carteira hoje.</p>

      <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-12">
        <article className="rounded-xl border border-[#2b4a72] bg-[#112841] p-4 xl:col-span-6">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-white/70">Exposição em Risco</p>
          <p className="mt-2 text-3xl font-bold text-[#75D4EE]">{formatCurrencyInThousands(total)}</p>
          <p className="mt-2 text-sm text-white/70">
            {formatPctFromFraction(totalRiskVsAr)} da carteira · {totalClientsInDistribution} clientes
          </p>
        </article>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 xl:col-span-6">
          <RiskMiniCard
            title="Probable"
            amount={critical.amount}
            clients={critical.clients}
            action="Ação imediata"
            tone="border-rose-400/50 bg-white/[0.03]"
            labelTone="text-rose-400"
            highlightHover
          />
          <RiskMiniCard
            title="Possible"
            amount={attention.amount}
            clients={attention.clients}
            action="Monitorar"
            tone="border-amber-300/50 bg-white/[0.03]"
            labelTone="text-amber-400"
          />
          <RiskMiniCard
            title="Rare"
            amount={healthy.amount}
            clients={healthy.clients}
            action="Sem ação imediata"
            tone="border-emerald-300/50 bg-white/[0.03]"
            labelTone="text-emerald-400"
          />
        </div>
      </div>

      <div className="mt-5">
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-white/10">
          {segments.map((segment) => (
            <div key={segment.label} className={`relative h-full ${segment.color}`} style={{ width: `${Math.max(segment.value * 100, 0)}%` }}>
              {segment.value >= 0.14 ? <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-black/75">{Math.round(segment.value * 100)}%</span> : null}
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/75">
          {segments.map((segment) => (
            <span key={`${segment.label}-legend`} className="inline-flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${segment.color}`} />
              {segment.label}: {formatPctFromFraction(segment.value)}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div>
              <h4 className="text-sm font-semibold text-white">Listagem das Principais Exposições em Risco</h4>
              <p className="text-xs text-white/65">{topListSubtitle}</p>
            </div>
            <button
              type="button"
              onClick={() => setShowTopClients((current) => !current)}
              className="rounded-md border border-white/20 px-2.5 py-1 text-xs font-medium text-white/85 transition hover:bg-white/10"
            >
              {showTopClients ? "Ocultar" : "Mostrar"}
            </button>
          </div>
          {showTopClients ? (
            <div className="flex items-center gap-3">
              <p className="text-xs text-white/70">
                Total: <span className="font-semibold text-white">{formatCurrencyInThousands(topRiskTotal)}</span> ({formatPctFromFraction(topRiskShare)})
              </p>
            </div>
          ) : null}
        </div>
        {showTopClients ? <div className="mt-2 space-y-2">
          {(data.top_clients_at_risk ?? []).map((item, index) => {
            const isCritical = item.risk_level === "critical";
            const isAttention = item.risk_level === "attention";
            const isExpanded = expandedIndex === index;
            return (
              <button
                type="button"
                key={`${item.customer_name}-${index}`}
                onClick={() => setExpandedIndex((current) => (current === index ? null : index))}
                className={`w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-left transition hover:bg-white/[0.06] ${
                  isCritical ? "border-l-4 border-l-rose-500" : isAttention ? "border-l-4 border-l-amber-400" : "border-l-4 border-l-[#2b4a72]"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">{item.customer_name}</p>
                    <p className={`text-xs ${isCritical ? "text-rose-300" : isAttention ? "text-amber-300" : "text-white/70"}`}>
                      {isCritical ? "Probable" : isAttention ? "Possible" : "Nível não classificado"}{item.bu ? ` · BU: ${item.bu}` : ""}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold text-white">{formatCurrencyInThousands(item.amount)}</p>
                </div>
                {isExpanded ? (
                  <div className="mt-2 rounded-md border border-white/10 bg-black/20 px-2.5 py-2">
                    <p className="text-[11px] uppercase tracking-[0.06em] text-white/55">Remark</p>
                    <p className="mt-1 text-sm text-white/80">{item.remark?.trim() ? item.remark : "Sem observação para este cliente."}</p>
                  </div>
                ) : null}
              </button>
            );
          })}
          {(data.top_clients_at_risk ?? []).length === 0 ? (
            <p className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/65">
              {isConsolidatedContext
                ? "Nenhuma exposição em risco acima de R$ 500 mil no último snapshot."
                : "Nenhuma exposição em risco disponível no último snapshot para esta BU."}
            </p>
          ) : null}
        </div> : null}
      </div>
    </section>
  );
}

