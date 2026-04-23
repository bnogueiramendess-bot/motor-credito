import { cn } from "@/shared/lib/utils";

type RatingLevel = "A" | "B" | "C" | "D";

type RatingHeroProps = {
  rating: RatingLevel;
  score: number;
  label: string;
};

const ratingStyles: Record<RatingLevel, { shell: string; score: string; chip: string }> = {
  A: {
    shell: "border-emerald-200 bg-emerald-50/80",
    score: "text-emerald-700",
    chip: "bg-emerald-100 text-emerald-700"
  },
  B: {
    shell: "border-sky-200 bg-sky-50/80",
    score: "text-sky-700",
    chip: "bg-sky-100 text-sky-700"
  },
  C: {
    shell: "border-amber-200 bg-amber-50/80",
    score: "text-amber-700",
    chip: "bg-amber-100 text-amber-700"
  },
  D: {
    shell: "border-rose-200 bg-rose-50/80",
    score: "text-rose-700",
    chip: "bg-rose-100 text-rose-700"
  }
};

export function RatingHero({ rating, score, label }: RatingHeroProps) {
  const style = ratingStyles[rating];

  return (
    <article className={cn("rounded-xl border p-6 text-center shadow-sm transition-all hover:-translate-y-0.5", style.shell)}>
      <p className={cn("text-6xl font-bold leading-none", style.score)}>{rating}</p>
      <p className="mt-3 text-3xl font-semibold text-foreground">{score}</p>
      <p className={cn("mx-auto mt-3 inline-flex rounded-full px-3 py-1 text-xs font-semibold", style.chip)}>{label}</p>
    </article>
  );
}

