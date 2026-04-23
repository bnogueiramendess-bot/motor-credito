type RatingCardProps = {
  letter: string;
  score: string;
  rangeLabel: string;
  riskLabel: string;
  scorePill: string;
  dateLabel: string;
};

export function RatingCard({ letter, score, rangeLabel, riskLabel, scorePill, dateLabel }: RatingCardProps) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-[#D7E1EC] bg-white p-4 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-[2px]">
      <div className="relative h-[70px] w-[70px] shrink-0">
        <svg viewBox="0 0 100 100" className="h-[70px] w-[70px]">
          <circle cx="50" cy="50" r="42" fill="none" stroke="#EEF3F8" strokeWidth="8" />
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke="#E8B83A"
            strokeWidth="8"
            strokeDasharray="176 88"
            strokeDashoffset="66"
            strokeLinecap="round"
            transform="rotate(-90 50 50)"
          />
        </svg>
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[54%] text-[28px] font-bold leading-none text-[#D4870A]">
          {letter}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-2xl font-bold leading-none text-foreground">{score.replace(" pts", "")}</span>
        <span className="mt-1 text-sm text-muted-foreground">
          {rangeLabel} · {riskLabel}
        </span>
        <span className="mt-0.5 text-xs text-muted-foreground">{scorePill}</span>
        <span className="mt-1 text-[10px] text-[#9CA3AF]">{dateLabel}</span>
      </div>
    </div>
  );
}
