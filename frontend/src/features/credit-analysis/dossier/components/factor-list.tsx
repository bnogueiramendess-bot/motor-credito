import { ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

type FactorItem = {
  text: string;
  points: string;
  tone?: "positive" | "negative" | "warning";
};

type FactorListProps = {
  title: string;
  titleTone: "neutral" | "positive" | "negative";
  titleIcon: ReactNode;
  items: FactorItem[];
  isInsights?: boolean;
};

export function FactorList({ title, titleTone, titleIcon, items, isInsights = false }: FactorListProps) {
  return (
    <div className="rounded-[14px] border border-[#D7E1EC] bg-white p-5 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-[2px]">
      <div
        className={cn(
          "mb-3.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.6px]",
          titleTone === "neutral" && "text-[#4F647A]",
          titleTone === "positive" && "text-[#1A7A3A]",
          titleTone === "negative" && "text-[#C0392B]"
        )}
      >
        {titleIcon}
        {title}
      </div>

      <div className="flex flex-col gap-2">
        {items.map((item) => {
          if (isInsights) {
            return (
              <div key={`${item.text}-${item.points}`} className="flex items-center gap-2.5 rounded-lg border border-[#EEF3F8] bg-[#F7F9FC] px-3 py-[9px]">
                <div
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    item.tone === "negative" && "bg-[#C0392B]",
                    item.tone === "warning" && "bg-[#E8B83A]",
                    (!item.tone || item.tone === "positive") && "bg-[#295B9A]"
                  )}
                />
                <div className="text-xs text-[#102033]">{item.text}</div>
                <div className="ml-auto text-[11px] font-medium text-[#4F647A]">{item.points}</div>
              </div>
            );
          }

          const isPositive = item.tone === "positive";
          const isNegative = item.tone === "negative";
          const isWarning = item.tone === "warning";

          return (
            <div
              key={`${item.text}-${item.points}`}
              className={cn(
                "flex items-start gap-2.5 rounded-lg border px-3 py-2.5",
                isPositive && "border-[#A7DDB8] bg-[#F0FBF5]",
                isNegative && "border-[#F5BFBF] bg-[#FEF3F3]",
                isWarning && "border-[#F5D06A] bg-[#FEF9EC]"
              )}
            >
              <div
                className={cn(
                  "mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full",
                  isPositive && "bg-[#2ECC71]",
                  isNegative && "bg-[#E74C3C]",
                  isWarning && "bg-[#D4870A]"
                )}
              >
                {isPositive ? (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                    <path d="M2 5l2.5 2.5L8 2.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                ) : isNegative ? (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                    <path d="M3 3l4 4M7 3l-4 4" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="white" aria-hidden="true">
                    <path d="M5 1.5L9.5 8.5H.5L5 1.5z" />
                  </svg>
                )}
              </div>

              <div className={cn("flex-1 text-xs", isWarning ? "text-[#92400E]" : "text-[#102033]")}>{item.text}</div>
              <div
                className={cn(
                  "ml-auto whitespace-nowrap text-[11px] font-medium",
                  isPositive && "text-[#1A7A3A]",
                  isNegative && "text-[#C0392B]",
                  isWarning && "text-[#92400E]"
                )}
              >
                {item.points}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
