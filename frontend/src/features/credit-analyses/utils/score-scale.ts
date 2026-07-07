function toNumeric(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export type ExecutiveScorePayload = {
  executive_score_10?: number | string | null;
  executive_score?: number | string | null;
  final_score?: number | string | null;
};

export function resolveExecutiveScore10(score: ExecutiveScorePayload | null | undefined): number | null {
  if (!score) return null;
  const explicit = toNumeric(score.executive_score_10);
  if (explicit !== null) return Math.max(0, Math.min(10, explicit));

  const technical = toNumeric(score.final_score);
  if (technical !== null) return Math.max(0, Math.min(10, Math.round((technical / 100) * 10) / 10));

  const legacyExecutive = toNumeric(score.executive_score);
  if (legacyExecutive !== null) return Math.max(0, Math.min(10, Math.round((legacyExecutive / 10) * 10) / 10));

  return null;
}

export function formatExecutiveScore10(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return `${Math.max(0, Math.min(10, value)).toFixed(1)}/10`;
}

export function executiveScore10ToPercent(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value * 10));
}

