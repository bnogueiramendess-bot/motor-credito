import { CreditPolicyDto, CreditPolicyRuleDto, ScoreBandDto } from "@/features/credit-rules/api/credit-policy.contracts";

export type CreditRuleScoreFilter = ScoreBandDto | "TODOS";
export type CreditRulePillarFilter = "externalRisk" | "legal" | "internalHistory" | "financialCapacity";

export type CreditPolicyRuleViewModel = {
  id: number;
  score: CreditRuleScoreFilter;
  pillar: CreditRulePillarFilter;
  title: string;
  description: string;
  status: "active" | "inactive";
  valueText: string;
  orderIndex: number;
  source: CreditPolicyRuleDto;
};

export type CreditPolicyOverviewViewModel = {
  scoreRangeSummary: string;
  bandSummaries: Array<{ score: ScoreBandDto; label: string }>;
  adjustmentSummaries: string[];
  debtRatioSummaries: string[];
  decisionSummaries: string[];
};

export type CreditPolicyHeaderViewModel = {
  id: number;
  status: string;
  name: string;
  version: string;
  source: string;
  type: string;
  note: string;
  publishedAtLabel: string;
};

export type CreditPolicyDiffSummaryViewModel = {
  created: number;
  updated: number;
  removed: number;
  total: number;
};

export type CreditPolicyViewModel = {
  metadata: CreditPolicyHeaderViewModel;
  scoreFilterOptions: Array<{ value: CreditRuleScoreFilter; label: string }>;
  pillarFilterOptions: Array<{ value: CreditRulePillarFilter; label: string }>;
  rules: CreditPolicyRuleViewModel[];
  overview: CreditPolicyOverviewViewModel;
  diffSummary: CreditPolicyDiffSummaryViewModel;
};

const scoreLabels: Record<CreditRuleScoreFilter, string> = {
  A: "Score A",
  B: "Score B",
  C: "Score C",
  D: "Score D",
  TODOS: "Todos os scores"
};

const pillarLabels: Record<CreditRulePillarFilter, string> = {
  externalRisk: "Risco externo",
  legal: "Jurídico",
  internalHistory: "Histórico interno",
  financialCapacity: "Capacidade financeira"
};

const operatorLabels: Record<string, string> = {
  eq: "igual a",
  gte: "maior ou igual a",
  lte: "menor ou igual a",
  gt: "maior que",
  lt: "menor que",
  per_item: "por ocorrência",
  multiplier: "multiplicador",
  required: "obrigatório"
};

function toNumber(value: number | string) {
  return typeof value === "number" ? value : Number(value);
}

function formatDate(value: string | null) {
  if (!value) {
    return "Não publicada";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return "Não publicada";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(parsed);
}

function formatBandRange(minScore: number | null, maxScore: number | null) {
  if (minScore !== null && maxScore !== null) {
    return `de ${minScore} até ${maxScore}`;
  }

  if (minScore !== null) {
    return `${minScore} ou mais`;
  }

  if (maxScore !== null) {
    return `até ${maxScore}`;
  }

  return "faixa não definida";
}

function formatPercentage(value: number | string) {
  const numeric = toNumber(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  return `${(numeric * 100).toFixed(0)}%`;
}

function formatRuleValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  if (typeof value === "boolean") {
    return value ? "Sim" : "Não";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(".", ",");
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

function formatRuleDescription(rule: CreditPolicyRuleDto) {
  const operatorLabel = operatorLabels[rule.operator] ?? rule.operator;
  const formattedValue = formatRuleValue(rule.value);
  const pointsText = rule.points !== null ? ` | Pontos: ${rule.points > 0 ? `+${rule.points}` : rule.points}` : "";
  const scoreText = rule.score_band ? `Score ${rule.score_band}` : "Todos os scores";

  return `${scoreText} | ${operatorLabel} ${formattedValue}${pointsText}`;
}

function normalizePillar(value: string): CreditRulePillarFilter {
  if (value === "externalRisk" || value === "legal" || value === "internalHistory" || value === "financialCapacity") {
    return value;
  }
  return "externalRisk";
}

function mapRule(rule: CreditPolicyRuleDto): CreditPolicyRuleViewModel {
  return {
    id: rule.id,
    score: rule.score_band ?? "TODOS",
    pillar: normalizePillar(rule.pillar),
    title: rule.label,
    description: rule.description || formatRuleDescription(rule),
    status: rule.is_active ? "active" : "inactive",
    valueText: formatRuleValue(rule.value),
    orderIndex: rule.order_index,
    source: rule
  };
}

function buildOverview(policy: CreditPolicyDto): CreditPolicyOverviewViewModel {
  const debtRatioSummaries = policy.score_adjustments.debt_ratio_points.map((item) => {
    return `Acima de ${(toNumber(item.threshold) * 100).toFixed(0)}%: ${item.points} pontos.`;
  });

  return {
    scoreRangeSummary: `Score base ${policy.score_base}, com faixa final entre ${policy.score_min} e ${policy.score_max} pontos.`,
    bandSummaries: (["A", "B", "C", "D"] as const).map((score) => ({
      score,
      label: `${scoreLabels[score]}: ${formatBandRange(policy.score_bands[score].min_score, policy.score_bands[score].max_score)}`
    })),
    adjustmentSummaries: [
      `Restrições relevantes: ${policy.score_adjustments.restrictions_points} pontos.`,
      `Protestos: ${policy.score_adjustments.protests_points_per_item} pontos por ocorrência.`,
      `Ações judiciais: ${policy.score_adjustments.lawsuits_points_per_item} pontos por ocorrência.`,
      `Cheques sem fundo: ${policy.score_adjustments.bounced_checks_points_per_item} pontos por ocorrência.`
    ],
    debtRatioSummaries,
    decisionSummaries: [
      `Aprovação automática exige endividamento até ${formatPercentage(policy.decision.max_indebtedness_for_auto_approval)}.`,
      ...(["A", "B", "C", "D"] as const).map(
        (score) => `${scoreLabels[score]}: limite até ${formatPercentage(policy.decision.band_limit_caps[score] ?? 0)} da receita.`
      )
    ]
  };
}

function resolveDiffSummary(policy: CreditPolicyDto): CreditPolicyDiffSummaryViewModel {
  const created = policy.diff_summary?.created_rules ?? 0;
  const updated = policy.diff_summary?.updated_rules ?? 0;
  const removed = policy.diff_summary?.removed_rules ?? 0;
  return {
    created,
    updated,
    removed,
    total: created + updated + removed
  };
}

export function getCreditRuleScoreLabel(score: CreditRuleScoreFilter) {
  return scoreLabels[score];
}

export function getCreditRulePillarLabel(pillar: CreditRulePillarFilter) {
  return pillarLabels[pillar];
}

export function mapCreditPolicyToViewModel(policy: CreditPolicyDto): CreditPolicyViewModel {
  return {
    metadata: {
      id: policy.policy_id,
      status: policy.policy_status,
      name: policy.policy_name,
      version: policy.policy_version,
      source: policy.policy_source,
      type: policy.policy_type,
      note: policy.note,
      publishedAtLabel: formatDate(policy.published_at)
    },
    scoreFilterOptions: [
      { value: "TODOS", label: scoreLabels.TODOS },
      { value: "A", label: scoreLabels.A },
      { value: "B", label: scoreLabels.B },
      { value: "C", label: scoreLabels.C },
      { value: "D", label: scoreLabels.D }
    ],
    pillarFilterOptions: [
      { value: "externalRisk", label: pillarLabels.externalRisk },
      { value: "legal", label: pillarLabels.legal },
      { value: "internalHistory", label: pillarLabels.internalHistory },
      { value: "financialCapacity", label: pillarLabels.financialCapacity }
    ],
    rules: [...policy.rules].sort((a, b) => a.order_index - b.order_index || a.id - b.id).map(mapRule),
    overview: buildOverview(policy),
    diffSummary: resolveDiffSummary(policy)
  };
}
