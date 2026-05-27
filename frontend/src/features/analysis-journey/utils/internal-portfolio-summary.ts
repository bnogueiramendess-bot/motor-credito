type ResolveInternalPortfolioSummaryInput = {
  openAmount: number | null;
  notDueAmount: number | null;
  overdueAmount: number | null;
  currentLimit: number | null;
  availableLimit: number | null;
  residualExposure?: number | null;
};

export type InternalPortfolioSummary = {
  openAmount: number | null;
  notDueAmount: number | null;
  overdueAmount: number | null;
  currentLimit: number | null;
  availableLimit: number | null;
  residualExposure: number | null;
  hasOpenBase: boolean;
  notDuePercent: number | null;
  overduePercent: number | null;
  hasAnyPositionData: boolean;
  hasConsistentComposition: boolean;
};

type InternalPortfolioRawSource = Record<string, unknown> | null;

type ResolveInternalPortfolioSummaryFromSourcesInput = {
  sources: InternalPortfolioRawSource[];
  residualExposure?: number | null;
};

function toNumeric(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function readFirstNumeric(source: InternalPortfolioRawSource, keys: string[]): number | null {
  if (!source) return null;
  for (const key of keys) {
    const parsed = toNumeric(source[key]);
    if (parsed !== null) return parsed;
  }
  return null;
}

function isCompositionConsistent(openAmount: number | null, notDueAmount: number | null, overdueAmount: number | null): boolean {
  if (openAmount === null || notDueAmount === null || overdueAmount === null) return false;
  const delta = Math.abs(openAmount - (notDueAmount + overdueAmount));
  return delta <= 1;
}

export function resolveInternalPortfolioSummary({
  openAmount,
  notDueAmount,
  overdueAmount,
  currentLimit,
  availableLimit,
  residualExposure = null,
}: ResolveInternalPortfolioSummaryInput): InternalPortfolioSummary {
  const hasAnyPositionData =
    openAmount !== null ||
    notDueAmount !== null ||
    overdueAmount !== null ||
    currentLimit !== null ||
    availableLimit !== null;

  const hasOpenBase = openAmount !== null && openAmount > 0;
  const notDuePercent =
    hasOpenBase && notDueAmount !== null
      ? Math.max(0, Math.min(100, Math.round((notDueAmount / openAmount) * 100)))
      : null;
  const overduePercent =
    hasOpenBase && overdueAmount !== null
      ? Math.max(0, Math.min(100, Math.round((overdueAmount / openAmount) * 100)))
      : null;

  return {
    openAmount,
    notDueAmount,
    overdueAmount,
    currentLimit,
    availableLimit,
    residualExposure,
    hasOpenBase,
    notDuePercent,
    overduePercent,
    hasAnyPositionData,
    hasConsistentComposition: isCompositionConsistent(openAmount, notDueAmount, overdueAmount),
  };
}

export function resolveInternalPortfolioSummaryFromSources({
  sources,
  residualExposure = null,
}: ResolveInternalPortfolioSummaryFromSourcesInput): InternalPortfolioSummary {
  let chosenOpen: number | null = null;
  let chosenNotDue: number | null = null;
  let chosenOverdue: number | null = null;
  let fallbackOpenOnly: number | null = null;

  for (const source of sources) {
    const openAmount = readFirstNumeric(source, ["open_amount", "total_open_amount"]);
    const notDueAmount = readFirstNumeric(source, ["not_due_amount"]);
    const overdueAmount = readFirstNumeric(source, ["overdue_amount"]);
    const hasComposition = notDueAmount !== null || overdueAmount !== null;

    if (openAmount !== null && fallbackOpenOnly === null) {
      fallbackOpenOnly = openAmount;
    }

    if (openAmount === null || !hasComposition) continue;

    chosenOpen = openAmount;
    chosenNotDue = notDueAmount;
    chosenOverdue = overdueAmount;

    if (isCompositionConsistent(openAmount, notDueAmount, overdueAmount)) {
      break;
    }
  }

  const openAmount = chosenOpen ?? fallbackOpenOnly;
  const notDueAmount = chosenOpen !== null ? chosenNotDue : null;
  const overdueAmount = chosenOpen !== null ? chosenOverdue : null;

  let currentLimit: number | null = null;
  let availableLimit: number | null = null;
  for (const source of sources) {
    if (currentLimit === null) {
      currentLimit = readFirstNumeric(source, ["total_limit", "credit_limit", "approved_credit_amount"]);
    }
    if (availableLimit === null) {
      availableLimit = readFirstNumeric(source, ["available_limit", "limit_available"]);
    }
  }

  return resolveInternalPortfolioSummary({
    openAmount,
    notDueAmount,
    overdueAmount,
    currentLimit,
    availableLimit,
    residualExposure,
  });
}
