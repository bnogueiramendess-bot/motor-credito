"use client";

import { ReactNode } from "react";

type OperationalContextBarProps = {
  children: ReactNode;
  className?: string;
};

export function OperationalContextBar({ children, className }: OperationalContextBarProps) {
  return (
    <div className={`rounded-xl border border-[#e2e8f0] bg-white px-3 py-2 ${className ?? ""}`}>
      <div className="flex flex-wrap items-center gap-2 md:gap-3">{children}</div>
    </div>
  );
}
