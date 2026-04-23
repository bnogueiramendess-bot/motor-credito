import { CheckCircle2, AlertTriangle } from "lucide-react";

import { cn } from "@/shared/lib/utils";

type RiskFactorItemProps = {
  title: string;
  impactPercent: number;
  type: "positive" | "negative";
};

export function RiskFactorItem({ title, impactPercent, type }: RiskFactorItemProps) {
  const positive = type === "positive";

  return (
    <article
      className={cn(
        "rounded-xl border p-4 shadow-sm transition-all hover:-translate-y-0.5",
        positive ? "border-emerald-200 bg-emerald-50/70" : "border-rose-200 bg-rose-50/70"
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {positive ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-rose-600" />
          )}
          <p className="text-sm font-medium text-foreground">{title}</p>
        </div>
        <p className={cn("text-sm font-semibold", positive ? "text-emerald-700" : "text-rose-700")}>
          {positive ? "+" : ""}
          {impactPercent}%
        </p>
      </div>
    </article>
  );
}

