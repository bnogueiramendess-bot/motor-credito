import { Search } from "lucide-react";

import { CreditRulePillarFilter, CreditRuleScoreFilter } from "@/features/credit-rules/utils/credit-policy-view-model";

type ScoreFilter = CreditRuleScoreFilter | "all";
type PillarFilter = CreditRulePillarFilter | "all";

type CreditRulesFiltersProps = {
  scoreFilter: ScoreFilter;
  pillarFilter: PillarFilter;
  search: string;
  scoreOptions: Array<{ value: CreditRuleScoreFilter; label: string }>;
  pillarOptions: Array<{ value: CreditRulePillarFilter; label: string }>;
  onScoreFilterChange: (value: ScoreFilter) => void;
  onPillarFilterChange: (value: PillarFilter) => void;
  onSearchChange: (value: string) => void;
};

export function CreditRulesFilters({
  scoreFilter,
  pillarFilter,
  search,
  scoreOptions,
  pillarOptions,
  onScoreFilterChange,
  onPillarFilterChange,
  onSearchChange
}: CreditRulesFiltersProps) {
  return (
    <section className="rounded-2xl border border-[#e5e9f2] bg-white p-5 shadow-sm">
      <div className="grid gap-3 lg:grid-cols-3">
        <label className="space-y-1">
          <span className="text-xs font-medium uppercase tracking-[0.04em] text-[#6b7280]">Score</span>
          <select
            value={scoreFilter}
            onChange={(event) => onScoreFilterChange(event.target.value as ScoreFilter)}
            className="h-10 w-full rounded-lg border border-[#d4dbe7] bg-white px-3 text-sm text-[#111827] outline-none transition focus:border-[#1a2b5e]"
          >
            <option value="all">Todos</option>
            {scoreOptions.map((score) => (
              <option key={score.value} value={score.value}>
                {score.label}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-xs font-medium uppercase tracking-[0.04em] text-[#6b7280]">Pilar</span>
          <select
            value={pillarFilter}
            onChange={(event) => onPillarFilterChange(event.target.value as PillarFilter)}
            className="h-10 w-full rounded-lg border border-[#d4dbe7] bg-white px-3 text-sm text-[#111827] outline-none transition focus:border-[#1a2b5e]"
          >
            <option value="all">Todos</option>
            {pillarOptions.map((pillar) => (
              <option key={pillar.value} value={pillar.value}>
                {pillar.label}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-xs font-medium uppercase tracking-[0.04em] text-[#6b7280]">Buscar regra</span>
          <div className="flex h-10 items-center rounded-lg border border-[#d4dbe7] bg-white px-3">
            <Search className="h-4 w-4 text-[#94a3b8]" />
            <input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Descrição, score ou pilar"
              className="ml-2 w-full bg-transparent text-sm text-[#111827] outline-none placeholder:text-[#94a3b8]"
            />
          </div>
        </label>
      </div>
    </section>
  );
}

export type { PillarFilter, ScoreFilter };
