import { Info } from "lucide-react";

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
  hasValidCofaceCoverage: boolean;
  guaranteeCoverageHelperText: string;
  paymentPillarHelperText: string;
  relationshipPillarHelperText: string;
  unavailableReason?: string | null;
};

type ScoreGaugeBand = "Crítico" | "Atenção" | "Moderado" | "Favorável";
type InstitutionalScoreBand = "AA" | "A" | "B" | "C" | "D" | "Informações insuficientes";

type ScoreBandVisualTokens = {
  badgeClass: string;
  accent: string;
};

function scoreGaugeBandFrom100(score: number) {
  if (score < 40) return "Crítico";
  if (score < 60) return "Atenção";
  if (score < 80) return "Moderado";
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

function InstitutionalScoreGauge({ score }: { score: number | null }) {
  const safeScore100 = score === null ? 0 : Math.max(0, Math.min(100, score));
  const displayScore = score === null ? "—" : `${Math.round(safeScore100)}`;
  const band = scoreGaugeBandFrom100(safeScore100);
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
        <text x="176" y="120" textAnchor="end" className="fill-[#94a3b8] text-[10px] font-semibold">100</text>
      </svg>
      <div className="mt-[-8px] text-center">
        <p className="text-[34px] font-black leading-none text-[#102a4c]">{displayScore}</p>
        <p className="mt-1 text-[11px] font-semibold text-[#64748b]">/100</p>
      </div>
      <div className="mt-1 flex items-center justify-center gap-2">
        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${scoreGaugeBandClass(band)}`}>{band}</span>
      </div>
      <p className="mt-1 text-center text-[11px] font-semibold text-[#64748b]">Score preliminar</p>
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
}: InstitutionalScoreCardProps) {
  return (
    <article className="rounded-[24px] border border-[#D7E1EC] bg-white p-5 shadow-[0_10px_32px_rgba(15,23,42,0.06)]">
      <p className="text-[18px] font-semibold text-[#0f172a]">Score institucional preliminar</p>
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
