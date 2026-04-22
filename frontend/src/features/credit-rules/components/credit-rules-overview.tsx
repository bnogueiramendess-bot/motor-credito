import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { CreditPolicyOverviewViewModel } from "@/features/credit-rules/utils/credit-policy-view-model";
import { Badge } from "@/shared/components/ui/badge";
import { cn } from "@/shared/lib/utils";

type CreditRulesOverviewProps = {
  overview: CreditPolicyOverviewViewModel;
};

export function CreditRulesOverview({ overview }: CreditRulesOverviewProps) {
  const [showOverview, setShowOverview] = useState(false);

  return (
    <section className="rounded-2xl border border-[#e5e9f2] bg-white p-4 shadow-sm">
      <button
        type="button"
        onClick={() => setShowOverview((previous) => !previous)}
        className="flex w-full items-center justify-between rounded-xl border border-[#dce3ef] bg-[#f8faff] px-4 py-3 text-left transition hover:bg-[#f1f6ff]"
      >
        <div>
          <p className="text-sm font-semibold text-[#1f2937]">Resumo da política ativa</p>
          <p className="text-sm text-[#4b5563]">Referência da configuração atualmente usada pelo motor de crédito.</p>
        </div>
        <ChevronDown className={cn("h-4 w-4 text-[#4b5563] transition-transform", showOverview ? "rotate-180" : "rotate-0")} />
      </button>

      {showOverview ? (
        <div className="mt-4 space-y-4 rounded-xl border border-[#e5e9f2] bg-[#fcfdff] p-4">
          <article className="rounded-lg border border-[#e5e9f2] bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.04em] text-[#6b7280]">Escala de score</p>
            <p className="mt-1 text-sm text-[#334155]">{overview.scoreRangeSummary}</p>
          </article>

          <div className="flex flex-wrap gap-2">
            {overview.bandSummaries.map((item) => (
              <Badge key={item.score} variant="outline" className="border-[#d4dbe7] bg-white text-[#32456f]">
                {item.label}
              </Badge>
            ))}
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <article className="rounded-lg border border-[#e5e9f2] bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.04em] text-[#6b7280]">Ajustes de score</p>
              <ul className="mt-2 space-y-1">
                {overview.adjustmentSummaries.map((item) => (
                  <li key={item} className="text-sm text-[#334155]">
                    - {item}
                  </li>
                ))}
              </ul>
            </article>

            <article className="rounded-lg border border-[#e5e9f2] bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.04em] text-[#6b7280]">Índice de endividamento</p>
              <ul className="mt-2 space-y-1">
                {overview.debtRatioSummaries.map((item) => (
                  <li key={item} className="text-sm text-[#334155]">
                    - {item}
                  </li>
                ))}
              </ul>
            </article>

            <article className="rounded-lg border border-[#e5e9f2] bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.04em] text-[#6b7280]">Parâmetros de decisão</p>
              <ul className="mt-2 space-y-1">
                {overview.decisionSummaries.map((item) => (
                  <li key={item} className="text-sm text-[#334155]">
                    - {item}
                  </li>
                ))}
              </ul>
            </article>
          </div>
        </div>
      ) : null}
    </section>
  );
}
