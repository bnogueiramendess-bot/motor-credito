import { Info } from "lucide-react";

import { executiveScore10ToPercent } from "@/features/credit-analyses/utils/score-scale";

type InstitutionalScoreTooltip = {
  title: string;
  description: string;
  source: string;
  note: string;
  weightLabel?: string;
};

type InstitutionalScoreBreakdownItem = {
  key: string;
  title: string;
  score: number | null;
  tooltip: InstitutionalScoreTooltip;
};

type InstitutionalScoreCardProps = {
  score: number | null;
  breakdown: InstitutionalScoreBreakdownItem[];
  scoreCalculation?: Record<string, unknown> | null;
  hasValidCofaceCoverage: boolean;
  guaranteeCoverageHelperText: string;
  paymentPillarHelperText: string;
  relationshipPillarHelperText: string;
  unavailableReason?: string | null;
};

type ScoreGaugeBand = "Crítico" | "Atenção" | "Moderado" | "Favorável";
type InstitutionalScoreBand = "AA" | "A" | "B" | "C" | "D" | "Informações insuficientes";

type ScoreCalculationPillarRow = {
  key: string;
  title: string;
  score: number | null;
  weight: number | null;
  contribution: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toDisplayNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatScoreValue(value: number | null, digits = 1) {
  if (value === null) return "—";
  return value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatPercentValue(value: number | null) {
  if (value === null) return "—";
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

function titleFromCalculationKey(key: string, breakdown: InstitutionalScoreBreakdownItem[]) {
  const direct = breakdown.find((item) => item.key === key);
  if (direct) return direct.title;

  const normalisedKey = key.replace(/_/g, " ").toLowerCase();
  const byTitle = breakdown.find((item) => item.title.toLowerCase() === normalisedKey);
  if (byTitle) return byTitle.title;

  const knownTitles: Record<string, string> = {
    financial_stability_liquidity: "Estabilidade Financeira",
    guarantees_credit_insurance: "Garantias",
    payment_history: "Histórico de Pagamento",
    relationship_history: "Relacionamento",
    market_conditions: "Condições de Mercado",
  };
  return knownTitles[key] ?? key.replace(/_/g, " ");
}

function buildScoreCalculationRows(scoreCalculation: Record<string, unknown> | null | undefined, breakdown: InstitutionalScoreBreakdownItem[]): ScoreCalculationPillarRow[] {
  const calculationRoot = isRecord(scoreCalculation?.calculation) ? scoreCalculation.calculation : null;
  if (!calculationRoot) return [];

  return Object.entries(calculationRoot)
    .filter(([, rawPillar]) => {
      if (!isRecord(rawPillar)) return false;
      const status = typeof rawPillar.status === "string" ? rawPillar.status.toLowerCase() : "";
      const effective = rawPillar.effective;
      return status !== "planned" && effective !== false;
    })
    .map(([key, rawPillar]) => {
      const pillar = rawPillar as Record<string, unknown>;
      return {
        key,
        title: typeof pillar.name === "string" ? pillar.name : titleFromCalculationKey(key, breakdown),
        score: toDisplayNumber(pillar.score),
        weight: toDisplayNumber(pillar.weight),
        contribution: toDisplayNumber(pillar.contribution ?? pillar.weighted_score),
      };
    });
}

type ScoreBandVisualTokens = {
  badgeClass: string;
  accent: string;
};

function scoreGaugeBandFrom10(score: number) {
  if (score < 4) return "Crítico";
  if (score < 6) return "Atenção";
  if (score < 8) return "Moderado";
  return "Favorável";
}

function scoreGaugeBandToInstitutionalBand(band: ScoreGaugeBand): InstitutionalScoreBand {
  if (band === "Crítico") return "D";
  if (band === "Atenção") return "C";
  if (band === "Moderado") return "B";
  return "A";
}

function getScoreBandVisualTokens(scoreBand: InstitutionalScoreBand): ScoreBandVisualTokens {
  if (scoreBand === "A") {
    return {
      badgeClass: "bg-[#EDF6FF] text-[#1D4ED8] border-[#BFDBFE]",
      accent: "#4B8B73",
    };
  }
  if (scoreBand === "B") {
    return {
      badgeClass: "bg-[#EEF2FF] text-[#4338CA] border-[#C7D2FE]",
      accent: "#3B5F9D",
    };
  }
  if (scoreBand === "C") {
    return {
      badgeClass: "bg-[#FFF7E8] text-[#92400E] border-[#FDE68A]",
      accent: "#B9812C",
    };
  }
  if (scoreBand === "D") {
    return {
      badgeClass: "bg-[#FEF2F2] text-[#B91C1C] border-[#FECACA]",
      accent: "#B55252",
    };
  }
  return {
    badgeClass: "bg-[#EEF3F8] text-[#4F647A] border-[#D7E1EC]",
    accent: "#64748B",
  };
}

function scoreGaugeBandClass(band: ScoreGaugeBand) {
  return getScoreBandVisualTokens(scoreGaugeBandToInstitutionalBand(band)).badgeClass;
}

function ScoreInterpretationTooltip({ score, rows }: { score: number | null; rows: ScoreCalculationPillarRow[] }) {
  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[#94a3b8] transition-colors duration-150 hover:text-[#2563eb] focus:outline-none focus:ring-2 focus:ring-[#BFDBFE]"
        aria-label="Como interpretar este Score?"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      <span className="pointer-events-none absolute left-1/2 top-[calc(100%+10px)] z-40 w-[min(560px,calc(100vw-48px))] -translate-x-1/2 rounded-[12px] border border-[#D7E1EC] bg-white p-3.5 text-left opacity-0 shadow-[0_16px_38px_rgba(15,23,42,0.14)] transition-all duration-150 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100">
        <span className="block text-[12px] font-bold text-[#0f172a]">Como interpretar este Score?</span>
        <span className="mt-2 block text-[11px] font-normal leading-5 text-[#475569]">
          O Score Institucional representa uma média ponderada dos pilares avaliados, utilizando os pesos definidos na Política de Score vigente.
        </span>
        <span className="mt-1 block text-[11px] font-normal leading-5 text-[#475569]">
          Cada pilar contribui para o resultado final de acordo com sua importância na política de crédito.
        </span>

        {rows.length > 0 ? (
          <span className="mt-3 block overflow-hidden rounded-[10px] border border-[#E2E8F0]">
            <span className="grid grid-cols-[1.45fr_0.55fr_0.55fr_0.75fr] bg-[#F8FAFC] px-2.5 py-2 text-[10px] font-bold uppercase tracking-[0.03em] text-[#64748b]">
              <span>Pilar</span>
              <span className="text-right">Nota</span>
              <span className="text-right">Peso</span>
              <span className="text-right">Contribuição</span>
            </span>
            {rows.map((row) => (
              <span key={row.key} className="grid grid-cols-[1.45fr_0.55fr_0.55fr_0.75fr] border-t border-[#E2E8F0] px-2.5 py-2 text-[11px] font-normal text-[#334155]">
                <span className="truncate pr-2 font-semibold text-[#1f2937]">{row.title}</span>
                <span className="text-right tabular-nums">{formatScoreValue(row.score, 1)}</span>
                <span className="text-right tabular-nums">{formatPercentValue(row.weight)}</span>
                <span className="text-right tabular-nums">{formatScoreValue(row.contribution, 2)}</span>
              </span>
            ))}
          </span>
        ) : (
          <span className="mt-3 block rounded-[10px] border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-[11px] font-normal text-[#64748b]">
            Demonstrativo indisponível para este payload.
          </span>
        )}

        <span className="mt-3 flex items-end justify-between gap-4 border-t border-[#E2E8F0] pt-3">
          <span className="text-[11px] font-semibold text-[#334155]">Score Institucional Final</span>
          <span className="text-[18px] font-black leading-none text-[#102a4c]">{formatScoreValue(score, 1)} <span className="text-[12px] font-semibold text-[#64748b]">/10</span></span>
        </span>
        <span className="mt-2 block text-[10px] font-normal leading-4 text-[#64748b]">
          O Score Institucional não é uma média simples dos pilares. Cada pilar possui um peso definido na Política de Score publicada.
        </span>
      </span>
    </span>
  );
}

function InstitutionalScoreGauge({ score }: { score: number | null }) {
  const safeScore10 = score === null ? 0 : Math.max(0, Math.min(10, score));
  const safeScore100 = executiveScore10ToPercent(safeScore10);
  const displayScore = score === null ? "—" : safeScore10.toFixed(1);
  const band = scoreGaugeBandFrom10(safeScore10);
  const bandToken = getScoreBandVisualTokens(scoreGaugeBandToInstitutionalBand(band));
  const cx = 100;
  const cy = 100;
  const radius = 76;
  const arcLength = Math.PI * radius;
  const pointerRadius = 52;
  const pointerAngle = Math.PI - (safeScore100 / 100) * Math.PI;
  const pointerX = cx + pointerRadius * Math.cos(pointerAngle);
  const pointerY = cy - pointerRadius * Math.sin(pointerAngle);
  const bands = [
    { min: 0, max: 39, color: getScoreBandVisualTokens("D").accent },
    { min: 40, max: 59, color: getScoreBandVisualTokens("C").accent },
    { min: 60, max: 79, color: getScoreBandVisualTokens("B").accent },
    { min: 80, max: 100, color: getScoreBandVisualTokens("A").accent },
  ];

  return (
    <div className="mx-auto w-full max-w-[220px]">
      <svg viewBox="0 0 200 138" className="h-[138px] w-full" role="img" aria-label="Velocímetro do score institucional preliminar">
        <path d="M 24 100 A 76 76 0 0 1 176 100" fill="none" stroke="#E2E8F0" strokeWidth="11" strokeLinecap="round" />
        {bands.map((item) => {
          const startFraction = item.min / 100;
          const endFraction = item.max / 100;
          const segmentLength = (endFraction - startFraction) * arcLength;
          return (
            <path
              key={`${item.min}-${item.max}`}
              d="M 24 100 A 76 76 0 0 1 176 100"
              fill="none"
              stroke={item.color}
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={`${segmentLength} ${arcLength}`}
              strokeDashoffset={`${-startFraction * arcLength}`}
            />
          );
        })}
        <line x1={cx} y1={cy} x2={pointerX} y2={pointerY} stroke={bandToken.accent} strokeWidth="2" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="4" fill={bandToken.accent} />
        <circle cx={cx} cy={cy} r="6.5" fill="none" stroke="#dbeafe" strokeWidth="1" />
        <text x="24" y="120" textAnchor="start" className="fill-[#94a3b8] text-[10px] font-semibold">0</text>
        <text x="176" y="120" textAnchor="end" className="fill-[#94a3b8] text-[10px] font-semibold">10</text>
      </svg>
      <div className="mt-[-8px] text-center">
        <p className="text-[34px] font-black leading-none text-[#102a4c]">{displayScore}</p>
        <p className="mt-1 text-[11px] font-semibold text-[#64748b]">/10</p>
      </div>
      <div className="mt-1 flex items-center justify-center gap-2">
        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${scoreGaugeBandClass(band)}`}>{band}</span>
      </div>
      <p className="mt-1 text-center text-[11px] font-semibold text-[#64748b]">Score Institucional</p>
      <p className="mt-0.5 text-center text-[10px] text-[#94a3b8]">Score absoluto ponderado pelos pilares da política.</p>
    </div>
  );
}

export function InstitutionalScoreCard({
  score,
  breakdown,
  hasValidCofaceCoverage,
  guaranteeCoverageHelperText,
  paymentPillarHelperText,
  relationshipPillarHelperText,
  unavailableReason,
  scoreCalculation,
}: InstitutionalScoreCardProps) {
  const scoreCalculationRows = buildScoreCalculationRows(scoreCalculation, breakdown);

  return (
    <article className="rounded-[24px] border border-[#D7E1EC] bg-white p-5 shadow-[0_10px_32px_rgba(15,23,42,0.06)]">
      <p className="flex items-center gap-1.5 text-[18px] font-semibold text-[#0f172a]">
        <span>Score Institucional</span>
        <ScoreInterpretationTooltip score={score} rows={scoreCalculationRows} />
      </p>
      <div className="mt-4 grid gap-4 lg:grid-cols-[220px_1fr]">
        <InstitutionalScoreGauge score={score} />
        <div>
          {breakdown.length === 0 ? (
            <div className="rounded-[14px] border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 text-[12px] leading-5 text-[#64748b]">
              {unavailableReason ?? "Score por pilares indisponivel para esta analise."}
            </div>
          ) : null}
          <div className="space-y-3">
            {breakdown.map((item) => (
              <div key={item.key}>
                <div className="mb-1 flex items-center justify-between text-[12px] font-semibold text-[#334155]">
                  <span className="inline-flex items-center gap-2">
                    <span>{item.title}</span>
                    <span className="group relative inline-flex">
                      <Info className="h-3.5 w-3.5 text-[#94a3b8] transition-colors duration-150 group-hover:text-[#2563eb]" />
                      <span className="pointer-events-none absolute left-1/2 top-[calc(100%+8px)] z-30 w-[300px] -translate-x-1/2 rounded-[10px] border border-[#E2E8F0] bg-white px-3 py-2 text-left text-[11px] font-normal text-[#334155] opacity-0 shadow-[0_8px_20px_rgba(15,23,42,0.08)] transition-all duration-150 group-hover:translate-y-0 group-hover:opacity-100">
                        <span className="block text-[11px] font-semibold text-[#0f172a]">{item.tooltip.title}</span>
                        <span className="mt-1 block leading-4">{item.tooltip.description}</span>
                        <span className="mt-1 block text-[#475569]"><strong>Fonte:</strong> {item.tooltip.source}</span>
                        {item.tooltip.weightLabel ? <span className="mt-1 block font-semibold text-[#64748b]">{item.tooltip.weightLabel}</span> : null}
                        <span className="mt-1 block text-[#64748b]">{item.tooltip.note}</span>
                      </span>
                    </span>
                    {item.key === "financial_liquidity" && hasValidCofaceCoverage ? <span className="inline-flex rounded-full border border-[#BFDBFE] bg-[#EFF6FF] px-2 py-0.5 text-[10px] font-semibold text-[#1D4ED8]">Mitigado por COFACE</span> : null}
                    {item.key === "financial_liquidity" && !hasValidCofaceCoverage && item.score === 0 ? <span className="inline-flex rounded-full border border-[#E2E8F0] bg-[#F8FAFC] px-2 py-0.5 text-[10px] font-semibold text-[#64748b]">Não avaliado</span> : null}
                    {item.key === "market_conditions" && item.score === 0 ? <span className="inline-flex rounded-full border border-[#E2E8F0] bg-[#F8FAFC] px-2 py-0.5 text-[10px] font-semibold text-[#64748b]">Em evolução</span> : null}
                  </span>
                  <span>{item.score !== null ? `${item.score.toFixed(1)}/10` : "Sem nota"}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full border border-[#E2E8F0] bg-[#F1F5F9]">
                  <div className={`h-full rounded-full ${item.key === "financial_liquidity" ? "bg-[#94a3b8]" : "bg-[#2563eb]"}`} style={{ width: `${item.score !== null ? Math.max(0, Math.min(100, item.score * 10)) : 0}%` }} />
                </div>
                {item.key === "financial_liquidity" && !hasValidCofaceCoverage && item.score === 0 ? <p className="mt-1 text-[11px] text-[#64748b]">Impacta o score por ausência de demonstrações financeiras estruturadas.</p> : null}
                {item.key === "guarantees" ? <p className="mt-1 text-[11px] text-[#64748b]">{guaranteeCoverageHelperText}</p> : null}
                {item.key === "market_conditions" && item.score === 0 ? <p className="mt-1 text-[11px] text-[#64748b]">Metodologia de condições de mercado em evolução no modelo atual.</p> : null}
                {item.key === "payment_history" ? <p className="mt-1 text-[11px] text-[#64748b]">{paymentPillarHelperText}</p> : null}
                {item.key === "relationship_history" ? <p className="mt-1 text-[11px] text-[#64748b]">{relationshipPillarHelperText}</p> : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}


