import { CreditAnalysisOperationalQueueResponse } from "@/features/credit-analyses/api/contracts";

type OperationalKpisProps = {
  data: CreditAnalysisOperationalQueueResponse;
};

export function OperationalKpis({ data }: OperationalKpisProps) {
  const kpi = data.kpis;
  const cards = [
    ["Solicitações aguardando análise", kpi.awaiting_analysis],
    ["Revisões antecipadas", kpi.early_reviews],
    ["Clientes novos", kpi.new_customers],
    ["Aguardando documentos/relatórios", kpi.awaiting_reports],
    ["Aguardando aprovação", kpi.pending_approval],
    ["Total em análise", kpi.total_in_analysis]
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      {cards.map(([label, value]) => (
        <article key={label} className="rounded-[12px] border border-[#D7E1EC] bg-white px-4 py-3">
          <p className="text-[10px] uppercase tracking-[0.04em] text-[#8FA3B4]">{label}</p>
          <p className="mt-1 text-[22px] font-semibold text-[#102033]">{value}</p>
        </article>
      ))}
    </div>
  );
}
