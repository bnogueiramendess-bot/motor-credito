type Source = Record<string, unknown> | null;

export type ExecutiveAgingBucketKey = "not_due_0_30" | "31_60" | "61_90" | "91_180" | "180_plus";

export type ExecutiveAgingSegment = {
  key: ExecutiveAgingBucketKey;
  label: string;
  amount: number;
  percent: number;
};

type ResolveExecutiveAgingInput = {
  sources: Source[];
  openAmount: number | null;
  notDueAmount: number | null;
  overdueAmount: number | null;
  hasOpenBase: boolean;
  hasConsistentComposition: boolean;
};

const BUCKET_META: Array<{ key: ExecutiveAgingBucketKey; label: string; aliases: string[] }> = [
  { key: "not_due_0_30", label: "Not Due", aliases: ["not due", "0-30", "1-30", "not_due_0_30", "not_due"] },
  { key: "31_60", label: "31–60", aliases: ["31-60", "31_60"] },
  { key: "61_90", label: "61–90", aliases: ["61-90", "61_90"] },
  { key: "91_180", label: "91–180", aliases: ["91-180", "91_180", "91-120", "121-180"] },
  { key: "180_plus", label: "180+", aliases: ["180+", "above 180", "over 180", "180_plus"] },
];

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeBucketKey(raw: string): ExecutiveAgingBucketKey | null {
  const key = raw.trim().toLowerCase();
  for (const bucket of BUCKET_META) {
    if (bucket.aliases.some((alias) => key.includes(alias))) return bucket.key;
  }
  return null;
}

function extractCanonicalBucketsFromSources(sources: Source[]): Record<ExecutiveAgingBucketKey, number> | null {
  for (const source of sources) {
    if (!source) continue;
    const rawAgingBuckets = source.aging_buckets;
    if (!rawAgingBuckets || typeof rawAgingBuckets !== "object") continue;

    const resolved: Record<ExecutiveAgingBucketKey, number> = {
      not_due_0_30: 0,
      "31_60": 0,
      "61_90": 0,
      "91_180": 0,
      "180_plus": 0,
    };

    for (const sectionName of ["not_due", "overdue"]) {
      const section = (rawAgingBuckets as Record<string, unknown>)[sectionName];
      if (!Array.isArray(section)) continue;
      for (const entry of section) {
        if (!entry || typeof entry !== "object") continue;
        const bucketRaw = (entry as Record<string, unknown>).bucket;
        const amountRaw = (entry as Record<string, unknown>).amount;
        if (typeof bucketRaw !== "string") continue;
        const key = normalizeBucketKey(bucketRaw);
        const amount = toNumber(amountRaw);
        if (!key || amount === null) continue;
        resolved[key] += Math.max(amount, 0);
      }
    }

    const total = Object.values(resolved).reduce((acc, value) => acc + value, 0);
    if (total > 0) return resolved;
  }
  return null;
}

function toPercent(amount: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((amount / total) * 100)));
}

export function resolveExecutiveAgingComposition(input: ResolveExecutiveAgingInput): {
  segments: ExecutiveAgingSegment[];
  summary: string;
  message: string;
} {
  const canonical = extractCanonicalBucketsFromSources(input.sources);
  const fallbackNotDue = Math.max(input.notDueAmount ?? 0, 0);
  const fallbackOverdue = Math.max(input.overdueAmount ?? 0, 0);
  const byBucket = canonical ?? {
    not_due_0_30: fallbackNotDue,
    "31_60": fallbackOverdue,
    "61_90": 0,
    "91_180": 0,
    "180_plus": 0,
  };

  const baseTotal = input.hasOpenBase && input.openAmount !== null ? Math.max(input.openAmount, 0) : 0;
  const bucketTotal = Object.values(byBucket).reduce((acc, value) => acc + value, 0);
  const total = baseTotal > 0 ? baseTotal : bucketTotal;

  const segments = BUCKET_META.map((meta) => ({
    key: meta.key,
    label: meta.label,
    amount: byBucket[meta.key] ?? 0,
    percent: toPercent(byBucket[meta.key] ?? 0, total),
  })).filter((segment) => segment.percent > 0);

  const summary = segments.map((segment) => `${segment.label} ${segment.percent}%`).join(" · ");
  const overduePercent = segments
    .filter((segment) => segment.key !== "not_due_0_30")
    .reduce((acc, segment) => acc + segment.percent, 0);
  const severeOverduePercent = segments
    .filter((segment) => segment.key === "91_180" || segment.key === "180_plus")
    .reduce((acc, segment) => acc + segment.percent, 0);
  const majorOverdue = segments
    .filter((segment) => segment.key !== "not_due_0_30")
    .sort((a, b) => b.percent - a.percent)[0];

  const message =
    overduePercent <= 0
      ? "Carteira saudável, sem overdue interno relevante."
      : severeOverduePercent >= 15
        ? "Carteira com deterioração relevante acima de 90 dias."
        : majorOverdue && majorOverdue.key === "31_60"
          ? "Overdue moderado concentrado em 31–60 dias."
          : "Overdue interno presente com distribuição entre buckets.";

  if (!input.hasConsistentComposition && !canonical) {
    return {
      segments: [],
      summary: "",
      message: "Composição do aging indisponível para leitura executiva.",
    };
  }

  return {
    segments,
    summary,
    message,
  };
}
