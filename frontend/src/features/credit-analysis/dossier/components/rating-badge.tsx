import { cn } from "@/shared/lib/utils";

type RatingLevel = "A" | "B" | "C" | "D";

type RatingBadgeProps = {
  rating: RatingLevel;
  riskLabel: string;
  scorePercent: number;
};

const ratingStyles: Record<RatingLevel, { shell: string; score: string }> = {
  A: {
    shell: "border-emerald-200 bg-emerald-50",
    score: "text-emerald-600"
  },
  B: {
    shell: "border-sky-200 bg-sky-50",
    score: "text-sky-600"
  },
  C: {
    shell: "border-amber-200 bg-amber-50",
    score: "text-amber-600"
  },
  D: {
    shell: "border-rose-200 bg-rose-50",
    score: "text-rose-600"
  }
};

export function RatingBadge({ rating, riskLabel, scorePercent }: RatingBadgeProps) {
  const style = ratingStyles[rating];

  return (
    <div className={cn("min-w-[120px] rounded-xl border p-4 text-center shadow-sm transition-all hover:-translate-y-0.5", style.shell)}>
      <p className={cn("text-5xl font-bold leading-none", style.score)}>{rating}</p>
      <p className="mt-2 text-sm font-semibold text-foreground">{riskLabel}</p>
      <p className="mt-1 text-xs text-muted-foreground">Score {scorePercent}%</p>
    </div>
  );
}

