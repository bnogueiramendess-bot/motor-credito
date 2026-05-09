type WorkflowBadgesProps = {
  status: string;
  isEarlyReview: boolean;
  analysisType: string;
  hasRecent: boolean;
};

const statusMap: Record<string, { label: string; cls: string }> = {
  submitted: { label: "Submetida", cls: "bg-[#EFF6FF] text-[#1D4ED8]" },
  under_financial_review: { label: "Em análise financeira", cls: "bg-[#EEF3F8] text-[#295B9A]" },
  pending_external_reports: { label: "Aguardando relatórios", cls: "bg-[#FFF7E8] text-[#92400E]" },
  ready_for_credit_engine: { label: "Pronta para motor", cls: "bg-[#F0FDF4] text-[#166534]" },
  dossier_generated: { label: "Dossiê gerado", cls: "bg-[#EEF2FF] text-[#3730A3]" },
  pending_approval: { label: "Aguardando aprovação", cls: "bg-[#FEF3C7] text-[#92400E]" },
  approved: { label: "Aprovada", cls: "bg-[#E6F4ED] text-[#166534]" },
  rejected: { label: "Reprovada", cls: "bg-[#FEF2F2] text-[#B91C1C]" },
  returned_for_adjustment: { label: "Retornada para ajuste", cls: "bg-[#F3F4F6] text-[#4B5563]" }
};

export function WorkflowBadges({ status, isEarlyReview, analysisType, hasRecent }: WorkflowBadgesProps) {
  const statusInfo = statusMap[status] ?? { label: status, cls: "bg-[#F3F4F6] text-[#4B5563]" };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusInfo.cls}`}>{statusInfo.label}</span>
      {isEarlyReview ? <span className="rounded-full bg-[#FFF7E8] px-2 py-0.5 text-[10px] font-semibold text-[#92400E]">Revisão antecipada</span> : null}
      {analysisType === "novo_cliente" ? <span className="rounded-full bg-[#EEF2FF] px-2 py-0.5 text-[10px] font-semibold text-[#4338CA]">Novo cliente</span> : <span className="rounded-full bg-[#E6F4ED] px-2 py-0.5 text-[10px] font-semibold text-[#166534]">Cliente da carteira</span>}
      {hasRecent ? <span className="rounded-full bg-[#FEF3C7] px-2 py-0.5 text-[10px] font-semibold text-[#92400E]">Possui análise recente</span> : null}
    </div>
  );
}
