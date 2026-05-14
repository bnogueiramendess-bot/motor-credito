type WorkflowBadgesProps = {
  status: string;
  isEarlyReview: boolean;
  analysisType: string;
  hasRecent: boolean;
};

const statusMap: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pendente", cls: "bg-[#EFF6FF] text-[#1D4ED8]" },
  in_progress: { label: "Em andamento", cls: "bg-[#EEF3F8] text-[#295B9A]" },
  in_approval: { label: "Em aprova??o", cls: "bg-[#FEF3C7] text-[#92400E]" },
  approved: { label: "Aprovado", cls: "bg-[#E6F4ED] text-[#166534]" },
  rejected: { label: "Recusado", cls: "bg-[#FEF2F2] text-[#B91C1C]" }
};

export function WorkflowBadges({ status, isEarlyReview, analysisType, hasRecent }: WorkflowBadgesProps) {
  const statusInfo = statusMap[status] ?? { label: status, cls: "bg-[#F3F4F6] text-[#4B5563]" };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusInfo.cls}`}>{statusInfo.label}</span>
      {isEarlyReview ? <span className="rounded-full bg-[#FFF7E8] px-2 py-0.5 text-[10px] font-semibold text-[#92400E]">Revis?o antecipada</span> : null}
      {analysisType === "novo_cliente" ? <span className="rounded-full bg-[#EEF2FF] px-2 py-0.5 text-[10px] font-semibold text-[#4338CA]">Novo cliente</span> : <span className="rounded-full bg-[#E6F4ED] px-2 py-0.5 text-[10px] font-semibold text-[#166534]">Cliente da carteira</span>}
      {hasRecent ? <span className="rounded-full bg-[#FEF3C7] px-2 py-0.5 text-[10px] font-semibold text-[#92400E]">Possui an?lise recente</span> : null}
    </div>
  );
}
