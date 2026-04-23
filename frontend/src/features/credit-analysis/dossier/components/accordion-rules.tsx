"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/shared/lib/utils";

type RuleItem = {
  name: string;
  condition: string;
  result: "ok" | "warn" | "fail";
  label: string;
};

type AccordionRulesProps = {
  rules: RuleItem[];
};

export function AccordionRules({ rules }: AccordionRulesProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mb-6 overflow-hidden rounded-[14px] border border-[#D7E1EC] bg-white shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-[2px]">
      <button type="button" className="flex w-full items-center justify-between px-5 py-4 text-left" onClick={() => setOpen((prev) => !prev)}>
        <div className="flex items-center gap-2 text-[13px] font-medium text-[#102033]">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="1" y="3" width="14" height="10" rx="2" stroke="#295B9A" strokeWidth="1.3" />
            <path d="M5 7h6M5 9.5h4" stroke="#295B9A" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          Ver regras completas e explicabilidade do modelo
          <span className="rounded bg-[#EEF3F8] px-2 py-0.5 text-[10px] font-medium text-[#4F647A]">14 regras</span>
          <span className="rounded bg-[#FEF3F3] px-2 py-0.5 text-[10px] font-medium text-[#991B1B]">2 falhas</span>
        </div>
        <ChevronRight className={cn("h-4 w-4 text-[#4F647A] transition-transform duration-200", open && "rotate-90")} />
      </button>

      <div
        className={cn(
          "overflow-hidden px-5 transition-all duration-200",
          open ? "max-h-[600px] pb-4 opacity-100" : "max-h-0 pb-0 opacity-0"
        )}
      >
        <div className="border-t border-[#EEF3F8] pt-3">
          <div className="grid grid-cols-[1fr_120px_100px] items-center gap-2 border-b border-[#D7E1EC] py-[7px] text-[10px] font-medium text-[#4F647A]">
            <div>Regra</div>
            <div>Condição</div>
            <div className="text-right">Resultado</div>
          </div>

          {rules.map((rule) => (
            <div key={`${rule.name}-${rule.condition}`} className="grid grid-cols-[1fr_120px_100px] items-center gap-2 border-b border-[#F0F4F8] py-[7px] text-[11px] last:border-b-0">
              <div className="text-[#102033]">{rule.name}</div>
              <div className="font-mono text-[10px] text-[#4F647A]">{rule.condition}</div>
              <div className={cn("text-right font-medium", rule.result === "ok" && "text-[#1A7A3A]", rule.result === "warn" && "text-[#D4870A]", rule.result === "fail" && "text-[#C0392B]")}>
                {rule.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
