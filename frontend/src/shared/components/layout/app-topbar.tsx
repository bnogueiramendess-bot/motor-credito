import { CalendarClock } from "lucide-react";

import { formatDateTime } from "@/features/credit-analyses/utils/formatters";

export function AppTopbar() {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border/80 bg-white/90 px-4 backdrop-blur md:px-6">
      <div>
        <h1 className="text-base font-semibold text-slate-900 md:text-lg">Analise de credito</h1>
        <p className="text-xs text-muted-foreground md:text-sm">Visao consolidada para acompanhamento e decisao</p>
      </div>
      <div className="hidden items-center gap-2 rounded-lg border border-border/80 bg-slate-50 px-3 py-2 text-xs text-slate-600 md:flex">
        <CalendarClock className="h-4 w-4" />
        <span>Atualizado em {formatDateTime(new Date().toISOString())}</span>
      </div>
    </header>
  );
}
